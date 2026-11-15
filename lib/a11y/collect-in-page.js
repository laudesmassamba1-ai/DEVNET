/* eslint-disable */
/**
 * Collecte exécutée **dans la page** par `lib/a11y/audit.ts`.
 *
 * Ce fichier n'est pas importé : il est lu comme du texte et passé à
 * `page.evaluate`. C'est volontaire. Un transpileur (esbuild, utilisé par
 * `tsx` pour les scripts de test) injecte des appels `__name(...)` autour des
 * fonctions déclarées ; le code envoyé au navigateur ne les connaît pas et
 * échoue. Passer par une chaîne de caractères garde le code exécutable tel
 * qu'il est écrit, et le rend lisible sans transpilation.
 *
 * Le fichier est une **expression** : une fonction entre parenthèses.
 * `audit.ts` l'entoure de son argument d'appel.
 *
 * Contrat de retour :
 *   [{ id: string, nodes: [{ target, html, summary }], incomplete?: string }]
 */
(function collectInPage(options) {
  var MAX_NODES = 50;
  var found = new Map();
  var incomplete = [];

  function add(id, element, summary) {
    var nodes = found.get(id) || [];
    if (nodes.length >= MAX_NODES) return;
    if (options.exclude.some(function (selector) { return element.closest(selector); })) return;
    if (
      options.include.length > 0 &&
      !options.include.some(function (selector) { return element.closest(selector); })
    ) {
      return;
    }
    nodes.push({
      target: selectorFor(element),
      html: (element.outerHTML || "").replace(/\s+/g, " ").slice(0, 160),
      summary: summary,
    });
    found.set(id, nodes);
  }

  function selectorFor(element) {
    var parts = [];
    var current = element;
    var depth = 0;
    while (current && current !== document.documentElement && depth < 5) {
      var tag = current.tagName.toLowerCase();
      var parent = current.parentElement;
      if (!parent) {
        parts.unshift(tag);
        break;
      }
      var siblings = Array.prototype.slice
        .call(parent.children)
        .filter(function (child) { return child.tagName === current.tagName; });
      var index = siblings.indexOf(current) + 1;
      parts.unshift(siblings.length > 1 ? tag + ":nth-of-type(" + index + ")" : tag);
      current = parent;
      depth += 1;
    }
    return parts.join(" > ") || "html";
  }

  function isRendered(element) {
    var view = element.ownerDocument.defaultView;
    if (!view) return false;
    var style = view.getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden") return false;
    if (Number(style.opacity) === 0) return false;
    // `getClientRects` est vide pour un élément hors flux de rendu
    // (`display: contents`, `<template>`, sous-arbre inerte).
    return element.getClientRects().length > 0 || style.display === "contents";
  }

  function isHiddenFromAssistiveTech(element) {
    var current = element;
    while (current) {
      if (current.getAttribute("aria-hidden") === "true") return true;
      var view = document.defaultView;
      var style = view ? view.getComputedStyle(current) : null;
      if (style && (style.display === "none" || style.visibility === "hidden")) return true;
      current = current.parentElement;
    }
    return false;
  }

  /** Texte visible d'un sous-arbre, hors contenu masqué. */
  function visibleText(element) {
    var text = "";
    var walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      var node = walker.currentNode;
      var parent = node.parentElement;
      if (!parent || isHiddenFromAssistiveTech(parent)) continue;
      if (!isRendered(parent)) continue;
      text += " " + (node.nodeValue || "");
    }
    return text.replace(/\s+/g, " ").trim();
  }

  function idText(value) {
    return value
      .split(/\s+/)
      .map(function (id) {
        var node = document.getElementById(id);
        return node && node.textContent ? node.textContent.replace(/\s+/g, " ").trim() : "";
      })
      .filter(Boolean)
      .join(" ");
  }

  /**
   * Nom accessible simplifié, dans l'ordre de la spécification : label
   * explicite, puis `aria-labelledby`, puis `aria-label`, puis le contenu.
   */
  function accessibleName(element) {
    var labelledBy = element.getAttribute("aria-labelledby");
    if (labelledBy) {
      var referenced = idText(labelledBy);
      if (referenced) return referenced;
    }
    var ariaLabel = element.getAttribute("aria-label");
    if (ariaLabel && ariaLabel.trim()) return ariaLabel.trim();

    var tag = element.tagName.toLowerCase();
    if (tag === "input" || tag === "select" || tag === "textarea") {
      var id = element.getAttribute("id");
      if (id) {
        var label = document.querySelector('label[for="' + CSS.escape(id) + '"]');
        if (label) {
          var labelText = visibleText(label);
          if (labelText) return labelText;
        }
      }
      var wrapping = element.closest("label");
      if (wrapping) {
        var wrappingText = visibleText(wrapping);
        if (wrappingText) return wrappingText;
      }
      var title = element.getAttribute("title");
      if (title && title.trim()) return title.trim();
      if (tag === "input") {
        var value = element.getAttribute("value");
        var type = (element.getAttribute("type") || "text").toLowerCase();
        if (["submit", "button", "reset"].indexOf(type) !== -1 && value && value.trim()) {
          return value.trim();
        }
      }
      return "";
    }

    var text = visibleText(element);
    if (text) return text;
    var image = element.querySelector("img[alt], svg title");
    if (image) {
      var alt = image.getAttribute("alt");
      if (alt === null) alt = image.textContent || "";
      if (alt.trim()) return alt.trim();
    }
    var elementTitle = element.getAttribute("title");
    return elementTitle && elementTitle.trim() ? elementTitle.trim() : "";
  }

  /* ── Contraste ───────────────────────────────────────────────────────── */

  // Une toile de 1 × 1 px normalise n'importe quelle notation de couleur
  // (`rgb()`, `oklch()`, `color(display-p3 …)`) en sRGB : c'est le moteur du
  // navigateur qui convertit, pas une table approximative.
  var canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  var context = canvas.getContext("2d", { willReadFrequently: true });

  function toRgba(color) {
    if (!context || !color) return null;
    context.clearRect(0, 0, 1, 1);
    context.fillStyle = "#000000";
    context.fillStyle = color;
    context.fillRect(0, 0, 1, 1);
    var data = context.getImageData(0, 0, 1, 1).data;
    if (data[3] === 0) return null;
    return [data[0], data[1], data[2], data[3] / 255];
  }

  function luminance(rgba) {
    function channel(value) {
      var v = value / 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    }
    return 0.2126 * channel(rgba[0]) + 0.7152 * channel(rgba[1]) + 0.0722 * channel(rgba[2]);
  }

  function contrastRatio(a, b) {
    var light = Math.max(a, b);
    var dark = Math.min(a, b);
    return (light + 0.05) / (dark + 0.05);
  }

  /** Couleur de fond effective, en composant les couches translucides. */
  function backgroundOf(element) {
    var layers = [];
    var current = element;
    while (current) {
      var view = document.defaultView;
      var style = view ? view.getComputedStyle(current) : null;
      if (style) {
        if (style.backgroundImage && style.backgroundImage !== "none") {
          // Un dégradé ou une image rend le calcul non concluant : on
          // préfère ne rien affirmer plutôt que de signaler à tort.
          return null;
        }
        var color = toRgba(style.backgroundColor);
        if (color) {
          layers.push(color);
          if (color[3] >= 0.999) break;
        }
      }
      current = current.parentElement;
    }
    if (layers.length === 0) return [255, 255, 255, 1];
    // Composition du fond le plus lointain vers le plus proche.
    var result = layers[layers.length - 1];
    for (var index = layers.length - 2; index >= 0; index -= 1) {
      var top = layers[index];
      var alpha = top[3] + result[3] * (1 - top[3]);
      result = [
        Math.round((top[0] * top[3] + result[0] * result[3] * (1 - top[3])) / alpha),
        Math.round((top[1] * top[3] + result[1] * result[3] * (1 - top[3])) / alpha),
        Math.round((top[2] * top[3] + result[2] * result[3] * (1 - top[3])) / alpha),
        alpha,
      ];
    }
    return result;
  }

  function directText(element) {
    var text = "";
    var children = Array.prototype.slice.call(element.childNodes);
    for (var index = 0; index < children.length; index += 1) {
      var node = children[index];
      if (node.nodeType !== Node.TEXT_NODE) continue;
      var value = node.nodeValue || "";
      if (value.trim()) text += value;
    }
    return text.replace(/\s+/g, " ").trim();
  }

  function checkContrast() {
    var candidates = document.querySelectorAll("body *");
    var incompleteCount = 0;
    for (var index = 0; index < candidates.length; index += 1) {
      var element = candidates[index];
      var text = directText(element);
      if (!text) continue;
      if (isHiddenFromAssistiveTech(element) || !isRendered(element)) continue;

      var view = document.defaultView;
      var style = view ? view.getComputedStyle(element) : null;
      if (!style) continue;
      var foreground = toRgba(style.color || "");
      if (!foreground) continue;
      var background = backgroundOf(element);
      if (!background) {
        incompleteCount += 1;
        continue;
      }

      var alpha = foreground[3];
      var composed = [
        Math.round(foreground[0] * alpha + background[0] * (1 - alpha)),
        Math.round(foreground[1] * alpha + background[1] * (1 - alpha)),
        Math.round(foreground[2] * alpha + background[2] * (1 - alpha)),
        1,
      ];
      var ratio = contrastRatio(luminance(composed), luminance(background));

      var fontSize = parseFloat(style.fontSize || "16");
      var weight = parseInt(style.fontWeight || "400", 10) || 400;
      var large = fontSize >= 24 || (fontSize >= 18.66 && weight >= 700);
      var required = large ? 3 : 4.5;
      if (ratio + 0.05 < required) {
        add(
          "color-contrast",
          element,
          "contraste " +
            ratio.toFixed(2) +
            ":1, attendu " +
            required +
            ":1 — texte « " +
            text.slice(0, 60) +
            " »",
        );
      }
    }
    if (incompleteCount > 0) {
      incomplete.push({
        id: "color-contrast",
        nodes: [],
        incomplete:
          incompleteCount + " élément(s) sur fond non unicolore : contraste non mesurable",
      });
    }
  }

  /* ── Règles ──────────────────────────────────────────────────────────── */

  function presentational(element) {
    var role = (element.getAttribute("role") || "").toLowerCase();
    return role === "presentation" || role === "none";
  }

  function checkImageAlt() {
    var images = document.querySelectorAll("img, [role=img]");
    for (var index = 0; index < images.length; index += 1) {
      var element = images[index];
      if (isHiddenFromAssistiveTech(element) || presentational(element)) continue;
      if (element.tagName.toLowerCase() === "img" && element.hasAttribute("alt")) {
        // `alt=""` est une décision explicite : image décorative.
        continue;
      }
      if (!accessibleName(element)) {
        add("image-alt", element, "aucun texte alternatif (attribut alt absent ou vide)");
      }
    }

    var inputImages = document.querySelectorAll("input[type=image]");
    for (var index2 = 0; index2 < inputImages.length; index2 += 1) {
      var input = inputImages[index2];
      if (isHiddenFromAssistiveTech(input)) continue;
      if (!(input.getAttribute("alt") || "").trim() && !accessibleName(input)) {
        add("input-image-alt", input, "bouton image sans texte alternatif");
      }
    }

    var areas = document.querySelectorAll("area[href]");
    for (var index3 = 0; index3 < areas.length; index3 += 1) {
      var area = areas[index3];
      if (!(area.getAttribute("alt") || "").trim()) {
        add("area-alt", area, "zone cliquable sans texte alternatif");
      }
    }
  }

  function checkNames() {
    var buttons = document.querySelectorAll("button, [role=button]");
    for (var index = 0; index < buttons.length; index += 1) {
      var button = buttons[index];
      if (isHiddenFromAssistiveTech(button) || !isRendered(button)) continue;
      if (button.hasAttribute("disabled") || button.getAttribute("aria-disabled") === "true") {
        // Un contrôle désactivé reste annoncé, mais son nom n'est plus lu
        // au moment de l'action : on ne bloque pas là-dessus.
        continue;
      }
      if (!accessibleName(button)) add("button-name", button, "bouton sans nom accessible");
    }

    var links = document.querySelectorAll("a[href], [role=link]");
    for (var index2 = 0; index2 < links.length; index2 += 1) {
      var link = links[index2];
      if (isHiddenFromAssistiveTech(link) || !isRendered(link)) continue;
      if (!accessibleName(link)) add("link-name", link, "lien sans nom accessible");
    }
  }

  function checkLabels() {
    var fields = document.querySelectorAll(
      "input:not([type=hidden]):not([type=submit]):not([type=reset]):not([type=button]):not([type=image]), textarea",
    );
    for (var index = 0; index < fields.length; index += 1) {
      var field = fields[index];
      if (isHiddenFromAssistiveTech(field) || !isRendered(field)) continue;
      if (!accessibleName(field)) add("label", field, "champ sans étiquette");
    }

    var selects = document.querySelectorAll("select");
    for (var index2 = 0; index2 < selects.length; index2 += 1) {
      var select = selects[index2];
      if (isHiddenFromAssistiveTech(select) || !isRendered(select)) continue;
      if (!accessibleName(select)) add("select-name", select, "liste sans nom accessible");
    }
  }

  function checkDocument() {
    var title = (document.title || "").trim();
    if (!title) add("document-title", document.documentElement, "titre du document vide");

    var lang = document.documentElement.getAttribute("lang");
    if (!lang || !lang.trim()) {
      add("html-has-lang", document.documentElement, "attribut lang absent");
    } else if (!/^[a-z]{2,3}(-[a-z0-9]{2,8})*$/i.test(lang.trim())) {
      add("html-lang-valid", document.documentElement, "lang invalide : « " + lang + " »");
    }

    var viewport = document.querySelector('meta[name="viewport"]');
    if (viewport) {
      var content = (viewport.getAttribute("content") || "").toLowerCase();
      var blocked =
        /user-scalable\s*=\s*no/.test(content) ||
        /maximum-scale\s*=\s*(1|1\.0)(?![\d.])/.test(content);
      if (blocked) add("meta-viewport", viewport, "zoom désactivé par la balise viewport");
    }

    var frames = document.querySelectorAll("iframe, frame");
    for (var index = 0; index < frames.length; index += 1) {
      var frame = frames[index];
      if (!(frame.getAttribute("title") || "").trim()) {
        add("frame-title", frame, "cadre sans titre");
      }
    }
  }

  function checkHeadings() {
    var headings = Array.prototype.slice
      .call(document.querySelectorAll("h1, h2, h3, h4, h5, h6, [role=heading]"))
      .filter(function (element) {
        return isRendered(element) && !isHiddenFromAssistiveTech(element);
      });
    var previous = 0;
    for (var index = 0; index < headings.length; index += 1) {
      var element = headings[index];
      var tag = element.tagName.toLowerCase();
      var level = /^h[1-6]$/.test(tag)
        ? Number(tag[1])
        : Number(element.getAttribute("aria-level") || 2);
      if (previous > 0 && level > previous + 1) {
        add("heading-order", element, "titre de niveau " + level + " après un niveau " + previous);
      }
      previous = level;
    }
    var hasH1 = headings.some(function (element) {
      var tag = element.tagName.toLowerCase();
      return (
        tag === "h1" ||
        (element.getAttribute("role") === "heading" &&
          element.getAttribute("aria-level") === "1")
      );
    });
    if (!hasH1) add("page-has-heading-one", document.body, "aucun titre de niveau 1");
  }

  function checkLandmarks() {
    var main = document.querySelectorAll("main, [role=main]");
    if (main.length !== 1) {
      add("landmark-one-main", document.body, main.length + " région(s) principale(s) au lieu d'une");
    }
  }

  var ARIA_ATTRIBUTES = [
    "aria-activedescendant", "aria-atomic", "aria-autocomplete", "aria-braillelabel",
    "aria-brailleroledescription", "aria-busy", "aria-checked", "aria-colcount",
    "aria-colindex", "aria-colindextext", "aria-colspan", "aria-controls", "aria-current",
    "aria-describedby", "aria-description", "aria-details", "aria-disabled",
    "aria-dropeffect", "aria-errormessage", "aria-expanded", "aria-flowto", "aria-grabbed",
    "aria-haspopup", "aria-hidden", "aria-invalid", "aria-keyshortcuts", "aria-label",
    "aria-labelledby", "aria-level", "aria-live", "aria-modal", "aria-multiline",
    "aria-multiselectable", "aria-orientation", "aria-owns", "aria-placeholder",
    "aria-posinset", "aria-pressed", "aria-readonly", "aria-relevant", "aria-required",
    "aria-roledescription", "aria-rowcount", "aria-rowindex", "aria-rowindextext",
    "aria-rowspan", "aria-selected", "aria-setsize", "aria-sort", "aria-valuemax",
    "aria-valuemin", "aria-valuenow", "aria-valuetext",
  ];

  var REQUIRED_ARIA = {
    checkbox: ["aria-checked"],
    combobox: ["aria-expanded"],
    heading: ["aria-level"],
    meter: ["aria-valuenow"],
    option: ["aria-selected"],
    progressbar: ["aria-valuenow"],
    radio: ["aria-checked"],
    scrollbar: ["aria-controls", "aria-valuenow"],
    slider: ["aria-valuenow"],
    switch: ["aria-checked"],
  };

  function checkAria() {
    var all = document.querySelectorAll("*");
    for (var index = 0; index < all.length; index += 1) {
      var element = all[index];
      var attributes = Array.prototype.slice.call(element.attributes);
      for (var index2 = 0; index2 < attributes.length; index2 += 1) {
        var attribute = attributes[index2];
        if (attribute.name.indexOf("aria-") !== 0) continue;
        if (ARIA_ATTRIBUTES.indexOf(attribute.name) === -1) {
          add("aria-valid-attr", element, "attribut ARIA inconnu : " + attribute.name);
        }
      }
      var role = (element.getAttribute("role") || "").split(/\s+/)[0].toLowerCase();
      var required = REQUIRED_ARIA[role];
      if (required) {
        for (var index3 = 0; index3 < required.length; index3 += 1) {
          if (!element.hasAttribute(required[index3])) {
            add("aria-required-attr", element, 'role="' + role + '" sans ' + required[index3]);
          }
        }
      }
    }

    // Identifiants référencés par ARIA : ils doivent exister et être uniques.
    var references = [];
    for (var index4 = 0; index4 < all.length; index4 += 1) {
      var referencesElement = all[index4];
      var attributesToCheck = ["aria-labelledby", "aria-describedby", "aria-controls", "aria-owns"];
      for (var index5 = 0; index5 < attributesToCheck.length; index5 += 1) {
        var value = referencesElement.getAttribute(attributesToCheck[index5]);
        if (!value) continue;
        var ids = value.split(/\s+/);
        for (var index6 = 0; index6 < ids.length; index6 += 1) {
          if (ids[index6] && references.indexOf(ids[index6]) === -1) references.push(ids[index6]);
        }
      }
    }
    for (var index7 = 0; index7 < references.length; index7 += 1) {
      var id = references[index7];
      var count = document.querySelectorAll('[id="' + CSS.escape(id) + '"]').length;
      if (count > 1) {
        add(
          "duplicate-id-aria",
          document.getElementById(id) || document.body,
          "identifiant « " + id + " » présent " + count + " fois et référencé par ARIA",
        );
      }
    }

    var seen = new Map();
    var withId = document.querySelectorAll("[id]");
    for (var index8 = 0; index8 < withId.length; index8 += 1) {
      var elementId = withId[index8].getAttribute("id");
      seen.set(elementId, (seen.get(elementId) || 0) + 1);
    }
    seen.forEach(function (count, elementId) {
      if (count > 1) {
        add(
          "duplicate-id",
          document.getElementById(elementId) || document.body,
          "identifiant « " + elementId + " » dupliqué",
        );
      }
    });
  }

  function checkFocus() {
    var focusable = document.querySelectorAll(
      'a[href], button, input, select, textarea, [tabindex], [contenteditable="true"]',
    );
    for (var index = 0; index < focusable.length; index += 1) {
      var element = focusable[index];
      var tabindex = element.getAttribute("tabindex");
      if (tabindex && Number(tabindex) > 0) {
        add("tabindex", element, "tabindex=" + tabindex + " positif");
      }
      if (element.closest('[aria-hidden="true"]')) {
        if (!element.hasAttribute("disabled") && Number(tabindex === null ? "0" : tabindex) >= 0) {
          add("aria-hidden-focus", element, "élément focusable dans une zone aria-hidden=true");
        }
      }
    }
  }

  function checkLists() {
    var lists = document.querySelectorAll("ul, ol, menu");
    for (var index = 0; index < lists.length; index += 1) {
      var list = lists[index];
      var children = Array.prototype.slice.call(list.children);
      var invalid = children.filter(function (child) {
        return ["li", "script", "template"].indexOf(child.tagName.toLowerCase()) === -1;
      });
      if (invalid.length > 0) {
        add("list", invalid[0], "enfant non-liste dans <" + list.tagName.toLowerCase() + ">");
      }
    }
  }

  checkDocument();
  checkImageAlt();
  checkNames();
  checkLabels();
  checkHeadings();
  checkLandmarks();
  checkAria();
  checkFocus();
  checkLists();
  if (options.contrast) checkContrast();

  var output = [];
  found.forEach(function (nodes, id) {
    if (nodes.length > 0) output.push({ id: id, nodes: nodes });
  });
  return output.concat(incomplete);
})

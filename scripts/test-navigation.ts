import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { getBackFallback } from "../lib/navigation";
import {
  asIconName,
  Icon,
  ICON_NAMES,
  isIconName,
} from "../components/Icon";

const backRoutes: Array<[string, string | null]> = [
  ["/feed", null],
  ["/projects/abc123", "/projects"],
  ["/post/abc123", "/feed"],
  ["/u/awa/posts", "/u/awa"],
  ["/admin/settings", "/admin"],
  ["/settings", "/feed"],
];

for (const [pathname, expected] of backRoutes) {
  assert.equal(getBackFallback(pathname), expected, `fallback for ${pathname}`);
}

assert.equal(isIconName("package"), true);
assert.equal(isIconName("terminal"), true);
assert.equal(isIconName("compass"), true);
assert.equal(isIconName("custom-project"), false);
assert.equal(isIconName("🌍"), false);
assert.equal(asIconName("custom-project", "package"), "package");

for (const name of ICON_NAMES) {
  const markup = renderToStaticMarkup(createElement(Icon, { name }));
  assert.match(markup, /viewBox="0 0 24 24"/, `renders ${name} as a 24px SVG`);
  assert.match(markup, /aria-hidden="true"/, `${name} is decorative to assistive tech`);
}

const outlineHeart = renderToStaticMarkup(createElement(Icon, { name: "like" }));
const emphasizedHeart = renderToStaticMarkup(
  createElement(Icon, { name: "like", strokeWidth: 2 }),
);
const filledHeart = renderToStaticMarkup(
  createElement(Icon, { name: "like", fill: "currentColor" }),
);
assert.match(outlineHeart, /aria-hidden="true"/);
assert.notEqual(outlineHeart, emphasizedHeart, "emphasis changes the icon stroke");
assert.notEqual(outlineHeart, filledHeart, "filled state uses Iconoir's solid drawing");

console.log(`${backRoutes.length + 9 + ICON_NAMES.length * 2} vérifications de navigation et d'icônes réussies.`);

# Third-Party Notices — DEVNET

DEVNET est distribué sous licence MIT (voir `LICENSE`). Ce fichier recense
les composants tiers embarqués et les obligations d'attribution qui en
découlent. Il est **généré** par `npm run sbom` à partir du
`package-lock.json` livré.

## Composants remplacés

| Composant retiré | Licence | Remplacé par | Licence |
| --- | --- | --- | --- |
| `web-push` | MPL-2.0 | `@block65/webcrypto-web-push` | MIT |
| `sharp` (+ `libvips`, `libheif`) | Apache-2.0 + LGPL-3.0 | `@napi-rs/image`, `omggif`, `lib/media/*` | MIT |
| `lightningcss` | MPL-2.0 | `vendor/lightningcss` (postcss-nested, autoprefixer, csso) | MIT |
| `axe-core`, `@axe-core/playwright` | MPL-2.0 | `lib/a11y` (moteur interne) | MIT |

## Textes de licence

- **MIT** et **ISC** : reproduction de l'avis de copyright et de la
  permission. Les paquets les portent dans leur `node_modules/<paquet>/LICENSE`.
- **Apache-2.0** : conservation de la licence, de l'avis de copyright et de
  tout fichier `NOTICE`. Voir `node_modules/<paquet>/LICENSE`.
- **BSD-2-Clause / BSD-3-Clause** : reproduction de l'avis de copyright,
  de la liste des conditions et de la clause de non-garantie.
- **CC0-1.0 / 0BSD / BlueOak-1.0.0 / Python-2.0** : licences permissives
  examinées ; obligations limitées à la mention ci-dessous.
- **CC-BY-4.0** (`caniuse-lite`, données de compatibilité navigateurs) :
  attribution « caniuse.com » aux termes de CC-BY-4.0.

## Binaires natifs embarqués

- `@napi-rs/image` : binaire Rust. Codecs sous MIT/Apache-2.0 (`image`,
  `image-webp`, `zune-jpeg`, `gif`), BSD-2-Clause (`libavif`),
  BSD-3-Clause (`libjpeg-turbo`, `tiny-skia`), Apache-2.0 OR MIT
  (`resvg`, `usvg`), Zlib/MIT (`oxipng`, `lodepng`, `zlib-rs`).
- `@tailwindcss/oxide`, `lightningcss-linux-x64-*` : **plus présents**
  (oxide reste, sous MIT ; le binaire lightningcss est remplacé par le shim).
- `ffmpeg` / `ffprobe` : **non distribués** par DEVNET. Programme externe
  invoqué par `child_process` quand il existe sur l'hôte ; sa licence est
  celle de l'hôte (LGPL/GPL selon la compilation). À trancher par Systalink.

## Inventaire par licence

### (MPL-2.0 OR Apache-2.0) (1)

- `dompurify@3.4.15`

### 0BSD (2)

- `tslib@2.8.1`
- `tslib@2.8.1`

### Apache-2.0 (37)

- `@cloudflare/workerd-darwin-64@1.20261110.1`
- `@cloudflare/workerd-darwin-arm64@1.20261110.1`
- `@cloudflare/workerd-linux-64@1.20261110.1`
- `@cloudflare/workerd-linux-arm64@1.20261110.1`
- `@cloudflare/workerd-windows-64@1.20261110.1`
- `@eslint/config-array@0.21.2`
- `@eslint/config-helpers@0.4.2`
- `@eslint/core@0.17.0`
- `@eslint/object-schema@2.1.7`
- `@eslint/plugin-kit@0.4.1`
- `@humanfs/core@0.19.2`
- `@humanfs/node@0.16.8`
- `@humanfs/types@0.15.0`
- `@humanwhocodes/module-importer@1.0.1`
- `@humanwhocodes/retry@0.4.3`
- `@neon/config@1.14.0`
- `@neon/env@2.1.3`
- `@neon/sdk@7.13.0`
- `@playwright/test@1.65.0`
- `@swc/helpers@0.5.23`
- `@vercel/blob@2.9.0`
- `@vercel/cli-config@0.3.1`
- `@vercel/cli-exec@1.0.1`
- `@vercel/oidc@3.8.10`
- `aria-query@5.3.2`
- `axobject-query@4.1.0`
- `baseline-browser-mapping@2.11.27`
- `doctrine@2.1.0`
- `eslint-visitor-keys@3.4.3`
- `eslint-visitor-keys@3.4.3`
- `eslint-visitor-keys@4.2.1`
- `eslint-visitor-keys@5.0.1`
- `human-signals@2.1.0`
- `playwright-core@1.65.0`
- `playwright@1.65.0`
- `typescript@5.9.3`
- `workerd@1.20261110.1`

### BlueOak-1.0.0 (1)

- `minimatch@10.2.6`

### BSD-2-Clause (7)

- `damerau-levenshtein@1.0.8`
- `eslint-scope@8.4.0`
- `espree@10.4.0`
- `esrecurse@4.3.0`
- `estraverse@5.3.0`
- `esutils@2.0.3`
- `uri-js@4.4.1`

### BSD-3-Clause (3)

- `esquery@1.7.0`
- `highlight.js@10.7.3`
- `source-map-js@1.2.2`

### CC-BY-4.0 (1)

- `caniuse-lite@1.0.30001814`

### CC0-1.0 (3)

- `@speed-highlight/core@1.2.24`
- `language-subtag-registry@0.3.23`
- `mdn-data@2.0.28`

### ISC (23)

- `cliui@9.0.1`
- `electron-to-chromium@1.5.452`
- `eslint-import-resolver-typescript@3.10.1`
- `fastq@1.20.3`
- `flatted@3.4.4`
- `get-caller-file@2.0.5`
- `glob-parent@5.1.2`
- `glob-parent@6.0.2`
- `graceful-fs@4.2.11`
- `isexe@2.0.0`
- `lru-cache@5.1.1`
- `minimatch@3.1.5`
- `pg-int8@1.0.1`
- `picocolors@1.1.1`
- `semver@6.3.1`
- `semver@7.8.5`
- `semver@7.8.5`
- `signal-exit@3.0.7`
- `split2@4.2.0`
- `which@2.0.2`
- `y18n@5.0.8`
- `yallist@3.1.1`
- `yargs-parser@22.0.0`

### MIT (488)

- `@alloc/quick-lru@5.3.0`
- `@babel/code-frame@7.29.7`
- `@babel/compat-data@7.29.7`
- `@babel/core@7.29.7`
- `@babel/generator@7.29.8`
- `@babel/helper-compilation-targets@7.29.7`
- `@babel/helper-globals@7.29.7`
- `@babel/helper-module-imports@7.29.7`
- `@babel/helper-module-transforms@7.29.7`
- `@babel/helper-string-parser@7.29.7`
- `@babel/helper-validator-identifier@7.29.7`
- `@babel/helper-validator-option@7.29.7`
- `@babel/helpers@7.29.10`
- `@babel/parser@7.29.9`
- `@babel/template@7.29.7`
- `@babel/traverse@7.29.10`
- `@babel/types@7.29.8`
- `@block65/webcrypto-web-push@2.0.0`
- `@cspotcode/source-map-support@0.8.1`
- `@emnapi/core@1.10.0`
- `@emnapi/core@1.11.1`
- `@emnapi/runtime@1.10.0`
- `@emnapi/runtime@1.11.1`
- `@emnapi/runtime@1.11.3`
- `@emnapi/wasi-threads@1.2.1`
- `@emnapi/wasi-threads@1.2.2`
- `@esbuild/aix-ppc64@0.28.2`
- `@esbuild/android-arm64@0.28.2`
- `@esbuild/android-arm@0.28.2`
- `@esbuild/android-x64@0.28.2`
- `@esbuild/darwin-arm64@0.28.2`
- `@esbuild/darwin-x64@0.28.2`
- `@esbuild/freebsd-arm64@0.28.2`
- `@esbuild/freebsd-x64@0.28.2`
- `@esbuild/linux-arm64@0.28.2`
- `@esbuild/linux-arm@0.28.2`
- `@esbuild/linux-ia32@0.28.2`
- `@esbuild/linux-loong64@0.28.2`
- `@esbuild/linux-mips64el@0.28.2`
- `@esbuild/linux-ppc64@0.28.2`
- `@esbuild/linux-riscv64@0.28.2`
- `@esbuild/linux-s390x@0.28.2`
- `@esbuild/linux-x64@0.28.2`
- `@esbuild/netbsd-arm64@0.28.2`
- `@esbuild/netbsd-x64@0.28.2`
- `@esbuild/openbsd-arm64@0.28.2`
- `@esbuild/openbsd-x64@0.28.2`
- `@esbuild/openharmony-arm64@0.28.2`
- `@esbuild/sunos-x64@0.28.2`
- `@esbuild/win32-arm64@0.28.2`
- `@esbuild/win32-ia32@0.28.2`
- `@esbuild/win32-x64@0.28.2`
- `@eslint-community/eslint-utils@4.10.1`
- `@eslint-community/eslint-utils@4.9.1`
- `@eslint-community/regexpp@4.12.2`
- `@eslint/eslintrc@3.3.7`
- `@eslint/js@9.39.5`
- `@jridgewell/gen-mapping@0.3.13`
- `@jridgewell/remapping@2.3.5`
- `@jridgewell/resolve-uri@3.1.2`
- `@jridgewell/sourcemap-codec@1.6.0`
- `@jridgewell/trace-mapping@0.3.31`
- `@jridgewell/trace-mapping@0.3.9`
- `@monaco-editor/loader@1.7.0`
- `@monaco-editor/react@4.7.0`
- `@napi-rs/image-android-arm64@1.16.0`
- `@napi-rs/image-darwin-arm64@1.16.0`
- `@napi-rs/image-darwin-x64@1.16.0`
- `@napi-rs/image-freebsd-x64@1.16.0`
- `@napi-rs/image-linux-arm-gnueabihf@1.16.0`
- `@napi-rs/image-linux-arm64-gnu@1.16.0`
- `@napi-rs/image-linux-arm64-musl@1.16.0`
- `@napi-rs/image-linux-x64-gnu@1.16.0`
- `@napi-rs/image-linux-x64-musl@1.16.0`
- `@napi-rs/image-win32-arm64-msvc@1.16.0`
- `@napi-rs/image-win32-ia32-msvc@1.16.0`
- `@napi-rs/image-win32-x64-msvc@1.16.0`
- `@napi-rs/image@1.16.0`
- `@napi-rs/keyring-darwin-arm64@1.3.0`
- `@napi-rs/keyring-darwin-x64@1.3.0`
- `@napi-rs/keyring-freebsd-x64@1.3.0`
- `@napi-rs/keyring-linux-arm-gnueabihf@1.3.0`
- `@napi-rs/keyring-linux-arm64-gnu@1.3.0`
- `@napi-rs/keyring-linux-arm64-musl@1.3.0`
- `@napi-rs/keyring-linux-riscv64-gnu@1.3.0`
- `@napi-rs/keyring-linux-x64-gnu@1.3.0`
- `@napi-rs/keyring-linux-x64-musl@1.3.0`
- `@napi-rs/keyring-win32-arm64-msvc@1.3.0`
- `@napi-rs/keyring-win32-ia32-msvc@1.3.0`
- `@napi-rs/keyring-win32-x64-msvc@1.3.0`
- `@napi-rs/keyring@1.3.0`
- `@napi-rs/wasm-runtime@1.1.4`
- `@napi-rs/wasm-runtime@1.2.4`
- `@next/env@16.3.8`
- `@next/eslint-plugin-next@16.4.0`
- `@next/swc-darwin-arm64@16.3.8`
- `@next/swc-darwin-x64@16.3.8`
- `@next/swc-linux-arm64-gnu@16.3.8`
- `@next/swc-linux-arm64-musl@16.3.8`
- `@next/swc-linux-x64-gnu@16.3.8`
- `@next/swc-linux-x64-musl@16.3.8`
- `@next/swc-win32-arm64-msvc@16.3.8`
- `@next/swc-win32-x64-msvc@16.3.8`
- `@nodelib/fs.scandir@2.1.5`
- `@nodelib/fs.stat@2.0.5`
- `@nodelib/fs.walk@1.2.8`
- `@nolyfill/is-core-module@1.0.39`
- `@poppinss/colors@4.1.6`
- `@poppinss/dumper@0.6.5`
- `@poppinss/exception@1.2.3`
- `@rtsao/scc@1.1.0`
- `@sindresorhus/is@7.2.0`
- `@tailwindcss/node@4.3.3`
- `@tailwindcss/oxide-android-arm64@4.3.3`
- `@tailwindcss/oxide-darwin-arm64@4.3.3`
- `@tailwindcss/oxide-darwin-x64@4.3.3`
- `@tailwindcss/oxide-freebsd-x64@4.3.3`
- `@tailwindcss/oxide-linux-arm-gnueabihf@4.3.3`
- `@tailwindcss/oxide-linux-arm64-gnu@4.3.3`
- `@tailwindcss/oxide-linux-arm64-musl@4.3.3`
- `@tailwindcss/oxide-linux-x64-gnu@4.3.3`
- `@tailwindcss/oxide-linux-x64-musl@4.3.3`
- `@tailwindcss/oxide-wasm32-wasi@4.3.3`
- `@tailwindcss/oxide-win32-arm64-msvc@4.3.3`
- `@tailwindcss/oxide-win32-x64-msvc@4.3.3`
- `@tailwindcss/oxide@4.3.3`
- `@tailwindcss/postcss@4.3.3`
- `@tybys/wasm-util@0.10.2`
- `@tybys/wasm-util@0.10.4`
- `@types/estree@1.0.9`
- `@types/json-schema@7.0.15`
- `@types/json5@0.0.29`
- `@types/node@20.19.43`
- `@types/omggif@1.0.5`
- `@types/pg@8.23.1`
- `@types/react-dom@19.3.0`
- `@types/react@19.3.0`
- `@types/trusted-types@2.0.7`
- `@typescript-eslint/eslint-plugin@8.71.2`
- `@typescript-eslint/parser@8.71.2`
- `@typescript-eslint/project-service@8.71.2`
- `@typescript-eslint/scope-manager@8.71.2`
- `@typescript-eslint/tsconfig-utils@8.71.2`
- `@typescript-eslint/type-utils@8.71.2`
- `@typescript-eslint/types@8.71.2`
- `@typescript-eslint/typescript-estree@8.71.2`
- `@typescript-eslint/utils@8.71.2`
- `@typescript-eslint/visitor-keys@8.71.2`
- `@unrs/resolver-binding-android-arm-eabi@1.12.2`
- `@unrs/resolver-binding-android-arm64@1.12.2`
- `@unrs/resolver-binding-darwin-arm64@1.12.2`
- `@unrs/resolver-binding-darwin-x64@1.12.2`
- `@unrs/resolver-binding-freebsd-x64@1.12.2`
- `@unrs/resolver-binding-linux-arm-gnueabihf@1.12.2`
- `@unrs/resolver-binding-linux-arm-musleabihf@1.12.2`
- `@unrs/resolver-binding-linux-arm64-gnu@1.12.2`
- `@unrs/resolver-binding-linux-arm64-musl@1.12.2`
- `@unrs/resolver-binding-linux-loong64-gnu@1.12.2`
- `@unrs/resolver-binding-linux-loong64-musl@1.12.2`
- `@unrs/resolver-binding-linux-ppc64-gnu@1.12.2`
- `@unrs/resolver-binding-linux-riscv64-gnu@1.12.2`
- `@unrs/resolver-binding-linux-riscv64-musl@1.12.2`
- `@unrs/resolver-binding-linux-s390x-gnu@1.12.2`
- `@unrs/resolver-binding-linux-x64-gnu@1.12.2`
- `@unrs/resolver-binding-linux-x64-musl@1.12.2`
- `@unrs/resolver-binding-openharmony-arm64@1.12.2`
- `@unrs/resolver-binding-wasm32-wasi@1.12.2`
- `@unrs/resolver-binding-win32-arm64-msvc@1.12.2`
- `@unrs/resolver-binding-win32-ia32-msvc@1.12.2`
- `@unrs/resolver-binding-win32-x64-msvc@1.12.2`
- `acorn-jsx@5.3.2`
- `acorn@8.18.0`
- `ajv@6.15.0`
- `ansi-regex@6.6.0`
- `ansi-styles@4.3.0`
- `ansi-styles@6.2.3`
- `array-buffer-byte-length@1.0.2`
- `array-includes@3.2.0`
- `array.prototype.findlast@1.2.5`
- `array.prototype.findlastindex@1.2.6`
- `array.prototype.flat@1.3.3`
- `array.prototype.flatmap@1.3.3`
- `array.prototype.tosorted@1.1.4`
- `arraybuffer.prototype.slice@1.0.4`
- `ast-types-flow@0.0.8`
- `async-function@1.0.0`
- `async-retry@1.3.3`
- `autoprefixer@10.6.2`
- `available-typed-arrays@1.0.7`
- `aws4fetch@1.0.20`
- `balanced-match@1.0.2`
- `balanced-match@4.0.4`
- `blake3-wasm@2.1.5`
- `brace-expansion@1.1.21`
- `brace-expansion@5.0.12`
- `braces@3.0.3`
- `browserslist@4.29.3`
- `call-bind-apply-helpers@1.0.2`
- `call-bind@1.0.9`
- `call-bound@1.0.4`
- `callsites@3.1.0`
- `chalk@4.1.2`
- `client-only@0.0.1`
- `color-convert@2.0.1`
- `color-name@1.1.4`
- `concat-map@0.0.1`
- `convert-source-map@2.0.0`
- `cookie@1.1.1`
- `cross-spawn@7.0.6`
- `css-tree@2.2.1`
- `csso@5.0.5`
- `csstype@3.2.3`
- `data-view-buffer@1.0.2`
- `data-view-byte-length@1.0.2`
- `data-view-byte-offset@1.0.1`
- `debug@3.2.7`
- `debug@3.2.7`
- `debug@3.2.7`
- `debug@4.4.3`
- `deep-is@0.1.4`
- `define-data-property@1.1.4`
- `define-properties@1.2.1`
- `dunder-proto@1.0.1`
- `emoji-regex@10.6.0`
- `emoji-regex@10.6.0`
- `emoji-regex@9.2.2`
- `enhanced-resolve@5.26.0`
- `error-stack-parser-es@1.0.5`
- `es-abstract-get@1.0.0`
- `es-abstract@1.24.2`
- `es-define-property@1.0.1`
- `es-errors@1.3.0`
- `es-iterator-helpers@1.4.0`
- `es-object-atoms@1.1.2`
- `es-set-tostringtag@2.1.0`
- `es-shim-unscopables@1.1.0`
- `es-to-primitive@1.3.4`
- `esbuild@0.28.2`
- `escalade@3.2.0`
- `escape-string-regexp@4.0.0`
- `eslint-config-next@16.4.0`
- `eslint-import-resolver-node@0.3.10`
- `eslint-module-utils@2.14.0`
- `eslint-plugin-import@2.32.0`
- `eslint-plugin-jsx-a11y@6.10.2`
- `eslint-plugin-react-hooks@7.1.1`
- `eslint-plugin-react@7.37.5`
- `eslint@9.39.5`
- `execa@5.1.1`
- `fast-deep-equal@3.1.3`
- `fast-glob@3.3.1`
- `fast-json-stable-stringify@2.1.0`
- `fast-levenshtein@2.0.6`
- `fdir@6.5.0`
- `file-entry-cache@8.0.0`
- `fill-range@7.1.1`
- `find-up@5.0.0`
- `flat-cache@4.0.1`
- `for-each@0.3.5`
- `fraction.js@5.3.4`
- `fsevents@2.3.3`
- `function-bind@1.1.2`
- `function.prototype.name@1.2.0`
- `functions-have-names@1.2.3`
- `generator-function@2.0.1`
- `gensync@1.0.0-beta.2`
- `get-east-asian-width@1.7.0`
- `get-intrinsic@1.3.0`
- `get-proto@1.0.1`
- `get-stream@6.0.1`
- `get-symbol-description@1.1.0`
- `get-tsconfig@4.14.3`
- `globals@14.0.0`
- `globals@16.4.0`
- `globalthis@1.0.4`
- `gopd@1.2.0`
- `has-bigints@1.1.0`
- `has-flag@4.0.0`
- `has-property-descriptors@1.0.2`
- `has-proto@1.2.0`
- `has-symbols@1.1.0`
- `has-tostringtag@1.0.2`
- `hasown@2.0.4`
- `hermes-estree@0.25.1`
- `hermes-parser@0.25.1`
- `ignore@5.3.2`
- `ignore@7.0.12`
- `import-fresh@3.3.1`
- `imurmurhash@0.1.4`
- `internal-slot@1.1.0`
- `is-array-buffer@3.0.5`
- `is-async-function@2.1.1`
- `is-bigint@1.1.0`
- `is-boolean-object@1.2.2`
- `is-buffer@2.0.5`
- `is-bun-module@2.0.0`
- `is-callable@1.2.7`
- `is-core-module@2.17.0`
- `is-data-view@1.0.2`
- `is-date-object@1.1.0`
- `is-document.all@1.0.0`
- `is-extglob@2.1.1`
- `is-finalizationregistry@1.1.1`
- `is-generator-function@1.1.2`
- `is-glob@4.0.3`
- `is-map@2.0.3`
- `is-negative-zero@2.0.3`
- `is-node-process@1.2.0`
- `is-number-object@1.1.1`
- `is-number@7.0.0`
- `is-regex@1.2.1`
- `is-set@2.0.3`
- `is-shared-array-buffer@1.0.4`
- `is-stream@2.0.1`
- `is-string@1.1.1`
- `is-symbol@1.1.1`
- `is-typed-array@1.1.15`
- `is-weakmap@2.0.2`
- `is-weakref@1.1.1`
- `is-weakset@2.0.4`
- `isarray@2.0.5`
- `iterator.prototype@1.1.5`
- `jiti@2.7.0`
- `jose@5.10.0`
- `js-tokens@4.0.0`
- `js-yaml@4.3.2`
- `jsesc@3.1.0`
- `json-buffer@3.0.1`
- `json-schema-traverse@0.4.1`
- `json-stable-stringify-without-jsonify@1.0.1`
- `json5@1.0.2`
- `json5@2.2.3`
- `jsx-ast-utils@3.3.5`
- `keyv@4.5.4`
- `kleur@4.1.5`
- `language-tags@1.0.9`
- `levn@0.4.1`
- `lightningcss@1.32.0`
- `locate-path@6.0.0`
- `lodash.merge@4.6.2`
- `loose-envify@1.4.0`
- `magic-string@0.30.21`
- `marked@14.0.0`
- `math-intrinsics@1.1.0`
- `merge-stream@2.0.0`
- `merge2@1.4.1`
- `micromatch@4.0.8`
- `mimic-fn@2.1.0`
- `miniflare@5.20261110.1-beta`
- `minimist@1.2.8`
- `monaco-editor@0.57.0`
- `ms@2.1.3`
- `nanoid@3.3.19`
- `napi-postinstall@0.3.4`
- `natural-compare@1.4.0`
- `next@16.3.8`
- `node-exports-info@1.6.2`
- `node-releases@2.0.58`
- `npm-run-path@4.0.1`
- `object-assign@4.1.1`
- `object-inspect@1.13.4`
- `object-keys@1.1.1`
- `object.assign@4.1.7`
- `object.entries@1.1.9`
- `object.fromentries@2.0.8`
- `object.groupby@1.0.3`
- `object.values@1.2.1`
- `omggif@1.0.10`
- `onetime@5.1.2`
- `optionator@0.9.4`
- `os-paths@4.4.0`
- `own-keys@1.0.2`
- `p-limit@3.1.0`
- `p-locate@5.0.0`
- `parent-module@1.0.1`
- `path-exists@4.0.0`
- `path-key@3.1.1`
- `path-parse@1.0.7`
- `path-to-regexp@6.3.0`
- `pathe@2.0.3`
- `pg-cloudflare@1.4.1`
- `pg-connection-string@2.14.1`
- `pg-pool@3.14.0`
- `pg-protocol@1.16.1`
- `pg-types@2.2.0`
- `pg@8.23.1`
- `pgpass@1.0.5`
- `picomatch@2.3.2`
- `picomatch@4.0.7`
- `possible-typed-array-names@1.1.0`
- `postcss-nested@7.0.2`
- `postcss-selector-parser@7.2.1`
- `postcss-value-parser@4.2.0`
- `postcss@8.5.23`
- `postcss@8.5.28`
- `postgres-array@2.0.0`
- `postgres-bytea@1.0.1`
- `postgres-date@1.0.7`
- `postgres-interval@1.2.0`
- `prelude-ls@1.2.1`
- `prop-types@15.8.1`
- `punycode@2.3.1`
- `queue-microtask@1.2.3`
- `react-dom@19.2.8`
- `react-is@16.13.1`
- `react@19.2.8`
- `reflect.getprototypeof@1.0.10`
- `regexp.prototype.flags@1.5.4`
- `resolve-from@4.0.0`
- `resolve-pkg-maps@1.0.0`
- `resolve@2.0.0-next.7`
- `retry@0.13.1`
- `reusify@1.1.0`
- `run-parallel@1.2.0`
- `safe-array-concat@1.1.4`
- `safe-push-apply@1.0.0`
- `safe-regex-test@1.1.0`
- `scheduler@0.27.0`
- `set-function-length@1.2.2`
- `set-function-name@2.0.2`
- `set-proto@1.0.0`
- `sharp@0.35.5`
- `shebang-command@2.0.0`
- `shebang-regex@3.0.0`
- `side-channel-list@1.0.1`
- `side-channel-map@1.0.1`
- `side-channel-weakmap@1.0.2`
- `side-channel@1.1.1`
- `stable-hash@0.0.5`
- `state-local@1.0.7`
- `stop-iteration-iterator@1.1.0`
- `string-width@7.2.0`
- `string-width@7.2.0`
- `string-width@8.3.0`
- `string.prototype.includes@2.0.1`
- `string.prototype.matchall@4.1.0`
- `string.prototype.repeat@1.0.0`
- `string.prototype.trim@1.2.11`
- `string.prototype.trimend@1.0.10`
- `string.prototype.trimstart@1.0.8`
- `strip-ansi@7.2.0`
- `strip-bom@3.0.0`
- `strip-final-newline@2.0.0`
- `strip-json-comments@3.1.1`
- `styled-jsx@5.1.6`
- `supports-color@10.2.2`
- `supports-color@7.2.0`
- `supports-preserve-symlinks-flag@1.0.0`
- `tailwindcss@4.3.3`
- `tapable@2.3.3`
- `throttleit@2.1.0`
- `tinyglobby@0.2.17`
- `to-regex-range@5.0.1`
- `ts-api-utils@2.5.0`
- `tsconfig-paths@3.15.0`
- `tsx@4.23.15`
- `type-check@0.4.0`
- `typed-array-buffer@1.0.3`
- `typed-array-byte-length@1.0.3`
- `typed-array-byte-offset@1.0.5`
- `typed-array-length@1.0.8`
- `typescript-eslint@8.71.2`
- `uint8array-extras@1.6.0`
- `unbox-primitive@1.1.0`
- `undici-types@6.21.0`
- `undici@6.29.1`
- `undici@7.30.1`
- `unenv@2.0.0-rc.24`
- `unrs-resolver@1.12.2`
- `update-browserslist-db@1.3.4`
- `util-deprecate@1.0.2`
- `which-boxed-primitive@1.1.1`
- `which-builtin-type@1.2.1`
- `which-collection@1.0.2`
- `which-typed-array@1.1.24`
- `word-wrap@1.2.5`
- `wrap-ansi@9.0.2`
- `ws@8.21.0`
- `xdg-app-paths@5.5.1`
- `xdg-portable@7.3.0`
- `xtend@4.0.2`
- `yargs@18.2.0`
- `yocto-queue@0.1.0`
- `youch-core@0.3.3`
- `youch@4.1.0-beta.10`
- `zod-validation-error@4.0.2`
- `zod@4.1.11`
- `zod@4.6.7`

### MIT OR Apache-2.0 (3)

- `@cloudflare/kv-asset-handler@0.5.0`
- `@cloudflare/unenv-preset@2.16.2`
- `wrangler@4.160.1`

### MPL-2.0 (1)

- `axe-core@4.14.0`

### Python-2.0 (1)

- `argparse@2.0.1`

### UNLICENSED (1)

- `devnet@0.1.0`


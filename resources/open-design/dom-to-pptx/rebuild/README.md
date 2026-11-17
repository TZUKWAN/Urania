# Fixed-source converter build

The active `urania.codec1` bundle is built from the exact commits, source archives,
npm lock, compilation inputs and output hashes in `../codec-build-lock.json`.
The previous OpenDesign prebuilt and its unchanged identity remain under
`../historical-open-design/`; they are not loaded by the host.

Prerequisites: Python 3.11+, Node >=22, pnpm **10.27.0**, and the SDK-local
Emscripten **4.0.17** toolchain. The validation machine used Node25.6.0 and
Emscripten revision `bb11bae9af3a6551132655a0908f86889d2d423b`.
Use the pinned emsdk source archive retained in `codec-source.zip` or its recorded
official Git commit. Run `python emsdk.py install 4.0.17` and
`python emsdk.py activate 4.0.17` inside a task-owned SDK directory. Activation
must remain local: do not use `--global`, `--system` or `--permanent`.
Installing the compiler requires downloading the official SDK tools and disk space;
the plugin never installs or activates them automatically.

Example (substitute the actual SDK and pnpm JavaScript entry paths):

```powershell
python resources/open-design/dom-to-pptx/rebuild/rebuild.py `
  --work C:/urania-build `
  --sdk-dir C:/urania-sdk `
  --pnpm-cli C:/tools/node_modules/pnpm/bin/pnpm.cjs
```

`--work` must be an empty, short absolute directory on Windows. Deep pnpm paths
can fail in native tools or module resolution even when ordinary file reads work.
The script verifies source archives, safely extracts the fixed inputs, builds the
real codec with strict undefined-symbol checks, installs the frozen dependencies
with lifecycle scripts disabled, applies the recorded wrapper/SVG/browser-path
patches, and verifies both codec and browser bundle against their actual hashes.
All caches and outputs stay under `--work` unless an explicit `--em-cache` is given.
`REBUILD_RESULT.json` is produced only after exact output comparison succeeds.

No source is fetched from a floating `latest`. No user configuration, API key,
system font installation, DSH restart or desktop operation is part of this build.
The source map records the actual bundled module content. The verified npm
publisher packages include their own prebuilt distribution files; this does not
claim that every nested publisher distribution was rebuilt independently.

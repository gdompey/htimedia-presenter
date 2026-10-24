# Resource packs

Installed apps read `manifest.json` from the GitHub release tagged **`resources`**:

```
https://github.com/gdompey/htimedia-presenter/releases/download/resources/manifest.json
```

Each manifest entry names a gzipped JSON pack, its version, its size and its SHA-256. The app downloads the
packs marked `default` on first launch, verifies the checksum, and installs them under the user's `Resources` folder.
If a pack's `version` changes, installed copies update on the next launch (unless auto-update is off).

## Pack types

| type | payload | installed to |
|---|---|---|
| `bible` | `{abbrev, name, language, books:[{name, chapters:[[verse text...]]}]}` (66 books, canonical order) | `Resources/bibles/<ABBREV>.json` |
| `themes` | `{themes:[theme...]}` | themes list (marked as from the pack) |
| `media` | `{files:[{name, file, type, tags, data(base64)}]}` | `Resources/media/<pack-id>/` + media bin |
| `songs` | `{presentations:[presentation...]}` | library (added only if missing; user edits are never overwritten) |

## Publishing an update

```bash
# 1. Edit content in scripts/resource-src/ (themes.js, backgrounds.js, songs.js)
# 2. Bump the matching number in VERSIONS in scripts/build-resources.js
npm run build:resources
# 3. Upload, replacing the files already on the release
gh release upload resources dist-resources/* --clobber
```

`npm run build:resources` also refreshes `resources/bundled/`. That starter set goes into the next installer build.

## Using your own server

A church can host its own packs, for example on a local NAS. Copy `dist-resources/` to any web server and set the
manifest URL under **Resources → Advanced: resource source**. Pack URLs in the manifest can be relative to the manifest.

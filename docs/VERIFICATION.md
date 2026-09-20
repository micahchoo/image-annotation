# Verification

Checked on 2026-09-19 in Obsidian 1.13.7, using the Marginalian vault.

## Automated checks

- TypeScript check passed.
- Production bundle built.
- 31 tests passed across six files.

Tests cover normalized geometry, record updates, caption retention, rename handling, malformed indexes, concurrent writes, paragraph anchors, image extraction, and reference replacement.

## Obsidian checks

The runtime checks used a temporary note and a snapshot from the ice article.

- Downloaded a remote image into the vault and opened the region editor.
- Drew and saved a polygon through editor controls.
- Attached the region to a paragraph with a native block ID.
- Rendered the crop with the expected pixel coordinates.
- Rendered bold caption text and a wikilink.
- Checked native link indexing for the image, source article, writing, and caption wikilink.
- Used the passage-first command and region picker to attach a second caption to the same region.
- Changed a compact reference to inline in Live Preview and checked the editor text.
- Renamed the writing note and checked both stored connections.
- Reopened the region and checked its selected overlay.

Runtime testing found and corrected a modal focus error from focusable SVG elements.
It also found differences in source-location metadata between Reading view and Live Preview.

The screenshot in `region-editor.png` shows the selected region in the actual Obsidian editor.
Mobile touch behavior and cross-device sync conflicts remain untested.

## Image context-menu regression

The initial handler opened its own menu alongside Obsidian's image menu.
The handler now uses `Menu.forEvent(event)` to add its action to the shared menu.
Menu instances also track their image action to prevent duplicate entries from file and DOM events.

Run this check with an image visible in the named vault:

```bash
node scripts/check-image-menu.mjs marginalian
```

The actual Obsidian check reported two menus before the fix and one menu after the fix.
The resulting menu retained Copy image, Remove image, Reset size, and one Annotate image regions action.

## Image Annotation release preparation

Checked on 2026-09-19 after the rename and interface copy update:

- Official Obsidian recommended lint rules: no errors or warnings.
- TypeScript and 32 behavior tests passed.
- Three release validation tests passed.
- Dependency audit reported no vulnerabilities.
- Release packaging checked all three install files and read back every ZIP member.
- All release SHA-256 checksums matched.
- The installed plugin reports Image Annotation and the three updated command names.
- All three existing regions survived the rename with their original IDs.
- The Eyes region still opens with its His Eyes Sparkle note attachment and caption.
- The image menu has one Annotate image action alongside the native image actions.

The current README screenshot is `image-annotation.png`. Older captures show the earlier interface.
The GitHub workflows are prepared locally; publication and directory review have not run.

## Full name change

The project directory, package name, plugin ID, install directory, and archive now use `image-annotation`.
The data folder is `Image Annotation`, and Markdown previews use the `image-annotation` code block.
No compatibility aliases remain.

Migrated the development vault's three regions and two caption attachments.
Obsidian loaded both caption bodies and resolved both attached notes under the new plugin ID.
All source images, caption files, and attached notes exist at their recorded paths.
The old plugin is disabled and its old install and data directories are absent.
The complete release checks and artifact checksum checks passed after the rename.

## 0.1.2 review fixes

Removing the installed Obsidian type package reproduces 212 unsafe-call warnings, including the reported first lines in `main.ts`.
Restoring the types produces a clean lint result without disabling any unsafe-type rules.
The previous lockfile fails clean npm 10 installation with an esbuild platform error.
Pinning Vite 7 and regenerating its lockfile lets Node 22/npm 10 install and run all 35 tests and release checks.
CI now checks clean installations with npm 10 and npm 11.
Public release uploads are limited to the three Obsidian install files.

## 0.1.3 refresh and cleanup checks

Checked on 2026-09-19:

- Official Obsidian lint and TypeScript checks passed.
- All 52 behavior tests and the release validation script passed.
- Production build and local release packaging passed.
- Tests cover targeted connection invalidation, unchanged index reloads, external edits,
  duplicate occurrence selection helpers, fenced reference cleanup, and caption retention.
- Media tests cover early size rejection, unsupported or inaccurate HEAD responses,
  retained caption/note/canvas references, unsaved editor content, reviewed candidate limits,
  and references added between cleanup scans.

The development vault loaded the new cleanup commands. A temporary-note desktop check
reached the targeted refresh checks, but the Obsidian CLI stopped returning results during
the remaining workflow. Duplicate selection and cleanup therefore have automated coverage,
not a completed desktop runtime sign-off. Temporary test notes and captions were removed
from the vault, and its original three regions and two attachments remain.

No Android device was connected for a real-device check. Mobile touch behavior remains
unverified; this update makes no new mobile compatibility claim. Publication is verified separately through the release workflow.


## 0.1.4 correctness and larger-workload checks

Checked on 2026-09-20: official lint, TypeScript, 94 behavior tests and release checks pass. Clean Node 22/npm 10 dependency installation and vulnerability audit pass. Source/cleanup tests cover unsupported block context, late reference events, encoded reference definitions, missing dependency restoration, stable region order and atomic index replacement.

Synthetic tests use fake in-memory vaults. At 250k regions plus 250k connections, warm edits invalidate one connection and yield between serialization batches. Cold native JSON parsing alone takes about 258ms; full-file writes still grow with the index. Repeated edits and renames retain about657–660MB after forced GC at this extreme size.

Cleanup of100k notes and10k snapshots reads each unchanged note once: approximately641ms total and34ms maximum timer gap, protecting the5k referenced snapshots. Portable probes: `node --expose-gc scripts/benchmark-store.mjs 250000` and `node scripts/benchmark-cleanup.mjs`. Full before/after evidence is in `ledgers/ROUND2-IA.md`.

These automated results are not a desktop, mobile, sync or filesystem latency sign-off.

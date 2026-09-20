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

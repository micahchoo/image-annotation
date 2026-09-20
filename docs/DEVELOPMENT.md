# Build Image Annotation

Use Node.js 22.12 or later and Python 3. Run commands from this plugin's directory.

```sh
npm ci
npm audit --audit-level=moderate
npm run release:verify
```

The release check runs the official Obsidian lint rules, TypeScript, behavior tests, release tests, and a clean build.
Packaging checks the three install files, version metadata, and ZIP contents. SHA-256 checksums accompany the release files.

Copy `release/main.js`, `release/manifest.json`, and `release/styles.css` into your development vault's `.obsidian/plugins/image-annotation/` folder.
Reload **Image Annotation**. The plugin ID is `image-annotation`, and its data folder is `Image Annotation`.

## Release

Use the contents of this directory as the repository root. Keep the surrounding workspace and vaults outside the repository.

Update the version in `manifest.json`, `package.json`, and both root entries in `package-lock.json`.
Add that version's minimum Obsidian version to `versions.json`. Update `docs/RELEASE-NOTES.md`.

Run the release checks before creating a tag. The tag must match the manifest version without a `v` prefix.
The GitHub release workflow repeats the checks, attests the artifacts, and publishes only the three Obsidian install files.
The ZIP and checksums stay in the local release directory.
The check workflow runs on pull requests and changes to the default branch.

The README describes the release that users can install. Keep its screenshots and instructions aligned with that release.
Keep private vault content out of published artifacts.

README image URLs are absolute and pinned to the release tag. Update them when publishing a new version.

To submit a published release, use the [Obsidian Community directory](https://community.obsidian.md).
The owner must sign in and connect their GitHub account. A successful local build does not imply directory acceptance.

## Manual checks

In a development vault, check the following before a release:

- Right-click an image: one menu contains one **Annotate image** action.
- Draw, title, and save a region. Attach it to a note with a caption.
- Open the preview in Reading view and Live Preview.
- Attach a saved region from a paragraph.
- Edit the region and caption, then restart Obsidian.
- Rename the image and attached note within Obsidian.
- Disable the plugin: caption files and links remain readable.

For the context-menu regression check, open a note with a visible image, then run:

```sh
node scripts/check-image-menu.mjs marginalian
```

Use a device check before claiming mobile behavior is tested. A desktop viewport emulation does not establish mobile compatibility.

# 0.1.2

- Fix clean dependency installation with npm 10 and npm 11 so Obsidian API types resolve during checks.
- Publish only `main.js`, `manifest.json`, and `styles.css` as release assets.
- Remove the CSS `!important` override while keeping unused controls hidden.

Image and note pickers list vault file paths when you open them. This supports choosing existing images and notes.
The plugin does not upload vault content.

Requires Obsidian 1.8.7 or later.

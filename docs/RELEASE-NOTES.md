# 0.1.5

- Write into a note one way, however it is open. Inserting a reference into an open note used to replace everything from the insertion point to the end of the note in one editor edit; it now replaces only the inserted lines, the same minimal edit every other note change already made. The three note writes share one implementation, with tests against a fake editor.
- The reference block's shape (the fence, the id, the mode, four lines) is declared in one module and every reader and writer asks it.
- Two writers could both create the plugin folder from a cold vault and one would fail; folder creation now tolerates losing that race, as the snapshot writer already did.
- Internal: media cleanup takes the store's frozen path snapshot as a named type rather than testing whether an array is frozen; the index path is exported from the store rather than repeated in the plugin; the image-extension test and the HTML image pattern are written once; three unused exports removed.

No change to `Image Annotation/index.json`, captions or settings.

# 0.1.4

- Refuse unsupported Markdown blocks before attaching an image region to prose. Preserve valid paragraphs after display math.
- Refresh previews when missing captions, images or the annotation index return.
- Scan notes once during media cleanup, then recheck changed documents and open editors. Protect encoded image references and references added during cleanup.
- Use targeted connection and image indexes. Preserve overlapping-region order after edits and attachment order after renames.
- Yield during large index validation, serialization and folder renames. Keep atomic external-edit conflict checks and the existing storage format.

The index still uses a single JSON file. Very large indexes retain synchronous parsing and full-file write costs. Synthetic scaling checks do not establish mobile or device-specific performance.

# 0.1.4

- Refuse unsupported Markdown blocks before attaching an image region to prose. Preserve valid paragraphs after display math.
- Refresh previews when missing captions, images or the annotation index return.
- Scan notes once during media cleanup, then recheck changed documents and open editors. Protect encoded image references and references added during cleanup.
- Use targeted connection and image indexes. Preserve overlapping-region order after edits and attachment order after renames.
- Yield during large index validation, serialization and folder renames. Keep atomic external-edit conflict checks and the existing storage format.

The index still uses a single JSON file. Very large indexes retain synchronous parsing and full-file write costs. Synthetic scaling checks do not establish mobile or device-specific performance.

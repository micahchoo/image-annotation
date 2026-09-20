# Image Annotation guide

## Start from a paragraph

Place the cursor in an ordinary text paragraph, or select text within it.
Run **Image Annotation: Attach an image region to this paragraph**.
Choose a saved region or draw a new one. Write a caption and select **Attach to note**.

The plugin adds an Obsidian block ID to the paragraph. Existing block IDs remain unchanged.
For lists, tables, headings, and code blocks, attach to the whole note instead.

## Preview controls

- **Open region** opens the image with the region selected.
- **Open note** opens the attached note or paragraph.
- **Source note** opens the note that contains the original image.
- **Edit caption** opens the caption file.
- **Collapse preview** hides the image and caption beneath the region title.
- **Show image and caption** keeps the preview expanded.

Previews work in Reading view and Live Preview.
If a note contains duplicate references, Live Preview offers a line picker when it cannot identify the clicked occurrence.
Choose the line whose display you want to change. Reading view identifies the occurrence directly.

## Edit a region

Run **Image Annotation: Browse image regions** and choose a region.
Select **Edit region**, change the title or draw a replacement, then select **Save region**.
The region keeps its existing note attachments.

To delete a region, select **Delete region**, then select the confirmation button.
Deletion removes the region and its attachments from the index. Caption files remain in the vault.
Select **When deleting a region, remove its previews from notes** to remove its fenced previews too.
Surrounding writing and caption links remain unchanged.

Run **Image Annotation: Remove unavailable references** to review notes with broken region previews and remove those previews.

## Clean up snapshots

Run **Image Annotation: Clean up unused image snapshots** to review unused downloads and move them to trash.
The command checks again before removal. It keeps snapshots used by regions, captions, notes, or canvases.
Open Markdown editor text also protects images that have not yet been saved.
Close image editors before cleanup. Local images outside the snapshot folder are not candidates.

## Captions and links

Each attachment has a Markdown caption file. Edit the text between its two comment markers.
The links above the markers identify the image, source note, and attached note.
Captions support normal Markdown and note links. The caption field has no link autocomplete.

A note can contain several regions. A region can attach to several notes, each with a separate caption.
When the plugin is disabled, caption files and their links remain readable. Interactive previews require the plugin.

## Storage and sync

The plugin stores annotations in this folder:

```text
Image Annotation/
  index.json
  Captions/
  Media/
```

The index stores region shapes, image paths, and note attachments. Captions stay in Markdown files.
Web images become local copies, named with a hash of their contents. Local images stay at their original paths.
Keep the index, captions, and images together in backups and sync.

Do not rename the `Image Annotation` folder. Rename other notes and images inside Obsidian while the plugin is enabled.
Obsidian's link-update preference controls changes to links within caption files.
Changes outside Obsidian can require manual path repair. Changes to an image can invalidate a region's position.

Avoid simultaneous annotation edits on multiple devices. The plugin detects conflicting index changes but does not merge them.
If a conflict occurs, let sync finish, reload the plugin, and retry the edit.

## Web images and privacy

The plugin downloads a web image only when you choose it for annotation.
The image website receives that request. The plugin does not upload notes, captions, or annotation data.
There are no accounts, telemetry, or remote processing services.

Web images must have a direct image URL. Supported formats are PNG, JPEG, WebP, GIF, BMP, and AVIF.
The plugin first asks the server for the image size and rejects declared sizes above 40 MB.
If the server omits or rejects that request, the plugin checks the downloaded bytes instead.
This fallback does not cap network transfer or peak memory use.
Local SVG images also work. Video and audio annotation are not supported.

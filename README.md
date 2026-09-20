# Image Annotation

Mark part of an image, add a caption, and attach it to a note.

![An image region attached to the real note His Eyes Sparkle](https://raw.githubusercontent.com/micahchoo/image-annotation/0.1.1/docs/image-annotation.png)

Keep a detail from an image beside the words you write about it.
Return to the full image or its source note from the preview.

![Right-click an image, draw a region, add a title, save, attach to His Eyes Sparkle, and preview the caption](https://raw.githubusercontent.com/micahchoo/image-annotation/0.1.1/docs/right-click-workflow.gif)

The recording uses the earlier button labels; the steps are the same.

## What you can do

- Mark a rectangle or draw an irregular shape.
- Give each region a title.
- Add a caption with Markdown and links to notes.
- Attach a region to a note or a specific paragraph.
- Reuse a region in several notes with different captions.
- Show the image and caption, or collapse them beneath a title.

Images can come from your vault or from web images embedded in a note.
The original image stays unchanged.

## Annotate your first image

1. Right-click an image and select **Annotate image**.
2. Select **Draw rectangle** and drag over the detail you want.
3. Enter a region title and select **Save region**.
4. Select **Attach to note**.
5. Choose an existing note, or enter a new note title.
6. Write a caption and select **Attach to note**.

Your note now contains the image region and its caption.
Select **Open region** on the preview to return to the full image.

For an irregular outline, use **Draw polygon**.
Select points around the detail, then select **Finish polygon** before saving.

## Start from your writing

Place the cursor in a paragraph.
Run **Image Annotation: Attach an image region to this paragraph** from the command palette.
Choose a saved region or draw a new one, then add a caption.

The preview appears after the paragraph.
For lists, tables, headings, or code blocks, attach to the whole note instead.

## Return to an annotation

Run **Image Annotation: Browse image regions** to find a saved region.
Select **Edit region** to rename or redraw it.
Its note attachments remain connected.

Select **Edit caption** on a preview to change the caption in its Markdown file.
Select **Open note** to return to the attached note or paragraph.

## Choose the display

**Image and caption** shows the image region beside your writing.
**Collapsed preview** shows its title until you expand it.
You can change the display on each preview.

There is no settings page. Choose these options when you attach a region.

## Install

Community directory publication is pending.
For a manual installation, download the [latest release](https://github.com/micahchoo/image-annotation/releases/latest) and copy these files into your vault's `.obsidian/plugins/image-annotation/` folder:

- `main.js`
- `manifest.json`
- `styles.css`

Enable **Image Annotation** under **Settings → Community plugins**.

## Your annotations stay in your vault

Captions are ordinary Markdown files. Regions and note attachments are stored in a local index.
The data folder is `Image Annotation`.
Keep that folder with your vault when you back up or sync.

When you annotate a web image, the plugin downloads a local copy from its source website.
It does not upload your notes or captions. There are no accounts, analytics, or paid services.

Captions and links remain readable without the plugin. Interactive previews require the plugin.
Deleting a region keeps its caption files.

See the [guide](docs/guide.md) for storage, sync, supported formats, and editing details.
See [development instructions](docs/DEVELOPMENT.md) to build and check a release.

## License

[MIT](LICENSE). Created by Micah.

[Support development on GitHub Sponsors](https://github.com/sponsors/micahchoo).

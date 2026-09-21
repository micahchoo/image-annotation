/** What counts as an image, by path: the one list, with any query or fragment ignored. */
export const isImage = (path: string): boolean => /\.(png|jpe?g|webp|gif|bmp|svg|avif)$/i.test(path.split(/[?#]/)[0]);

/** An HTML image tag and its `src`. Read from article text and from notes during cleanup. */
export const IMG_TAG = /<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi;

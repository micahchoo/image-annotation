import type { App } from 'obsidian';

/**
 * The one caller of `vault.createFolder`. It refuses a path that already
 * exists, and the check before it is a separate await, so two callers can
 * both find a folder missing and both make it — the store on its first
 * region and the snapshot writer on its first web image both build the plugin
 * root from a cold vault. Losing that race is success: the folder is there.
 * A folder still missing afterwards is a real failure and is reported.
 */
export async function ensureFolder(app: App, path: string): Promise<void> {
  let current = '';
  for (const part of path.split('/')) {
    current = current ? `${current}/${part}` : part;
    if (app.vault.getAbstractFileByPath(current)) continue;
    try { await app.vault.createFolder(current); }
    catch (error) { if (!app.vault.getAbstractFileByPath(current)) throw error; }
  }
}

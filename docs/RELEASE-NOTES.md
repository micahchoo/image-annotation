# 0.1.3

- Refresh only affected previews. Caption edits no longer reload the annotation index, and unchanged index reloads do not redraw previews.
- Choose which duplicate reference to change using a line picker in Live Preview.
- Optionally remove previews when deleting a region, while keeping captions and surrounding writing.
- Review and remove unavailable references with a new command.
- Review unused image snapshots and move them to trash. Cleanup protects referenced images, including caption links and unsaved Markdown editor text, and rechecks before removal.
- Reject oversized remote images early when the server supplies a size. The downloaded-byte check remains in place when it does not.

Lint, TypeScript, 52 behavior tests, build, and packaging checks passed. Full desktop workflow verification was interrupted by an unresponsive Obsidian CLI. Mobile touch behavior remains untested.

Requires Obsidian 1.8.7 or later.

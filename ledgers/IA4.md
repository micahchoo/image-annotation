# IA4 — region-store work amplification

Status: done 2026-09-20 — local CPU and invalidation fixes verified; full snapshot disk cost retained and measured.

Contract: measure each mutation and invalidation path; retain native single-index compatibility and atomic external-conflict detection while reducing local CPU and unrelated work. Benchmark 1k/10k/50k regions plus equal connections; distinguish serialization, write bytes and storage. Do not claim that fake storage establishes device responsiveness. Reconsider persistence layout only if remaining measured costs justify migration; any migration requires its own recovery tests.

Controls: “log it, don't fix it yet”, “continue the ledger”, “classify only”, “the kill criterion stands”.

| Case or stage | Expected | Actual before | Verdict | Fix commit | Retest |
| --- | --- | --- | --- | --- | --- |
| create/update/connect/remove | Persist requested delta, invalidate affected refs | Atomic JSON compare/write correct; serializes and diffs all objects | CPU amplification | working tree (uncommitted) | 14 store tests: exact delta invalidation and record-serialization guard pass |
| unrelated path event | No affected IDs without scanning every record | 10k unrelated lookups: 438ms at1k records,4057ms at10k | Scaling defect | working tree (uncommitted) | 10k unrelated lookups at50k records: 4.4ms, previously21s |
| rename file/folder | Update affected paths and retain captions | All objects rebuilt even if unrelated to rename | Avoidable allocation | working tree (uncommitted) | Folder/file rename, reverse-index and image lookup tests pass |
| unchanged reload / own echo | No validation/diff work | Cached raw equality already works | preserve | working tree (uncommitted) | Unchanged raw/whitespace reload tests pass without invalidation |
| external valid/corrupt change | Adopt valid records; reject corrupt without overwriting | Existing tests pass | preserve | working tree (uncommitted) | External valid/corrupt snapshot tests pass |
| conflict during atomic process | Refuse write and protect existing caption | Existing tests pass | preserve | working tree (uncommitted) | Atomic conflict and caption-preservation tests pass |
| one-region update at10k | Bounded mutation CPU, one invalidation | ~20–22ms CPU,5.05MB rewrite,34ms file-backed fake vault | Improve CPU; write size remains format limitation | working tree (uncommitted) | 10k warm edit1.9–2.4ms;3.21MB; file-backed fake18.8ms |

Reproduction: `node ledgers/probes/ia-store-scale.mjs`; before output retained separately in `ledgers/measurements/ia-store-before.jsonl` after probe completion. File-backed measurements use temporary local files with a fake vault API, not live Obsidian or sync.

## Implementation and retest

- Local mutations now carry direct deltas; full comparison runs only for external snapshots. Unchanged records retain cached serialization.
- Reverse connection/path/image indexes support file and folder lookups. Large external index adoption builds a staging index and publishes it after cooperative chunks.
- Serialization retains schema v1 and uses one compact JSON record per line. No data migration or compatibility branch is required; existing snapshots still load. Atomic vault.process comparison remains unchanged.
- 14 store tests pass, including external conflict/corrupt handling, folder rename/reverse-index cleanup, compact round-trip, unchanged external reload and a serialization-count guard proving warm edits touch only the changed record.
- Before/after benchmark artifacts: measurements/ia-store-before.jsonl and measurements/ia-store-after.jsonl. At50k regions+50k connections: ~105–110ms→23–34ms warm local edit; max timer gap105–110ms→15–26ms.10k unrelated lookups21s→4.4ms. Single snapshot16.33MB versus25.53MB previously. File-backed fake-vault edit~108ms, versus157ms previously.

Decision: retain the conflict-safe v1 snapshot. Local CPU meets the proposed warm-action budget in this synthetic probe; byte count still scales linearly and real Obsidian/sync storage requires a separate device check. A new storage format is not justified by these CPU results alone. Startup loading includes synchronous native JSON parsing; the cooperative adoption helps subsequent work, not parsing itself. These are explicit performance limits, not claims of universal50ms/device guarantees.

## Independent review — ordering regression

Before fixing, differential probes against the prior store found: changing the title of shared-image region r1 changed rendering order [r0,r1,r2] to [r0,r2,r1]; renaming the first attachment's target moved it to the end of getConnections. applyDelta removed and re-added unchanged Set memberships. main.ts passes region-image lookup order to SVG rendering, so this can change overlap stacking after reopening. Persistence, path membership and invalidation comparisons otherwise passed across 300 connections, large renames, deletion and external reparenting. Fix contract: unchanged grouping keys preserve their original membership order; changed/removed memberships still update indexes. Retest recorded below.

Retest complete: applyDelta now retains region-image and connection-region Set membership when the grouping key is unchanged; deletes and changed groups still remove old memberships. Added behavior tests verify shared-image rendering order after title/geometry edits, attachment order after target/caption renames, and matching order after reopening persisted data. 14 store tests pass; TypeScript check and lint pass. The independent 300-connection differential probe now reports identical region/attachment order as well as membership, persistence and invalidation outputs. Lesson: a reverse index's insertion order can be user-visible rendering state; preserving set membership alone does not preserve behavior. Stored in these tests and this ledger.

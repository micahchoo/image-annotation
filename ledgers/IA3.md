# IA3 — incremental snapshot safety census
Status: done 2026-09-20 — automated checks passed; desktop UI remains unverified.
Contract: inventory and measure before edits; retain every reference protection; unchanged documents read once per deletion operation; cooperatively yield near 8ms and expose cancellation/progress. Synthetic files only. Controls: log it, don't fix it yet; continue the ledger; classify only; the kill criterion stands.

| case or stage | expected | actual and measurement | verdict | fix commit | retest |
|---|---|---|---|---|---|
| Caption/note/wiki/Markdown/HTML/reference-style/canvas/JSON | Keep used snapshots | Existing eight cleanup tests pass; raw basename fallback protects unknown syntax | pass | working tree (uncommitted) | Existing reference-retention cleanup regressions pass; raw basename protection retained. |
| Unsaved editor / regions / new refs | Keep used snapshots | Existing tests cover unsaved editor, post-review links and changed region provider | pass | working tree (uncommitted) | Unsaved-editor, region-provider, newly created canvas and changed-document protections pass. |
| Scan 10k notes, 1000 snapshots | Near-linear document scan | Actual-source fake-vault probe 6.17s, 10k reads, ~15MB text | pass | working tree (uncommitted) | Full deletion at 10k notes/1k snapshots: 43ms, exactly 10k reads; CI read-count/yield guard passes. |
| Delete 200 notes, 25/50/100 unused snapshots | No repeated unchanged reads | 5200/10200/20200 reads;48/168/613ms | pass | working tree (uncommitted) | Large work-count regression removes 1000 snapshots with exactly one read per 10000 unchanged notes. |
| Cancellation / progress | Interruptible maintenance | No signal, progress or cooperative task yields | pass | working tree (uncommitted) | Abort-before-start and mid-cleanup cancellation tests pass; listeners released; event-loop yield observed. Modal not UI-tested. |
| Per-candidate safety | Revalidate only changed documents, live editors and regions | Full document+snapshot cross-product repeated before every trash | pass | working tree (uncommitted) | Dirty-document safety tests pass; integration loads index once for 100 candidates and twice when new region use appears. |

Lesson: safety checks need incremental invalidation; cache only immutable observations and conservatively keep references seen during the operation. Stored here as safety contract.

## Fix and retest
One basename-token pass per document replaces the note×snapshot loop. An operation-scoped event census subscribes before initial reads and revisits only modified/created/renamed documents. Once observed, references remain protected until operation end. Regions and live editors are checked immediately before each trash; unchanged editor text is not reparsed. Read failures stop cleanup. Finally blocks release event subscriptions on success, error and cancellation. Added an AbortSignal and progress callback, wired to a cancellable modal, with cooperative checkpoints near 8ms.

| notes | snapshots | referenced fraction | actual removed | document reads | bytes read | total deletion ms | largest timer gap ms |
|---|---|---|---|---|---|---|---|
| 10000 | 100 | 0 | 100 | 10000 | 15000000 | 48 | 9 |
| 10000 | 100 | .5 | 50 | 10000 | 15004850 | 45 | 10 |
| 10000 | 1000 | 0 | 1000 | 10000 | 15000000 | 43 | 11 |
| 10000 | 1000 | .5 | 500 | 10000 | 15048500 | 48 | 10 |
| 50000 | 100 | 0 | 100 | 50000 | 75000000 | 212 | 17 |
| 50000 | 100 | .5 | 50 | 50000 | 75004850 | 215 | 17 |
| 50000 | 1000 | 0 | 1000 | 50000 | 75000000 | 200 | 15 |
| 50000 | 1000 | .5 | 500 | 50000 | 75048500 | 206 | 17 |

Actual-source Node synthetic workload, fake in-memory vault; one timed run per matrix row, not a device SLA. Note read/byte counts exclude index-provider disk work (provider returned an empty region set), actual filesystem trash and sync. Added CI behavior guard for 10k notes/1k snapshots: exactly 10k document reads and observable event-loop yield. Existing reference protection tests plus new changed-document, newly created canvas, newly unsaved editor, denied-read, mid-cleanup cancellation and listener-release tests pass. Large-vault UI verification remains unperformed; no real vault was used.

## Follow-up integration review
The first implementation still called `store.load()` and copied all regions per candidate through its main.ts provider. This was found before sign-off and corrected: main now observes index create/modify/delete/rename events, reloads once initially and only after a new index revision, and supplies the store's stable frozen `imagePaths()` snapshot. The census recognizes immutable path snapshots and does not rescan them per candidate. Two actual-plugin integration tests assert one load for 100 unchanged candidates, and two loads plus retention when a new region appears between removals. Unchanged live-editor text is cached as well.

With 10,000 additional live region paths, complete cleanup remained 43ms (10k notes,1000 snapshots) and 206ms (50k notes,1000 snapshots), with 10/15ms maximum timer gaps respectively. These measurements include protection of live paths but exclude the provider's initial real filesystem read; index load counts are separately guarded by integration tests.

The expanded original-version scan-only matrix was replayed from HEAD in /tmp after implementation to avoid confusing the old and new paths. At 10k/50k notes and 100/1000 snapshots, 0/.5 referenced fractions: 599/591ms, 6130/6073ms, 2964/2916ms, 29974/30191ms respectively. Timer gaps matched those full durations (up to 30.2s); each read each note once. This late baseline expansion supplements the pre-fix 10k-note and small-deletion measurements; the full old large deletion was deliberately not run because its repeated-read mechanism was already established.

Status: done 2026-09-20 — all automated safety and work-count probes pass. Desktop modal interaction and real filesystem latency remain unverified. Fix commit: working tree (uncommitted). Lesson retained in this ledger: scope observations to an operation, subscribe before scanning, and revalidate only changed sources while preserving conservative protection.

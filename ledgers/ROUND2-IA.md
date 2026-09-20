# Image Annotation — second correctness and scaling pass
Status: done — 2026-09-20; automated scope complete, large-index limits retained below
Contract: inventory and reproduce new boundaries before changes; preserve schema v1, conflict checks, reference safety and unrelated local work. Synthetic files only; no vault or remote APIs. No commits/releases in this delegated scope.

| case or stage | expected | actual before fix | verdict | fix commit | retest |
|---|---|---|---|---|---|
| Cleanup reference event between async census and trash | Newly referenced snapshot retained | New microtask-boundary test fails at depth 2: modification event ran before trash, yet referenced file trashed | pass | working tree (uncommitted) | 12 microtask placements pass; epoch checked after async reads, no await before live check/trash. |
| Encoded Markdown reference definition | Valid image destination protects snapshot | `[snapshot]: <Image%20Annotation/Media/%61…png>` produced deletion candidate in actual scanner test | pass | working tree (uncommitted) | Reference-style destination parsing decodes escaped basename; image retained. |
| Prose after same-line display math | Closed math must not block following prose | New passage test after `$$x + y$$` fails with prose refusal | pass | working tree (uncommitted) | Same-line opening/closing delimiters balance; prose anchors successfully. |
| Cold 100k/250k regions plus equal connections | Bounded work and coherent state | 865/2338ms; max timer gaps281/659ms;32.4/82.2MB JSON; heap265/704MB | improved; known limit | working tree (uncommitted) | 100k/250k cold gaps106/277ms; JSON.parse alone104/258ms. Cooperative validation/map loops; synchronous parse remains. |
| Warm single edit 100k/250k + equal connections | Only one invalidation, no full serialization of unchanged records | 132/339ms; gaps35/36ms;1 invalidation each | pass with full-file cost | working tree (uncommitted) | 100k/250k edit121/335ms; max gaps21/34ms; one invalidation each. |
| Unrelated rename 100k/250k | No writes | 4/9ms; gaps6/10ms | pass | working tree (uncommitted) | 100k/250k6/14ms; no index write. |
| Broad folder rename 100k/250k | Preserve all identities and yield | 913/2408ms; gaps71/160ms;100k/250k invalidations | improved; known limit | working tree (uncommitted) | 100k/250k gaps39/58ms; exact100k/250k invalidations;10k-record atomic-publication and queued-write tests pass. |

Baseline from actual source with in-memory fake vault, one run per row, no filesystem/sync cost. Probe `/tmp/ia-round2-scale.mjs`; retained runnable copy will accompany final results. Cold JSON.parse is synchronous and remains an explicit schema/storage boundary to assess; do not claim all cold-load work fits50ms without measurement.


## Final verification and retained probes
- TypeScript, official lint, all 94 behavior tests and the release test script pass on the combined current tree. No release or manifest edits were made by this subtask.
- `image-annotation/scripts/benchmark-store.mjs`: portable actual-store fixture, 100k or 250k regions plus equal connections. Run `node --expose-gc --max-old-space-size=4096 scripts/benchmark-store.mjs 250000` from the plugin. Preserves schema and checks invalidation counts. With exposed GC, repeats edit/rename and reports retained heap.
- `image-annotation/scripts/benchmark-cleanup.mjs`: 100k notes, 10k snapshots, 100k live source paths; half the snapshots referenced. Complete synthetic cleanup removed exactly5000, read exactly100000 documents/150.485MB,641ms elapsed,34ms largest timer gap. No disk trash or live index-provider filesystem cost is included.
- Store final ordinary run: 100k cold877ms/gap106, edit121/gap21, broad rename920/gap39;250k cold2498/gap277, edit335/gap34, broad rename2520/gap58. JSON.parse alone104/258ms. Individual runs, not percentile/device guarantees.
- Exposed-GC250k run: cold2504ms/gap332, edit322/gap36, broad rename2606/gap59. Retained heap across three edit/rename rounds:659,657,660MB; RSS1264,1287,1293MB. This demonstrates a short-run retained-heap plateau, not a long-session leak proof. Raw output preserved at `/tmp/ia-round2-store-gc.jsonl` during the session.

## Remaining limits and decisions
Cold JSON.parse and whole-file persistence remain synchronous/full-file boundaries of schema v1. Worker decoding was considered but not introduced: cloning/serialization and worker lifecycle are a larger storage change than the validated loop fixes. Large250k-index cold loads still exceed50ms, and broad rename showed58–59ms timer gaps. Do not describe the release as universally stall-free. Actual DOM work for very large mounted-preview counts, mobile hardware, real filesystem/sync latency and sustained multi-hour memory behavior remain unverified. The run does not modify any real vault.

Lesson retained here: recheck event epochs after every asynchronous safety census before destructive actions; collection chunking must include validation, mapping and change-set construction, not just the final index builder. The schema-v1 synchronous parse floor is an explicit constraint, not a passed responsiveness gate.

# IA1 — prose-only anchors
Status: done 2026-09-20 — automated checks passed; desktop UI remains unverified.
Contract: inventory, probe, then fix/retest; every excluded block must refuse without mutation. Synthetic editor only. Controls: log it, don't fix it yet; continue the ledger; classify only; the kill criterion stands.

| case or stage | expected | actual and measurement | verdict | fix commit | retest |
|---|---|---|---|---|---|
| Entry points | Single guarded write boundary | main.ts paragraph command calls anchorPassage; whole-note attach bypasses it | pass | working tree (uncommitted) | Code trace confirms one guarded paragraph write; whole-note route remains separate. |
| Prose and native IDs | Preserve native identity | Existing passage tests pass | pass | working tree (uncommitted) | Passage regressions preserve prose and inline/separated native IDs. |
| Four-space/tab code and 1) lists | Refuse without mutation | Executed probe appended ID to four-space code and 1) list; regex omits tabs/indentation | pass | working tree (uncommitted) | Zero-mutation refusal assertions pass for four spaces, tabs and parenthesized ordered markers. |
| Fences, 1. lists, bullets, tables, headings | Refuse | Existing guards/tests handle basic forms; table without leading pipe and setext underline omitted | pass | working tree (uncommitted) | Fenced code, ordered/bullet lists, table and setext/ATX heading refusal tests pass. |
| Nested/list continuation across blanks | Refuse | Classifier checks current paragraph only; blank-separated continuation lacks marker | pass | working tree (uncommitted) | Blank-separated indented list continuation cases refuse with zero mutation. |

Lesson: classify the surrounding block before writing an anchor; preserve text on refusal. Stored here as the fix contract.

## Fix and retest
The expanded executable matrix had 11 failing cases out of 18 before the fix: four-space/tab code, parenthesized list marker, two continuation cases, two setext headings, table without leading pipe, thematic break, HTML block, reference definition. Guard now rejects those before any editor write and recognizes blank-separated list continuation. Retest: all 18 passage cases pass with explicit zero-mutation assertions. Existing prose and inline/separated native anchors remain supported. Commit: working tree (uncommitted).
Status: done 2026-09-20 — implementation and regression verified; desktop UI not exercised.

Cross-review added document-level blank-separated YAML, HTML, comment and display-math contexts: all now refuse without mutation; prose after closed metadata/HTML and HTML examples inside a completed fence remains accepted. The regression matrix now includes 24 passage cases. Context is deliberately conservative; whole-note attachment remains the recovery path.

# IA2 — restoration invalidation
Status: done 2026-09-20 — automated checks passed; desktop UI remains unverified.
Contract: complete dependency transition inventory before fixes; restored dependencies recover, unchanged own-index echoes remain silent. Fake vault only. Controls: log it, don't fix it yet; continue the ledger; classify only; the kill criterion stands.

| case or stage | expected | actual and measurement | verdict | fix commit | retest |
|---|---|---|---|---|---|
| Caption/image/index create | Recover affected previews | onload registered rename/modify/delete only | pass | working tree (uncommitted) | Fake-plugin caption/image/index creation integration cases refresh affected previews. |
| Caption delete→restore | Both transitions refresh | Executed fake-plugin probe: delete 1 refresh, restore still 1 despite readable caption | pass | working tree (uncommitted) | Delete refresh count 1; restoration refresh count 2 in integration tests. |
| Index late arrival | Load arrived records | No create listener, empty startup state retained | pass | working tree (uncommitted) | Late-created index loads the connection and refreshes its preview once. |
| Modify | Targeted refresh, index reload only for index | Existing path queue debounces and invalidates affected IDs | pass | working tree (uncommitted) | Existing store targeted-path tests and unchanged-index integration checks pass. |
| Rename | Rewrite paths and refresh affected IDs | Store.rename then changed | pass | working tree (uncommitted) | Store rename regression suite passes; unchanged main rename handler reviewed. |
| Delete | Missing dependency fallback | Executed caption deletion refreshes; index deletion reloads | pass | working tree (uncommitted) | Caption/image/index deletion integration cases refresh and remove unavailable indexed state. |
| Own writes | No unchanged index redraw | Existing store tests suppress unchanged reload invalidations | pass | working tree (uncommitted) | Unchanged index create/modify echoes cause no additional refresh in integration test. |

Lesson: cache invalidation includes recovery, not only disappearance. Stored here as transition contract.

## Fix and retest
Create now enters the same targeted debounce path as modify; arriving indexes load before dependency invalidation. Four fake-plugin integration tests cover caption/image delete→restore, late index arrival, index delete→restore, unrelated creation, and unchanged index create/modify echoes. All pass; every restored dependency dispatches a new affected-preview refresh, own unchanged index echoes do not. Commit: working tree (uncommitted).
Status: done 2026-09-20 — fake plugin event integration verified; desktop UI not exercised.

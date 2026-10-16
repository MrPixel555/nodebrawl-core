# Pass state and chest command codecs in 3.1.0

The server runtime remains **Node.js only**. Python/Unicorn run offline analysis
and verification against the supplied library; users need neither to start the
server. This change implements **762** and expands wire coverage. It does not
complete battle rewards or chest redemption.

## Original reward catalogue

[season-rewards.json](../server/data/season-rewards.json) records all five original
pass rows: Rookie_Basic, Pro_Basic, Pro_Rares, Pro_EarlyStrikes and Pro_EarlyTowers.
Each has 36 crown thresholds (0 through 350), with both tracks: **180 tiers /
360 reward tracks**. Every descriptor's kind and amount was compared with the
original virtual methods after loading/linking the original CSV data. The
decoded source hashes and library SHA-256 accompany the catalogue.

Original kinds are 0 empty, 3 resource, 4 chest, 5 token, 6 emote, 7 skin and
9 strike. These are catalogue entries, not implemented gameplay handlers.

Command **836** selects the last reward whose required crowns are at or below
the supplied selector (`0x2b29c8`), rather than treating the selector as a tier
index. Selectors 0..9 therefore choose the same first reward. The current starter
pass grants 500 Gold/FreeGold once for that branch. Native duplicate rejection
is 44, including across different selectors in that range. The next free tiers
are chests; they do not represent repeated 500-gold claims.

## Persisted progress and seen state

Command **762**, executor `0x460fac`, records the last viewed crown position. It
does not earn crowns or grant rewards. It accepts a nonnegative position no
greater than the stored crowns and no smaller than the previous viewed position.
Native failures are 1 for negative, 7 for beyond earned progress and 8 for moving
backwards. Equal positions are allowed.

Accounts now retain `passCrowns`, `passSeenCrowns` and `passInitialized`. Legacy
accounts retain the existing free-gold claim, cards, balances and identity;
missing progress defaults to zero crowns and an unseen position of -1. No
automatic crowns or further rewards are awarded by migration. Mixed batches
remain atomic, including a failed 762 after a card change or a gold claim.

`lib/protocol/pass-state.js` ports Home+0x650's serializers (`0x543f70`,
`0x181040`, `0x1c49dc`, `0x19a968`). It preserves arena-boost and pass state together.
The fixed-table Arena reference is one index+1 VInt, unlike a dynamic two-VInt
data reference. Thirty complete native Home fixtures verify progress, seen
boundaries and coexistence with the previous claim/boost. Four additional
synthetic native-encoder fixtures check distinct auxiliary fields, optional
branches and identity vectors; their auxiliary game semantics are not asserted.

Positive crown totals are explicit test inputs. The runtime currently has no
completed battle-result path that earns them.

## Nested messages and ordinary loot results

Native message codecs are now available for:

| Message | Native encode / decode | Format |
| --- | --- | --- |
| 16194 | 0x4b1fb4 / 0x47f938 | two VInts, optional client command |
| 22192 | 0x167b88 / 0x6129d8 | one server command |
| 26980 | 0x24f744 / 0x217b98 | two VInts, command vector, optional bytes |

The single-command envelopes enforce the original server/client classification,
extracted from every command's virtual method +0x38; classification is not
inferred from an ID range. Unknown nested codecs fail explicitly because commands
have no length prefix. Command batches enforce the native limit of 1,000.

Server command **235**, native `0x57bf68 / 0x44d24c`, carries an optional loot
result, a pending-entry selector and the native command prefix. The ordinary
result (**type 0**) codec now supports null/empty/nonempty card vectors, six
integers and two packed flags per card, four result integers, and a token vector.
All 124 original spell indexes were checked against the conditional-field
predicate; none uses its extra field branch in this library. The runtime validates
those indexes and bounds collection lengths. Fields retain native offset names
where economy meaning is not yet verified. Draft result **type 2** remains
explicitly unsupported.

These new envelopes and 235 currently provide **wire codecs**, not a runtime
request handler, loot generator or currency/card credit path. A 235 submitted
in a client turn remains unsupported and cannot grant server-authored loot.
The library's pending reward queue at Home+0x638 and commands 628/521 still need
an authoritative server implementation and reconnect tests before later chest
rewards can be enabled. Premium ownership, season rollover, earning crowns,
live Training/battle, and clan creation/membership remain incomplete.

## Verification

Evidence: [pass state](native-pass-state.json), [ordinary loot](native-loot-result.json),
and committed native fixtures under `test/fixtures/`. Node tests compare complete
native payloads, malformed/truncated input, persistence, transaction rollback and
TCP reconnect. The user's latest report confirms the previous 500-gold claim and
manual card edits persist on Android; the new 762 and chest codecs have no new
Android validation yet.

With the retained original library and linked analysis snapshot:

```bash
GAME_ANALYSIS_DIR=/workspace/game-analysis /workspace/game-analysis/venv/bin/python tools/reverse/verify_pass_state.py
GAME_ANALYSIS_DIR=/workspace/game-analysis /workspace/game-analysis/venv/bin/python tools/reverse/verify_command_messages.py
GAME_ANALYSIS_DIR=/workspace/game-analysis /workspace/game-analysis/venv/bin/python tools/reverse/verify_loot_result.py
```

Ordinary development/server validation remains `npm test` and `npm run lint`.

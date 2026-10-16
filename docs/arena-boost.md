# Observed command 595: one-time Arena1 chest-speed boost

The device sent a turn containing **only 595**, with the following selectors:

```json
{"field_0x1c":-1,"field_0x20":-1,"field_0x28":[54,1],"field_0x30":false}
```

Reference `[54,1]` is the original `Arena1` row. Its `ReachedBoost` is
`ChestSpeedUp`, and `BoostTimeH` is **24**. This turn contains no name command
948. The earlier mixed-turn rejection hypothesis does not explain this report.

## Original native behavior

`verify_arena_boost.py` restores the locally retained fully linked original
CSV tables, decodes the actual 95-card starter Home and creates the normal
Trophy Road manager slot with the original initializer **`0x621370`**. The
observed command uses executor **`0x59b664`**:

- `field_0x30:false` selects the current manager slot through `0x5d624c`.
- A non-null Arena reference selects the arena boost branch. The other two
  integer selectors are unused in this branch.
- `0x594f28` rejects a threshold already consumed by that slot.
- `0x1e9c38` creates boost type **3**, with **1,728,000 remaining ticks** at
  20 ticks per second: exactly 86,400 seconds.
- `0x42f8dc -> 0x3414c0` records the arena's trophy threshold, **0** for Arena1,
  in the slot's `HighestArenaBoostScore`.
- First execution returns **0**. Duplicate execution returns **41** and does
  not extend the timer, including after the boost expires.

Only context ownership/time and UI/analytics listeners are adapted. Native CSV
lookup, slot creation, eligibility, timer creation and serializers execute.
The full native Avatar remains unchanged. Golden full-Home fixtures independently
verify that names, gems, gold and decks are unaffected.
[Native execution report](native-arena-boost.json).

## Server behavior and persistence

The server supports precisely the current starter Arena1 reference with
`field_0x30:false`. It does not accept another arena, a null reference or the
secondary reward path merely because their wire layouts are known. Other
595 branches still produce bounded diagnostic selectors.

The account stores `starter.arena1Boost` as `claimedAtMs/expiresAtMs`, or null
before the first claim. The duration is exactly 86,400,000 ms. The authenticated
account store serializes competing writes and validates the entire command
batch before saving. Two sessions cannot claim twice; a failed later command
also rolls back an earlier name, purchase or boost in the same batch. Existing
account IDs, tokens, names, decks and balances are retained.

Both 8-card and 95-card Home templates bind **two complete native fragments**:
the boost timer manager (`Home+0x5d0`) and the Trophy Road claim manager
(`Home+0x650`). Fresh accounts still emit their unchanged empty fragments.
Claimed accounts emit the original native claimed manager and temporary boost
record. Remaining ticks consume elapsed wall time across restarts and cannot
exceed the initial 24 hours if the clock moves backward. After expiry, a zero
timer and the consumed marker are sent; the native lobby check `0x758354`
recognizes the claim and does not enqueue it again. Reconnecting never grants
a fresh 24-hour window.

The event is `arena-boost-claimed` with arena `Arena1` and seconds `86400`.
Repeated claims log `starter-turn-rejected` with reason `Arena1 boost already
claimed`. There is no invented response or acknowledgement packet for this
predicted client command.

## Validation and limits

Eight full native Home fixtures cover two identities (including UTF-8 and edited
decks/resources) at claim, one hour, 24 hours and 25 hours. Native decoding
consumes all bytes, re-encoding reproduces them, and the original lobby claim
check succeeds after decoding. Node-generated Homes match every complete
fixture. TCP tests cover encrypted commands, reconnect through new server/store
instances, expiry, duplicate and concurrent claims, atomic rollback and another
account's unchanged state. Bad stored timing fields fail validation.
The actual `node index.js` entry point also passed the smoke client in plaintext
and nacl17 modes, with isolated accounts/keys and a saved boost/name/deck batch.

The device has not yet tested this boost handler or its new Home fields. This
does not implement other Trophy Road rewards, opening chests, naming dialogs,
Training, matchmaking or a battle simulation.

Reproduce with the matching retained analysis environment:

```sh
GAME_ANALYSIS_DIR=/workspace/game-analysis /workspace/game-analysis/venv/bin/python tools/reverse/verify_arena_boost.py
npm test
npm run lint
```

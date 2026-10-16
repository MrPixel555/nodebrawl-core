# Manual deck edits, Home flags and the first free pass reward

The user's trace against **df5b95d** confirms `starter-name-set` and a successful
gold pack purchase; the user confirms that spending 60 gems leaves 1,100 gold
after restarting the app. The same trace rejects **693**, **836**, **869**,
**762**, **10453** and **19355**. A separate Training trace identifies **17967**
with NPC **[18,7]** (Npc8). The fixes below cover the stated branches only.

## Card edits: command 693

Manual card edits send **693**, rather than the full-deck command 563 that the
server already handled. Original executor `0x49a670` has two branches:

| Selectors | Native operation |
| --- | --- |
| `field_0x1c = -1`, `field_0x20/24 = 0..7`, distinct | Swap two active slots |
| `field_0x1c = inventory index`, `field_0x20 = active slot`, `field_0x24 = -1` | Swap the inventory card with that active slot |

An inventory index is not a global card ID or the card's current visual sort
position. The card removed from the deck takes the same native inventory slot.
Rebuilding the inventory in CSV order after a swap would interpret later
requests incorrectly. Accounts now retain the ordered 87-card inventory beside
the five decks. The active deck and inventory remain disjoint, unique and
complete: exactly 95 owned cards.

Deck selection 703 and full-deck updates 563 now preserve the original
`0x48f950` slot-by-slot active/inventory swaps. The native cache flush
`0x48852c` captures the selected deck before persistence. Invalid selectors and
unsupported mixed turns do not partially change saved cards. Existing accounts
derive their first inventory order from their previously sent Home; credentials,
balances, names and deck selection are retained.

## Pass reward: command 836, current pass, tier 0, free branch

Original `0x1d14cc` accepts selectors **0 / false / false** at zero crowns.
Fully linked original `season_pass_rookie.csv` data resolves the free reward to
**500 Gold**. Original reward execution also adds **FreeGold**, resource
**5000005**, for the amount actually credited. Gold is capped at **5,000,000**:
from 4,999,900 only 100 is credited; at the cap no FreeGold record is created.

The server persists both resource balances and `freePassGoldClaimed`, then
encodes the original native manager state in Home +0x650. That state coexists
with the independent Arena1 chest-speed boost. Reconnecting cannot reset either
claim. The native executor returns **44** for an already claimed reward, also
after decoding the serialized Home. Server duplicates reject without a second
credit. Concurrent claims from separate stores also credit once.

This supports the initial free gold reward in the fixed starter pass. It does
not grant crowns, unlock later tiers, implement chest drops, premium ownership,
old-season claims, bonus rewards or season rollover. Those branches remain
unsupported. Profile lookup omits private Gold, FreeGold and gem balances.

## Command 869

Original executor `0x59ed34` accepts a selector from 1 through 4 and sets that
bit in Home +0x2c4 through `0x342de8`. The server now stores this bit mask and
binds its original VInt serialization at `0x34c8ec`. It does not treat this
command as a reward or currency transaction. Its wider UI meaning is not
inferred from the scalar setter alone. Command 762 remains outside the handler.

## Verification and device test

`verify_lobby_actions.py` runs the original executors, codecs and full linked
CSV data. [The report](native-lobby-actions.json) records both account variants,
manual swaps/replacements followed by 703/563, invalid indices, flag setting,
12 full Home fixtures across normal/capped balances and boost states, and
duplicate reward rejection after native decode. Context clock, UI/analytics
listeners and libc/POSIX imports are explicit adapters; card/reward rules are
not replaced. These checks do not verify the new Android UI behavior.

```sh
GAME_ANALYSIS_DIR=/workspace/game-analysis /workspace/game-analysis/venv/bin/python tools/reverse/verify_lobby_actions.py
npm test
npm run lint
```

TCP tests perform manual swaps, claim the reward, stop the server, create a new
server/store and compare the resumed Home and persisted account. A repeat claim
leaves the account file unchanged. Encrypted TCP and actual CLI smoke also cover
the new commands. `starter-deck-updated`, `free-pass-reward-claimed` and
`home-flags-updated` record outcomes without names or credentials.

The user's subsequent report against 810cb4a confirms receiving the 500-gold
reward and manual card changes surviving an app restart. The
[device evidence](device-lobby-actions.json) retains both the earlier failing
trace and that confirmation. Keep the existing app data, Frida script/key and
`.local` state when updating; an already claimed reward is not claimable again.

## Remaining runtime work

Clan creation **10453** still lacks a runtime handler. The original create cost
is 1,000 gold (`ALLIANCE_CREATE_COST`); a compatible implementation also needs
member/leader records, persistent clan IDs, Avatar membership, native response
semantics, clan data/stream serialization and reconnect state. The empty
advanced-search handler does not provide those behaviors.

Training **17967 [18,7]** is correctly decoded but still has no live battle
provider. The [original replay-world probe](battle-snapshot.md) uses that same
Npc8/map/deck. It verifies replay initialization and serializers, not a live
ownership/input/AI/result protocol. Normal battle command 527 and cancellation
13006 also remain unimplemented. No empty or replay packet is advertised as a
working Training battle.

The [complete matrix](packet-matrix.md) lists every one of the 284 catalogued
messages and 135 commands, with wire support separated from runtime support.
The exhaustive factory recheck executes all 65,536 IDs with both observed flag
values: 131,072 calls, zero errors, 268 created types / 275 observations, no new
IDs. This confirms construction coverage and does not establish complete game
logic for every type.

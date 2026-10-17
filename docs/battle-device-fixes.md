# Device battle, cancellation, Party and clan fixes

The phone now opens Training. Its supplied trace then showed spell rejection,
many `13351` events and `battle-finished` without a results screen. Cancelling
a queued search crashed at `libg+0x2ddbb8` while reading a null Avatar commodity
group. The complete Android UI is unavailable in this workspace.

## Mana and timing

The former preliminary spell execution used native flags **1**. In executor
`0x5deac4`, this is client prediction: successful execution reserves mana in
player `+0x200` through `0x39a208` and alters predicted hand state. It is not a
read-only validator. The authority advanced with `0x24b7fc` and retained these
reservations, explaining subsequent `13` rejections despite visible mana.

The server now checks ownership, source deck, coordinates, codec, duplicates
and a bounded input clock, then queues the command. Native flags **3** perform
the actual hand/mana/placement check and execution at the agreed twenty-tick
delay. Bots consult the read-only actual mana/cost and placement getters.
The native client/server regression checks that enqueueing does not reserve
authority mana, spends mana once at execution and preserves simulation CRCs.

A deadline-based scheduler replaces a fixed interval whose busy guard could
discard a whole interval. It advances ten native ticks per batch and schedules
immediately when behind. It never skips simulation ticks. CPU saturation can
still make a match slow; `TRACE_NETWORK=1` exposes batch lag and input clocks.

## Correct messages for the transition

| Message | Recovered native behavior |
| --- | --- |
| 13351 | LogicEvent; type, two VInts, three VInt vectors, optional type-specific value |
| 18495 | Battle status receipt; no reward or client-authoritative outcome |
| 22871 | BattleResult: outcome, crown counts, optional final GameMode snapshot and reward-related fields |
| 25382 | Empty cancellation acknowledgement: close search popup and clear search state |

`22871` encoder/decoder are `0x57be64` / `0x739d3c`. Dispatch branch
`0x71f85c` forwards to `0x63c2ec`, which processes the optional snapshot and
constructs the result HUD through `0x13b2ac`. Outcomes are 1=win, 2=loss,
3=draw. Crowns occupy `+0x9c/+0xa0`. Native outcomes are persisted once before
sending this message; previously only persistence/sector updates occurred.
The explicit leaver receives Home while other players receive the result.

`25382` dispatch branch `0x71ebc0` invokes `0x739910` and `0x3f1aa8`.
Queued cancellation sends this acknowledgement rather than replacing Home and
Avatar beneath existing UI callbacks. A cancel crossing a found snapshot is
acknowledged while the found match continues loading. This corrects the reply
route; the crash stack alone does not prove every cause of its null group.

## Party and clan scope

Starter Home with native battles advertises CASUAL events 1002=`2v2`
(`TeamVsTeamLadder`, 72000023) and 1001=`Double Elixir` (72000001). Both are
eligible source modes. Event matchmaking uses command 527 selectors 0/2 and a
known event ID. Queues separate mode **and** ladder/Party reward policy.
Incomplete rosters use labelled bots after the configured wait. Party records
friendly results without issuing unimplemented event rewards.

Creation `10453` now atomically spends the source 1000-gold cost, caps FreeGold
as the native debit does, allocates a clan ID and persists leader membership.
Server command **477**, carried by `22192`, performs the corresponding native
client transition. Do not precede it with an already-debited Home.
**28165** supplies the clan header and member list after creation and login.
Home and public Profile include the native conditional clan branch; reconnect
does not recreate or charge the clan. Name search `14783 -> 24184` uses stored
clans. Advanced numeric filters, joining/leaving, chat, donations, wars and
general clan progression remain incomplete. Those are separate handlers.

## Reproduction and evidence

```bash
npm test -- --test-concurrency=2 --test-timeout=120000
npm run lint
node tools/check-server.js
node tools/verify-battle-protocol.js
npm run battle:verify -- --full-match
```

The full combat check ended at tick 2890 with 3–1 crowns. The native online
client and server matched checksums for 400 ticks with no desync callback.
Both advertised Party modes initialized and synchronized native sectors.
Tests cover actual TCP cancel/Training/reconnect/forfeit, natural result routing,
isolated Party queues, bot filling, atomic clan creation and retained membership.

Optional offline analysis uses the retained APK/library checkpoints:

```bash
GAME_ANALYSIS_DIR=/workspace/game-analysis /workspace/game-analysis/venv/bin/python tools/reverse/verify_battle_routing.py
GAME_ANALYSIS_DIR=/workspace/game-analysis /workspace/game-analysis/venv/bin/python tools/reverse/verify_clan_membership.py
GAME_ANALYSIS_DIR=/workspace/game-analysis /workspace/game-analysis/venv/bin/python tools/reverse/verify_dynamic_home.py
```

These prove original codec/dispatcher/executor paths with documented context/UI
adapters. Eight current Node Home/Profile outputs pass full original decode and
re-encode with linked CSV data, including Party handler construction and clans.
All four Home/Profile binding files reproduce from the existing generators.
The Node server never invokes Python or these analysis tools.

Pull and restart; keep `.local` and game data. The existing `client-dev.js`
and public key remain valid. Installation is checked before listeners/key I/O;
a missing or stale ARM64 package reports `npm ci` immediately. Updated controls,
results, cancellation, Party and clan UI still need the next phone run.

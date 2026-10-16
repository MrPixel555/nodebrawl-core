# Native battle runtime in Node.js

`HOME_MODE=starter` now starts an authoritative battle service. It runs the
original ARM64 simulation using the pinned `@alexaltea/unicorn-js@2.1.4`
WebAssembly dependency inside Node worker threads. Runtime needs Node 18+ and
`npm ci`; Python, an APK, a compiler and subprocesses are not required.

The library SHA-256 is
`4dd79f7c143fe87dba0e3c7521fe150bf1e018783a2e04632bd38bba5dafde5a`.
The committed image contains original relocated code, linked CSV tables and all
53 loaded LevelData geometries. It contains no constructed matches or accounts.
Every inflated image block is size-bounded and SHA-256 checked before use.

## Play paths and configuration

```bat
git pull origin main
npm ci
set HOME_MODE=starter
set TRANSPORT=nacl17
set HOST=0.0.0.0
set PORT=9339
set TRACE_NETWORK=1
npm start
```

Keep `.local/accounts` and `.local/server-key.json`. Existing client-dev.js and
its public key do not change. Continue using the trusted HTTPS content URL.

| Trigger | Server behavior |
| --- | --- |
| Training `17967`, NPC `[18,n]` | Source NPC, original deck/card levels, location and Training GameMode |
| `10953` | Same path only when its PvE reference is null; challenge rules are unsupported |
| EndClientTurn `13597`, command `527` | Normal queue; two humans, or a labelled practice bot after five seconds |
| Cancel `13006` | Removes queued search or aborts a still-loading match, then sends Home |
| Snapshot `28991` / acknowledgment `15263` | Original owner-specific initialization/full world state, then start ticking |
| Input `16194` | Authenticated battle command plus client tick/checksum |
| Sector `26980` | Native tick/checksum and commands, every ten ticks (500 ms) |
| Return `12526/15965/18533/14062` | Authoritative forfeit if still running, result persistence and current Home |
| Same-account reconnect | Rebinds the current match and sends an actual snapshot including pending inputs |

World type **0** enables the original online execution path. Original command
creation/execution timestamps preserve the native twenty-tick delay. Native
spell validation checks hand/deck, elixir and placement. Clients cannot supply
card descriptors, replace their cards, impersonate another owner or execute
arbitrary Home commands inside a battle. Input queues, tick windows, duplicates
and worker requests are bounded. A native exception disposes the worker and
returns connected players Home; it does not apply a guessed match result.

Movement, targeting, collisions, damage, projectiles, buffs, towers, mana,
simulation RNG and winner determination execute original instructions.
Trainer/practice-bot card selection is a small deterministic server policy
using the native validator; it is not a recovered official matchmaking/AI policy.

| Environment | Default / supported scope |
| --- | --- |
| `BATTLE_MODE` | `native` with starter Home; `disabled` disables it |
| `BATTLE_MAX_MATCHES` | 2; accepted range 1..8 |
| `BATTLE_BOT_WAIT_MS` | 5000; 0 means wait for humans only |
| `BATTLE_GAME_MODE` | 72000006 Ladder; 72000014 configures four-player 2v2 |
| `BATTLE_ARENA` | 54000001; the source Arena selects PvP/2v2 geometry |

Source collection-deck modes with PvP/TvT player layouts can be configured.
Only ordinary matchmaking selectors are handled; event/challenge selectors,
draft/predefined player-deck rules and the Party selection UI are not implemented.
Training uses each NPC's source location. All 53 original level geometries are
available in the image; unused 3v3 geometry being loadable does not implement
six-player play or its UI. Runtime rosters are two or four players.

Each match owns a worker and an ARM64 VM with a 256 MiB mapped heap plus code,
stack and WebAssembly overhead. Start with the default concurrency and measure
CPU/RAM on the target Windows machine before increasing it. The clock skips no
simulation ticks if a batch takes longer than 500 ms; matches can run slowly
on an overloaded machine. Workers have operation timeouts and bounded queues.

A loading acknowledgment has a 30-second deadline. If every human disconnects,
the match remains available for 60 seconds. Completed matches expire after two
minutes. Matches are held in memory and do not survive a server restart.

## Results and account state

Original winner/crown state determines the outcome. Training records history
without farming gold or season crowns. Ladder awards the source Arena's victory
gold (5 in Arena1) and earned crowns toward the persisted Pass counter. Account
updates use the existing authenticated, serialized, atomic store; a battle ID
prevents duplicate payouts. The last 1000 results are retained. Reconnect or
repeated Home requests do not replay the payout. Trophies, chest generation,
daily victory limits, tournament/event rewards and automatic first-player
Training Camp progression are not implemented here.

## Verification and practical limits

The [recorded report](native-battle-runtime.json) separates native evidence from
Android evidence. `npm test` covers a real TCP Training, queue/cancel, two-human
matchmaking, input rejection, reconnect, forfeit/winner and persisted rewards.
The reconnect regression also checks that a pending input included in a snapshot
is not announced a second time to that client.

The native client test decodes the original snapshot, consumes actual `26980`
messages through the original parser/consumer, advances the original client
simulation and matches the server checksum with no desync callback over 400
ticks. Only the Android GameClient singleton and desync UI callback are adapted.

Additional verification loaded/decoded snapshots for 53 level geometries,
constructed all 46 NPCs marked TrainingMatchAllowed, completed a native battle
at tick 2890 (3–1 crowns), and executed each of the 95 unlocked cards through the
original spell executor. The isolated card fixture puts a card in hand and sets
time/mana explicitly; this does not prove every possible card interaction.
Team geometry probes use four players, including the unused 3v3 map. These
checks do not establish Android UI correctness. No Android device is available
in the cloud workspace; actual Training/Battle loading and controls still need
the supplied phone run.

```bash
npm test
npm run lint
node tools/check-server.js
npm run battle:verify -- --all-locations --all-trainers --all-cards --full-match
```

`battle:verify` executes original game code and can take several minutes.
Node 18.20.8 was separately checked with VM startup, a native Training worker,
snapshot, ten ticks and forfeit. The main cloud suite runs on its installed Node.

For the phone, the next useful events are `battle-created`,
`battle-snapshot-acknowledged`, `battle-input-accepted` and `battle-finished`.
`battle-checksum-mismatch` triggers an authoritative snapshot resync rather than
trusting the client state. A successful native test is not confirmation that
Android accepted the battle screen.

## Image provenance and rebuilding

The checkpoint is produced by [build_battle_image.py](../tools/reverse/build_battle_image.py)
from the locally retained, fully linked `native-csv-linked-state` checkpoint and
decoded APK data. It loads visual/tile CSVs with original `0x49b630`, saves the
original memory regions, exports the source catalogue, and records PLT imports.
This is an optional offline reverse-engineering tool using the existing Python
analysis environment; it is not invoked by the Node server or npm install.

```bash
GAME_ANALYSIS_DIR=/path/analysis /path/venv/bin/python tools/reverse/build_battle_image.py --output /tmp/battle-image
```

The analysis directory needs the pinned `libg.so`, relocated `memory.bin`,
decoded `game-data-verified`, and the fully linked CSV checkpoint described in
[the snapshot investigation](battle-snapshot.md). The output mirrors
`server/battle/{image,imports.json,catalogue.json}`. The checked rebuild reproduced the source catalogue, imports, heap and all three
native-memory block hashes exactly. Verify block hashes and run the runtime tests
before replacing a committed image. The WebAssembly dependency is the upstream
[Unicorn.js](https://github.com/AlexAltea/unicorn.js), licensed GPL-2.0; its
packaged license and source remain available through that dependency.

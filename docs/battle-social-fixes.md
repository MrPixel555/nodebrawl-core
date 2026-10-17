# Return Home, reconnect, progression and clan messages

The supplied device now runs Training and online 1v1. Its result OK button
sends **18100**, which previously had a verified codec but no handler. It now
returns a freshly loaded, authoritative **21217** after settlement. Sending
18100 during an unfinished match resends that match instead of escaping to Home.

## Results and reconnect

Ladder results grant the winner 36–42 trophies and subtract the same nominal
amount from the loser, floored at zero. The amount is deterministically derived
from the server-generated match ID; this is the requested private-server policy,
not a recovered official trophy formula. Draws, Training and Party do not change
trophies. Both human accounts settle in one serialized database transaction,
including offline players. Replaying settlement for the same retained match ID
does not grant another reward. History retains up to 1,000 results.

Ladder and Party crowns, including crowns earned by the loser, advance the existing free
Pass crown state. Gold, highest trophies, total ranked games, wins, losses and
three-crown wins persist. Home and Profile now bind their original Avatar
fields and statistics commodity group rather than advertising static zeroes.
Legacy accounts derive missing statistics/trophies from their retained ladder
history; saved current counters take precedence. Keep the account database.
The existing tier-zero 500-gold claim continues working. Chest, token, skin and
other higher-tier reward delivery is still incomplete; crown progress alone
does not implement those rewards.

Production login now sends **LoginOk + current SectorState** for an unfinished
owned match, without first sending Home. Pending inputs in the reconnect
snapshot are not broadcast a second time. A finish racing this login selects
updated Home after settlement. Disconnecting every human no longer disposes a
running match after 60 seconds: the authority continues and records its result.
Missing initial snapshot acknowledgements start the authority at the 30-second
loading deadline instead of cancelling the owned match. Late clients receive a
current snapshot before sector updates resume. If it finished while absent, the next login receives updated Home. Live match
ownership/simulation remains in memory: restarting the Node process does not
restore an unfinished match. Completed results remain on disk.

## Clan exchanges

| Request | Implemented behavior |
| --- | --- |
| 11632 | Persist text chat; send native stream entry 21749 to online members only |
| Login into a clan | Send full clan data and persisted chat history 21822 |
| Command 715 | Persist clan mail to every current member's mailbox; send 28299 to online members |
| 11712 | Return the authenticated player's persisted mailbox, including offline delivery |
| 13882 | Validate/persist description, badge, region, type and trophy requirement; refresh online members with 28165 |

Mail and settings require leader/co-leader. Mail follows the source 43,200-second
cooldown and 256-byte text limits. Text chat retains 100 entries; mail retains
50 per player. Names, mail and chat bodies are not written to console logs.
Badges update every persisted member's Home/Profile membership data.

`verify_social_stream.py` executes the original nonempty chat, history and
mail decoders/encoders, including Persian text. These are newly supported
stream subsets; other stream entry types, full clan membership operations,
donations and wars remain separate work. The new screens need device testing.

## Party and emotes

The initial Home simulation clock is zero. Previous Party event start times
were Unix timestamps starting at 1,600,000,000, so the original availability
filter rejected them. Events 1002 (2v2) and 1001 (Double Elixir) now begin at zero
and end in 2037. The original filter 0x6de484 accepts both at the initial clock;
0x551634 selects an actual available CASUAL event. Queues and battle modes use
the existing native engine. Android Party rendering needs verification.

Home now supplies two available, owned emote definitions and selected slots,
using `emote1` exports actually present in the supplied `ui.sc` and
`season_3_legendary_dl.sc`. Private pack IDs 10001/10002 distinguish these
verified resources without inventing historical official pack mappings. Paths
point to the existing fingerprint's SC assets; SC checksums match their header
and decoded data. Their definitions/ownership/deck also travel in battle Home
bound data, including reconnect snapshots. Command 912 has an original-codec
verified descriptor/slot schema; selected slots persist. Command 565 marks the
collection seen without granting currency or ownership.

This is **two emotes**, not the complete historical emote catalogue. Native
codec, ownership, selected-slot and export checks pass; texture loading,
download/rendering and emote interaction on Android have not been verified.
The optional `emotes:false` Home-provider argument retains the original empty
native manager for comparison fixtures; production enables definitions.

## Validation

753 Node tests and ESLint pass. The complete original native combat check
finished 3–1; 400 online client/server ticks matched checksums. The TCP checks
cover direct battle login, offline settlement, result return, clan fanout and
persistence. Native Home/Profile getters and nonempty social codecs also pass.

## Reproduction

```sh
npm test -- --test-concurrency=2 --test-timeout=120000
npm run lint
node tools/verify-battle.js --full-match
node tools/check-server.js
```

Optional offline analysis uses the retained supplied binary/checkpoints:

```sh
GAME_ANALYSIS_DIR=/workspace/game-analysis /workspace/game-analysis/venv/bin/python tools/reverse/verify_social_stream.py
GAME_ANALYSIS_DIR=/workspace/game-analysis /workspace/game-analysis/venv/bin/python tools/reverse/verify_battle_social_state.py
GAME_ANALYSIS_DIR=/workspace/game-analysis /workspace/game-analysis/venv/bin/python tools/reverse/verify_dynamic_home.py
```

The runtime stays Node.js/WebAssembly; Python is for offline verification only.
No APK, configs.so, signing key, server peer key or account reset is required.
Pull `main` and restart the server. The user-confirmed standalone APK remains
unchanged by these fixes.

# Clan search and recovered request formats

Authenticated name-search request **16592** now receives **25074**, echoing the
query and an initialized empty clan list. The server currently has no clan
creation/membership implementation or clan records; an empty result is accurate.
This completes the network search exchange. The Android clan UI has not yet been
exercised against this handler.

The IDs come from the supplied library:

- Name-search UI builders `0x18148c`/`0x4b4e44` construct the request through
  `0x3954ec`, whose vtable is `0xa3b5a8` and native message type is 16592.
- The 25074 branch in dispatcher `0x71e538` enters at `0x720384`. Its list goes
  through `0x694358` to `0x7425e4`, which uses `TID_ALLIANCE_SEARCH_EMPTY`.
- Creation UI `0x5e7090` constructs 10453 through `0x1c3f4c`. Its two strings,
  badge reference, two VInts and location reference are encoded by `0x6c12fc`.
- Settings request 13882 has one string, badge reference, two VInts and location
  reference, encoded by `0x4a1128` and decoded by `0x3ccde4`.

Creation strings use native limits 15*4 and 140*4 UTF-8 bytes. Settings uses a
900000-byte wire string limit. Codec bounds are distinct from gameplay validation
of names/descriptions. Badge references use table 16; locations use table 57.
Create/settings handlers remain absent until membership, costs, account/Home
bindings and response semantics are implemented.

25074 serializes a query string and a nullable VInt-counted list of clan headers.
Header codecs `0x32ea04`/`0x4b5a14` write a fixed-width Long ID, name, badge
reference, ten VInts, table-1/table-57 references, a boolean, three VInts and four
packed booleans. Unknown semantics retain native field offsets in
`lib/protocol/alliances.js`. The decoder bounds the list at 10000. Null wire lists
and empty allocated lists are distinct; the live handler always sends the latter.

`verify_alliances.py` runs the original codecs twice per fixture. Seven fixtures
cover Persian UTF-8, settings text beyond the creation limit, nonzero badge and
location references, two headers with signed VInt boundaries/packed booleans,
and empty/null lists. CSV tables 16/57 are explicit lookup adapters. This proves
the wire formats, not synthetic scores/IDs as gameplay or full Android UI.

Encrypted TCP tests send startup receipts, English/Persian searches, turns and
heartbeat on one session. Actual CLI smoke also exercises startup receipts and
empty search before heartbeat, in plaintext and nacl17 modes. Core decoding now
uses the complete codec registry; EndClientTurn retains atomic handler treatment
of unknown nested commands.

```bash
GAME_ANALYSIS_DIR=/workspace/game-analysis /workspace/game-analysis/venv/bin/python tools/reverse/verify_alliances.py
npm test
npm run lint
```

Training/battle simulation, matchmaking, purchases, clan creation/membership/chat
and progression still require server rules and additional state. Wire codec
coverage is reported separately from those handlers.

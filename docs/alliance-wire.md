# Clan search and recovered request formats

The runtime clan search route is **14783 -> 24184**, returning an allocated
empty header list because clan creation/membership and stored clans remain
unimplemented.

**Correction:** request **16592 is a name preflight**, not a clan search.
The previous 16592 -> 25074 pairing was wrong and left the naming dialog waiting.
Native naming submit `0x4b4e44` builds 16592; the proper reply is **20821**.
[Native dispatch evidence and verification](name-check.md).

The clan wire evidence retained here is independent of that mistaken pairing:

- The 25074 branch in dispatcher `0x71e538` enters at `0x720384`. Its list goes
  through `0x694358` to `0x7425e4`, which uses `TID_ALLIANCE_SEARCH_EMPTY`.
  Its codec remains verified, but no request pairing/runtime handler is claimed.
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
and empty allocated lists are distinct. No live 25074 response is currently sent.

`verify_alliances.py` runs the original codecs twice per fixture. Seven fixtures
cover Persian UTF-8, settings text beyond the creation limit, nonzero badge and
location references, two headers with signed VInt boundaries/packed booleans,
and empty/null lists. CSV tables 16/57 are explicit lookup adapters. This proves
the wire formats, not synthetic scores/IDs as gameplay or full Android UI.

## Advanced search (14783 -> 24184)

The user's newer device trace sends **14783**. Its full codec includes a query,
table-57 region, six fixed int32 filters, two booleans, another string, a vector
of VInt Long IDs and three string vectors. Native encoders/decoders are
`0x3ed2f4`/`0x24b2dc`. Server strings are limited to 1,024 UTF-8 bytes; vectors
use the normal 10,000-entry bound. Native wire limits can be larger.

This search requires **24184**, containing only a nullable header vector.
It does not use the query-bearing 25074 response. UI submit `0x714e0c` builds
14783 through `0x747884`. Dispatcher branch `0x720d7c` consumes 24184 via
`0x46fec8`, which forwards the list to that search popup's `0x1166f4` consumer.
The live handler sends an allocated empty list for the still-empty clan store.

The probe now verifies **12 fixtures**, including both search responses with
nonempty/empty/null header lists and advanced request filters with Persian text,
negative/fixed-width integers, non-null region, ID vectors and string vectors.
Encrypted TCP tests exercise the advanced exchange and a subsequent heartbeat.
Clan creation, membership and chat remain unimplemented.

Encrypted TCP tests send startup receipts, naming checks, advanced clan search, turns and
heartbeat on one session. Actual CLI smoke exercises naming preflight, final
name/deck turns and heartbeat in plaintext and nacl17 modes. Core decoding now
uses the complete codec registry; EndClientTurn retains atomic handler treatment
of unknown nested commands.

```bash
GAME_ANALYSIS_DIR=/workspace/game-analysis /workspace/game-analysis/venv/bin/python tools/reverse/verify_alliances.py
npm test
npm run lint
```

Training/battle simulation, matchmaking, remaining shop actions, clan creation/membership/chat
and progression still require server rules and additional state. Wire codec
coverage is reported separately from those handlers.

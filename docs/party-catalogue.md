# Party event metadata and catalogue codec

The supplied library calls event category **20** `CASUAL` in native enum-name
function `0x23a400`. Generic event factory `0x71d0c8` constructs its handler via
`0x582078`, vtable `0xa53cb0`. Its JSON decoder `0x6d57d4` reads a **`GameMode`**
name and an optional `Background` object. Targeting is parsed separately.

The probe resolves `DoubleElixir` to **72000001** and `TeamVsTeamLadder` to
**72000023** using the original native game-mode table/name lookup. Both records
have `ValidPartyMode=true` in this APK's `game_modes.csv`. There are no
substituted game-data lookup functions. These are tested metadata examples,
not a complete Party schedule or matchmaking implementation.

`lib/protocol/event-catalogue.js` implements the nested catalogue's revision,
counted event list and complete generic event fields, including four time values,
notification IDs, optional JSON, targeting and scheduling/group identifiers.
It preserves opaque JSON text without interpreting event-specific business logic.
Limits of 1,000 events, 64 KiB per string and 1 MiB total are server policy.

The original catalogue encoder/decoder (`0x524ba0`/`0x23da1c`) and event codecs
(`0x412a70`/`0x35c298`) consume/reproduce all bytes of three fixtures. They cover
an empty catalogue, two CASUAL modes, Persian UTF-8, negative and multi-byte
VInts, targeting flags and absent JSON. The metadata-only null-JSON case binds
the native optional pointer to null explicitly; JSON decoding by itself creates
an empty String for a missing key. It is not an available Party event.

```bash
GAME_ANALYSIS_DIR=/workspace/game-analysis \
  /workspace/game-analysis/venv/bin/python tools/reverse/verify_party_catalogue.py \
  --checkpoint /workspace/game-analysis/native-csv-raw-state
node --test test/event-catalogue.test.js
```

The checkpoint argument is optional; without it the tool parses the original
game-mode CSV directly. `native_strings.py` discovers and runs 183 selected
String initializers from the pinned library; this does not initialize the
Android platform or all game state.

[Native evidence](native-party-catalogue.json) records scope and functions.
The default Home still advertises an empty event catalogue. Targeting/time
filters, the Android Party UI, event availability, matchmaking and battle
snapshots remain unverified. The new nested codec does not increase the count
of fully supported message IDs or establish playable Party battles.

## Server-friend prefetch when opening Party

The user observed **16442** while opening the Party menu. Its constructor
`0x31618c` is called by `0x33c938`; that request asks for server friends. The
corresponding list message **21047** encodes a fixed int32 type and fixed int32
count, then nested friend entries. Type zero selects dispatcher `0x720b48`,
which moves the list into controller `0xd54310` through `0x6e4584` and refreshes
listeners through `0x1d5274`. Other types select external social providers.

The server has no friend relations and now replies with **type zero, count
zero**, eight bytes. `verify_empty_friends.py` executes the original codecs
(`0x5e5f88`/`0x204f78`), empty-list consumer and listener refresh. The complete
nonempty friend codec remains unresolved in the registry; this supported empty
case is not counted as a full new codec. Encrypted TCP tests compare the actual
response to the native fixture. This completes the prefetch exchange; the Home
event catalogue is still empty and Party battles are still unimplemented.

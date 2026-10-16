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

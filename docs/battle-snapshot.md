# Deferred GameMode snapshot and battle investigation

Message **28991** loads a GameMode snapshot through a deferred consumer. Its
virtual encode (`0xfb52c`) and decode (`0x200810`) return without touching the
embedded ByteStream. The previous flat-schema extractor incorrectly classified
this as an empty-body message. The catalog and extractor now mark its full
codec unresolved. Historical empty-method fixtures remain regression evidence
for this distinction; they do not establish a valid empty battle packet.

Native dispatcher `0x71e538` routes this message through `0x51ccc8`, which
switches the GameStateManager to state 5 and passes the message to
`0x742f2c -> 0x540850`. Getter `0x1c9004` returns message+0x10, the embedded
stream. The consumer resets its offset, reads one byte, and takes either path:

| Flag | Native path | Remaining bytes |
| --- | --- | --- |
| 0 | `0x2e66ac` | Raw GameMode snapshot |
| 1 | `0x23fc3c -> 0x6a21bc -> 0x2e66ac` | Signed int32 **little-endian** decompressed length, then zlib stream |

The original code treats flags other than 1 as raw too. The Node envelope
helper accepts only canonical flags 0/1. It bounds the wire body to 1 MiB and
the decompressed snapshot to 4 MiB, validates positive declared lengths and
zlib integrity, and rejects truncated, oversized, concatenated or trailing
compressed data. The inner snapshot remains an opaque Buffer. These are server
resource limits, not recovered native game limits.

After invoking the outer consumer, `0x51ccc8` constructs **15263** via
`0x145f08`, vtable `0xa2e478`, and sends it. This identifies a snapshot
acknowledgement; it does not prove completion of UI loading or a playable battle.

## Native verification

```bash
GAME_ANALYSIS_DIR=/workspace/game-analysis \
  /workspace/game-analysis/venv/bin/python tools/reverse/verify_sector_envelope.py
node --test test/sector-state.test.js test/protocol.test.js
```

[The native report](native-sector-envelope.json) records exact functions and
scope. The probe executes the original getter, virtual methods, flag consumer,
compressed-stream wrapper and native zlib decompressor. Its one adapter replaces
`0x2e66ac` with a capture of the bytes handed to the world loader. The fixtures
use explicitly synthetic probe bytes, **not a valid game world**. Both paths
deliver exactly the source bytes; the acknowledgement constructor's type getter
returns 15263.

## Remaining work

`tools/reverse/verify_training_map.py` now executes the original LevelData
constructor, source assignment and terrain parser `0x21ba6c` on the APK's
Training arena and tile map. [The map report](native-training-map.json) verifies
the **36 x 64** dimensions and all **4,608 values** in both masked terrain
arrays against an independent CSV reader. Original native CSV getters also
return four PrincessTower and two KingTower source coordinates. Inputs are
pinned to the decoded APK hashes; no game-code/row lookup adapter is used.

```bash
GAME_ANALYSIS_DIR=/workspace/game-analysis \
  /workspace/game-analysis/venv/bin/python tools/reverse/verify_training_map.py
```

Those coordinates are not instantiated towers. This check does not establish
their HP, ownership, targeting, collision, players or a valid battle snapshot.

The raw loader reads an optional initialization section through `0x6123b8`, then
the full state through `0x431508`. Its world branch calls `0x546890` and depends
on game-data tables, players, decks, towers, commands and simulation state.
No verified initial NPC/PvP world has been built yet. The server does not send
28991 with empty or synthetic data. Training, normal matchmaking, Party, battle
simulation and rewards remain unimplemented. Transport/envelope support must
not be counted as a complete battle codec or gameplay handler.

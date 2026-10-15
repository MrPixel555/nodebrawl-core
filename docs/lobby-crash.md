# Home decodes, then lobby event lookup crashes

The device opened LoginOk and decoded all **623** old Home bytes. Its actual
Android data tables resolved the intended eight cards, five decks, level 1 and
Arena1. GL-thread UI initialization then crashed at `libg+0x243198`, reading
address `0x14`, with X0 equal to 8. [Device evidence](device-home.json) is sanitized.

The native chain `0x4c29a0 -> 0x551634 -> 0x243178` reads the event manager at
Home +0x4f8 and its catalogue at manager +0x10. Helper `0x4596f4` adds 8 to the
catalogue pointer; a count load at +0xc then faults. The previous seed encoded
the catalogue presence flag as false. The decoder permits this; the UI query
assumes it exists. Codec round trips did not establish this UI state invariant.

`starter_home.py` now runs native catalogue constructor `0x6a22ec`, whose empty
list has revision -1 and count 0, and installs it before the original Home
encoder runs. This adds **two bytes**, giving **625** for account [0,37]/name
Player. Variable identities can change the total. No executable code, integrity
check or null check is patched. No unavailable timed event is advertised.

`verify_lobby.py` uses the actual Node provider. Its negative case re-encodes an
absent catalogue, successfully consumes all 623 bytes, and reproduces the exact
device PC, X0 and fault address through the original query chain. NativeVM maps
an ELF snapshot from zero; this test protects the null page to match Android.
The positive case consumes/re-encodes all 625 bytes and runs both native UI
queries without the fault. [Native evidence](native-lobby-regression.json)
records both cases. This executes identified queries with CSV adapters, not the
entire Android UI and assets. The corrected lobby still needs a device run.

The ready root `client-dev.js` is **network-v5**, using the same address/public
key and crypto/thread strategy. Home observations additionally report
`eventsPresent` and `eventCount`; expect `true` and `0` for the corrected starter.

## Post-login messages

The device sent 10459 and 11485 before the crash; the supplied server trace did
not disconnect because they were unsupported.

10459 encoder `0x21c2d4` delegates to `0x610f54`: an inline string followed by a
JSON serialization string. Decoder `0x581cc4`/`0x12f990` bounds these at 1024 and
900000 bytes. Two native round trips cover string-valued JSON and Persian UTF-8.
Node preserves the JSON string; it does not reproduce native JSON formatting
or initialized literal globals. The authenticated startup handler validates
JSON, discards values and logs only `client-metadata-accepted` and payload size.

11485 has an empty native codec and is sent by UI startup function `0x59edb8`
before constructing a tab. Its handler validates the body and logs
`client-ui-startup-notice`. It invents no response and does not treat this as
proof that loading finished. Encrypted TCP tests cover both receipts followed
by turns/heartbeat and ensure metadata values are not logged.

These receipts do not implement clan, matchmaking, training simulation or shop
purchases. Those require their own recovered schemas and server rules.

Reproduce in the retained analysis environment:

```bash
GAME_ANALYSIS_DIR=/workspace/game-analysis /workspace/game-analysis/venv/bin/python tools/reverse/starter_home.py
GAME_ANALYSIS_DIR=/workspace/game-analysis /workspace/game-analysis/venv/bin/python tools/reverse/verify_lobby.py
GAME_ANALYSIS_DIR=/workspace/game-analysis /workspace/game-analysis/venv/bin/python tools/reverse/verify_startup.py
GAME_ANALYSIS_DIR=/workspace/game-analysis /workspace/game-analysis/venv/bin/python tools/reverse/verify_starter_transport.py
```

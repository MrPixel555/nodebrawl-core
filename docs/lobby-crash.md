# Home decodes, then lobby initialization crashes

## First crash: absent event catalogue

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
entire Android UI and assets. A subsequent device run confirmed the catalogue
is present, its count is zero, all 625 bytes decode, and heartbeat succeeds.
That run exposed the separate level-state failure described below.

## Second crash: Home level zero, Avatar level one

The next device crashed at **0x549830**, reading **0x2c2c2c2283** with X0
**0x2c2c2c2273**. The stack includes `0x66aec8`, `0x4746a8` and `0x4b8ee0`.
[Sanitized device evidence](device-home-v5.json) preserves the distinction
between the successful decoder/heartbeat and the failed lobby UI.

The native command registry identifies executor **0x474628** as command **805**.
It compares Avatar +0xd8 with Home +0x3c8. The previous native-encoded Home left
the latter at the seed's **zero**, while Avatar was explicitly level **one**.
For execution flags 3, the executor consequently requests level **two** through
`0x4bdba4`. That helper passes old/new levels to `0x66ae80`, which calls
`0x15b324` for each. The lookup subtracts one: level zero becomes row **-1**.
The returned invalid pointer reaches `0x54982c`, whose load at +0x10 is the
device's crashing instruction. The native CSV initializer at `0x603d64` binds
this helper's column to **QuestSlots** in `exp_levels.csv`.

The generator now sets **Home +0x3c8 = Avatar +0xd8 = 1** before the original
encoder runs. This changes exactly **one byte** and leaves the small-identity
Home length at **625**. Changing only packet length checks would miss this bug.
Native decoder/re-encoder round trips continue to match all six fixtures.

`verify_home_level.py` runs the actual Node provider through native decoding.
Its negative case re-encodes the prior zero-level state, then executes command
805 and observes row indices **[-1,1]**. The CSV adapter supplies the device's
invalid pointer for -1 so the original load reproduces its PC/address/register;
this explicitly does **not** emulate Android allocator contents. The corrected
state executes the same command for flags **1,2,3**, returns zero each time,
leaves Home at level one, and never requests a level-data transition. The test
also runs the original QuestSlots helpers on valid CSV rows for levels 1–3.
[Native regression evidence](native-home-level-regression.json) records this.

The starter server accepts command 805 as an unchanged successful operation
only within its fixed level-one profile. It can coexist with deck selections
without causing an otherwise supported turn batch to be dropped. This does not
implement experience gain or level-up rewards. Unsupported commands still leave
the whole batch unapplied.

The ready root `client-dev.js` is **network-v6**, with the same address/public
key and crypto/thread strategy. Home observations now report **homeLevel** in
addition to `level`, `eventsPresent` and `eventCount`; expect **1,1,true,0**.
The full Android lobby remains unverified until the corrected state runs on
the device. No game executable or native checks are patched.

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

The newer trace also contains **11712** (one fixed-width Long) and **13752**
(VInt and string). Their wire codecs already exist. 11712 is constructed during
UI setup at `0x59f208`; 13752 is constructed at `0x682ae8`, where a native float
is converted to an integer and a socket-related string is supplied. Their server
business behavior and response contracts are still unresolved, so the server
continues to identify them as unsupported rather than inventing replies. Neither
appears in the observed crashing native call chain.

Reproduce in the retained analysis environment:

```bash
GAME_ANALYSIS_DIR=/workspace/game-analysis /workspace/game-analysis/venv/bin/python tools/reverse/starter_home.py
GAME_ANALYSIS_DIR=/workspace/game-analysis /workspace/game-analysis/venv/bin/python tools/reverse/verify_lobby.py
GAME_ANALYSIS_DIR=/workspace/game-analysis /workspace/game-analysis/venv/bin/python tools/reverse/verify_home_level.py
GAME_ANALYSIS_DIR=/workspace/game-analysis /workspace/game-analysis/venv/bin/python tools/reverse/verify_startup.py
GAME_ANALYSIS_DIR=/workspace/game-analysis /workspace/game-analysis/venv/bin/python tools/reverse/verify_starter_transport.py
```

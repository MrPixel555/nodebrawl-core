# Compatibility evidence for the uploaded library

The current implementation is a protocol development server for the supplied
Clash Royale library. It is **not yet a playable, fully compatible game server**.

## Library identity and reproducible findings

| Item | Observed result |
| --- | --- |
| SHA-256 of decompressed `libg.so` | `4dd79f7c143fe87dba0e3c7521fe150bf1e018783a2e04632bd38bba5dafde5a` |
| ELF build ID | `6e7c4084c38be82ffdb3e68fd64f10c71cfef2d4` |
| Platform | Android ARM64, Android 21 minimum; stripped symbols |
| Game | Clash Royale, identified from decrypted strings |
| APK version | AndroidManifest confirms `com.supercell.clashroyale`, `3.1.0`, versionCode `400` |
| Content version | Fingerprint `3.1945.13`, SHA `8f3a0350bb1c87f1676dc4571fd5a84cf6afe5dc` |
| First initializer | `0x31f934` |
| Encrypted string table | `0xcfe63c`, 21,757 ranges |
| String XOR key address / period | `0xd4663f` / 128 bytes |
| Message vtables | 286 entries, 284 unique IDs |
| MessageFactory function | `0x622544` |
| Factory observations | Created 268 unique IDs using factory flags 0 and 1; 275 creation observations |
| Flat message codecs | 155 unique IDs after rejecting duplicate base-class placeholders |
| Additional codecs | ServerHello, Login, LoginOk, LoginFailed: total 159 wire codecs |

`lib/protocol/libg-profile.json` preserves each vtable, encode/decode address,
field order/type/offset, extraction limitations, and observed factory versions.
Unidentified semantics retain names like `Message16045` and `field_0x80`.
Names, direction, enum values, and gameplay effects are not guessed from IDs.
The discovered IDs include SDK types that this game factory does not construct.

The linked [Supercell.ArxanUnprotector](https://github.com/Mimi8298/Supercell.ArxanUnprotector),
at commit `81e09a7ce52c22a4bfda82fe13f1dc6a5ddab467`, describes the range-table
and XOR mechanism used by the analysis tools. Its string decryption and checksum
tools do not implement the network protocol. The original upload is untouched.
The analysis copy does not have updated Arxan checksums and must not replace a
client library.

## What validation proves

`test/fixtures/native-flat.json` contains 310 observations: each selected flat
codec was executed with two inputs in the actual ARM64 encoder and decoder using
Unicorn. Tests compare the Node encoder byte for byte against those outputs and
check the Node decoder against their fields. Native decoders consumed exactly the
encoded payload length. The vectors include negative integers, null strings,
nonnull strings, IDs, and packed booleans.

`test/fixtures/native-extra.json` adds six successful native encode/decode/re-encode
observations for Login, LoginOk and LoginFailed, including nullable lists and byte arrays.
ServerHello's length-prefixed nonce layout was recovered from encoder `0x1d72d0`
and decoder `0x633134`. Login's encoder `0x41e914` and decoder `0x60f844` now both
pass. Earlier two-million-instruction probes stopped during the library's
integrity checks. Sparse observer hooks and a 200-million-instruction limit let
the actual checks and decoder finish, consuming all 343 or 213 bytes for the two
vectors. Re-encoding each native decoded object produced the original bytes.
No integrity checks or expected checksums were changed or bypassed. The Node implementation currently
requires the full Login layout emitted by the native encoder, rather than claiming
support for every historical truncated Login variant.

The emulator supplies memory allocation, selected libc functions, TLS storage,
and time responses. These are protocol-function observations, not an Android
runtime test. Neither a successful codec test nor MessageFactory construction
proves that a real client accepts all values or completes Home initialization.

Node tests also exercise fragmented/coalesced TCP frames, explicit LoginFailed,
account persistence, credential rejection, ordered LoginOk/Home delivery through
a **synthetic Home provider**, heartbeat, malformed frames, account concurrency,
and template integrity checks. That synthetic provider is only a transport test;
it is not a game-compatible Home packet.

## Differences from the Vitalik reference

The supplied reference's `LoginOk=20758` and `OwnHomeData=21217` match the library.
It was used for comparison, not copied as an implementation or compatibility
authority. Several important differences were observed:

- Its negative VInt algorithm encodes `-1` as `40`; this library emits `7f`.
- Its LoginOk mixes fixed-width integers with fields that the native encoder
  writes as VInts and omits later optional sections.
- It appends seven bytes `ff ff 00 00 00 00 00` after every frame. The new frame
  writer emits the seven-byte header and declared payload only.
- Its `recv(7)` and the original Node core both assume TCP read boundaries match
  packet boundaries. The new decoder buffers partial headers and payloads and
  handles multiple frames in one receive.
- Its sample player events have fixed, expired timestamps. They were not used as
  current game state.

## Outstanding compatibility work

**Cipher implementation:** `lib/protocol/salsa17.js` now implements the observed
17-round Salsa/HSalsa core, XSalsa stream, Poly1305 authenticated boxes and
Curve25519 key agreement. This is a version-specific cipher, not standard
20-round Salsa. Native core `0x35b118` confirmed 17 iterations; native seal
`0x36bc7c` and open `0x1f8f08` provided 12 vectors at plaintext lengths
0, 1, 15, 16, 17, 31, 32, 33, 63, 64, 65 and 257. Node matches the exact
ciphertext and MAC. Native decryption recovered the original plaintext and
rejected a changed MAC; Node additionally rejects wrong nonces and keys.

Native wrapper `0x6957e8` supplied four additional key-agreement box vectors.
Its observed peer coordinate in the emulator's zero-initialized BSS state was
`d33c93779ee51583730e78e83c2e5f90bc5cfc28319bd69af82226b8bb347c65`.
The key agreement and boxes match Node's Curve25519 plus HSalsa17. This peer
coordinate was observed in a specified emulator state; it has not been confirmed
after initialization in a real Android client. Fixture private keys are synthetic
test vectors, not credentials from a user or server.

**Encrypted client connection:** `lib/protocol/transport.js` now includes the
verified receive-side Login reply envelope and session encryption schedule.
`tools/reverse/verify_transport.py` executes native Messaging parser `0x250bbc`
with an input reader adapter and explicitly initialized synthetic client fields:
public key at `+0x260`, private scalar at `+0x280`, client nonce at `+0x2a0`, and
connection state at `+0x254`. Two Node-produced authenticated LoginOk replies
were accepted, decoded completely, and moved native state 4 to state 5.
The reply nonce is BLAKE2b with a 24-byte digest of `clientNonce || clientPublicKey
|| observedPeerPublicKey`. Its plaintext is a 24-byte server nonce, 32-byte session
key and the original message payload. The native parser cleared 112 bytes of
handshake state and installed both session cipher objects.

Four subsequent Node-encrypted KeepAliveOk frames were accepted by that native
parser. Four native client-side session ciphertexts matched Node byte-for-byte.
Both directions increment their independent 24-byte little-endian nonces by two
before each message. Replay, modified MAC, carry propagation, and nonce exhaustion
are covered by Node tests. Native cipher and counter implementations are
`0x106fe0`, `0x6554f8` and `0x397e50`.

**Outgoing Login and server transport:** native function `0x3affd4` now completes
with native key generation, RNG initialization, Curve25519 and authenticated box
creation. The ServerHello nonce length at Messaging `+0x230` is a 64-bit value;
an earlier probe incorrectly supplied two 32-bit values, resulting in an
oversized copy. Correct ABI initialization resolved that probe. The function's
public key matches Node X25519, its shared key matches Curve25519 plus HSalsa17,
and its nonce matches BLAKE2b-192 of `clientPublicKey || observedPeerPublicKey`.
The native plaintext is `serverHelloNonce[24] || clientNonce[24] || LoginPayload`.
The native heap contains the wire body `clientPublicKey[32] || compactBox`.
`tools/reverse/verify_login_envelope.py` executes this path without skipping native
checks and compares its result against Node with `tools/check-native-login.js`.

`server/transport.js` now integrates the envelope and session ciphers with TCP
behind `TRANSPORT=nacl17`. New Login validates the authenticated echo of the
ServerHello nonce. LoginOk and LoginFailed both use the first reply envelope.
A separate native parser probe accepted encrypted LoginFailed, consumed all 28
bytes, and reached state 5. Plaintext LoginFailed probes in that state failed
authentication. These negative probes are not counted as successful observations.

Native transport startup creates a development private key once, using an
exclusive temporary file and atomic hard-link publication with private permissions.
Only the public key is printed. No official server private key is derived or
required: a client must use this development public key through a matching
runtime adapter. The original observed peer still has the emulator context stated
above and is not assumed to match the running Android process.

**Development peer adapter:** `tools/make-client-trace.js --server-public-key`
generates an optional Frida mode. Stalker callouts change the raw key-agreement
argument immediately before BL at `0x3bcc68` and `0x27eab4`, and the handshake
nonce arguments at `0x3bcc84` and `0x27ead4`. The Messaging pointer is read from
the parent stack at `SP+0x60` for outgoing Login and `SP+0x3b0` for the reply.
These slots are asserted against the native VM's actual Messaging object.
Temporary shared-key/nonce buffers are erased after their native consumer returns.
Neither the original executable instructions nor the file on disk are patched.
Portable X25519 used
by the script is compared against Node's crypto implementation for eight pairs;
portable BLAKE2b is checked against Python hashlib at block boundaries.

`tools/reverse/verify_development_peer.py` applies the same argument overrides in
the protocol VM. The original native outgoing Login was decrypted by the actual
Node NativeTransport with a development server key. Native Messaging then
accepted the Node-encrypted LoginOk, canonical empty Home (416 bytes consumed),
and KeepAlive. State advanced to 5 and ordinary session cipher functions executed.
The connection caller's initial state is set explicitly by the harness.
[Adapter observation](native-development-peer.json) records the scope.
The VM also asserts that every executable PT_LOAD byte is unchanged. This proves
the protocol argument transformation in that model, not Android Stalker execution
or an Android UI test. The actual Stalker helper separately passed an optional
Frida 17.23.3 Linux x86-64 smoke test: a native call's argument changed and its
original code stayed identical. Reproduce with `python3 tools/check-frida-stalker.py`
on Linux x86-64 with Python `frida` and `cc` installed.

**OwnHomeData:** the native encoder/decoder call nested LogicClientHome and
LogicClientAvatar serializers. A further probe showed that the avatar decoder at
`0x43bda4` requires exactly nine commodity groups; this is a literal constant,
not the number of rows in `resources.csv`. Supplying that count allowed a zero
seed to decode. Native re-encoding yields a canonical 416-byte empty Home.
Decoding that canonical output consumes all 416 bytes, and re-encoding is stable.
`tools/reverse/verify_home.py` reproduces this observation without bypassing the
count check. This has zero-initialized game globals, empty cards and decks; it
has not been accepted by an Android client and is not installed as a default Home.
Game-state initialization, nested variable data and command processing remain.

**Uploaded APK:** all four parts were received and their hashes and the final
104,298,365-byte APK were verified. Its SHA-256 is
`dce6a6bf55e7021f6410438e47adf69e1e0c6120bc34f8c3457350e2366178c1`.
The bundled ARM64 library has SHA-256
`6020d2fb42fa13c81ac755cbec31621b3b104ebfdbfb65ae4b1a4356b7b0a46a`.
It is byte-for-byte identical to the strings-decrypted analysis copy of the
original upload. The difference is encrypted string data, not another executable
protocol implementation. This comparison does not prove the APK launches or
passes its runtime integrity checks.

All 149 CSV files were decompressed using Supercell's LZMA-alone variant, which
stores a four-byte uncompressed length. All 1,075 present fingerprint assets
matched their SHA-1 entries. Another 125 listed files are absent from this APK;
these include high-resolution textures. Missing files are reported explicitly.
The decoded tables include 52 named resource records, 72 character spells,
17 building spells, 20 other spells, six hero spells, 38 arenas, and 203 game modes.
Rows and continuation rows are distinguished; table IDs and gameplay effects
are not guessed from filenames. The original assets are retained outside Git.
[APK evidence](apk-evidence.json) records identities and per-table counts/hashes.

Reassemble, inspect and decode an APK without optional analysis dependencies:

```bash
python3 tools/apk-transfer.py join /path/client.apk.manifest.json --parts-directory /path/parts --output .local/client.apk
python3 tools/inspect-apk.py .local/client.apk --output .local/apk
python3 tools/apk_data.py .local/apk --output .local/game-data
python3 -m unittest discover -s test/python -v
```

The inspection tool validates archive paths and CRCs, extracts assets to a new
directory and reads literal manifest identity fields from binary Android XML.
The data tool verifies present fingerprint assets before decoding bounded LZMA
streams, writes CSVs and a `game-data.json` inventory, and refuses existing output.
Neither tool verifies APK signature cryptographic validity or publisher identity.
No Android emulator or `adb` is installed in this environment; Java alone does
not run an ARM64 Android client. Client connection and gameplay remain unverified.

## Reproduce analysis

```bash
python3 -m venv .local/analysis-venv
.local/analysis-venv/bin/pip install -r tools/requirements-analysis.txt
.local/analysis-venv/bin/python tools/analyze-lib.py /path/to/libg.so.xz --output .local/analysis
```

The tool verifies the supplied library hash before using the version-specific
offsets, decrypts strings in a separate analysis copy, extracts the vtable catalog,
derives flat field schemas, reruns 314 native observations including duplicate
base entries, and executes the factory. It fails if a flat native codec check
fails. Generated files stay in the chosen output directory. The driver also runs
the additional Login and LoginOk/Failed probes with schemas exported from
`lib/protocol/messages.js`, including native re-encoding, and reproduces the
cipher and key-agreement vectors. Unexpected failures make the tool fail.

## Device diagnostics and operational fixes

The reported Android 14 ARM64 crash occurs at an indirect call from `libg+0x514b30`
inside the integrity checker beginning at `0x5148ac`, before encrypted Login.
The user confirmed that the same APK runs without the old script. The checker's
range table at `0xbeefd4` has 83,788 entries covering 8,780,931 bytes; all seven
old inline hook prologues intersect those ranges. `inspect_hook_integrity.py`
reproduces this static finding. [Coverage report](native-hook-integrity.json)
records the exact intersections. A PC inside Android's CFI shadow is the invalid
branch destination here; it is not evidence of a failed Android CFI check.
The crash target and integrity checks are not patched or suppressed.

The revised script uses libc hooks for sockets and Stalker call-site probes for
the development peer. Without a development key there are no native-library
probes and no Stalker activity. With a key, GL threads are discovered by name and
game-socket threads at libc callbacks, and tracing stops after the first reply's
authenticated-open returns. ART is kept visible so its JNI callbacks remain
traceable. This temporary tracing can slow loading. Architecture, build ID and
all call-site instructions must match before probes activate. A key-pair check
guards reads of the Messaging slots. A profile mismatch leaves the peer unchanged.
The IPv4 target redirect handles IPv4 and IPv4-mapped IPv6 sockets on port 9339.
Private keys, account tokens and payload contents are not logged. Events use
console output, captured by Frida CLI `-o`; ordinary Android logcat is not that
console. See README for device commands and the public-key distinction.

The original inline-hook script is confirmed to crash on the user's device.
The revised Stalker script still requires a new Android test; no successful
device Login or playable Home has been observed.

The native VM models single-thread mutexes, condition notifications, static
initialization guards and reads from `/dev/urandom`. Contention, unrelated file
access and unsupported imports fail explicitly. Native calls have instruction
and time limits; outgoing Login allows 120 seconds because native key generation
and the protected path take substantially longer than a flat codec.

The server validates configuration before accepting clients, bounds frame batches,
and assembles fragmented frames without repeatedly copying the buffered payload.
Account writes from multiple Store instances sharing one resolved directory are
serialized within one process. Invalid databases are rejected without rewriting.
LoginOk/Home frames are validated as a batch before writing either frame. A client
disconnected during an asynchronous Home provider is not counted as authenticated.
Tests reproduce those failure cases and encrypted TCP login, ordered Home,
heartbeat, encrypted missing-Home failure and concurrent persistent-key creation.

The current server deliberately refuses login without a compatible Home provider.
No shipped fixture or native-empty Home is presented as a playable player state.
Game handlers, player initialization and battle simulation remain incomplete.

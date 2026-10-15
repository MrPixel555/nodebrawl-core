# Content delivery and Training protocol evidence

The user confirmed that network-v6 displays Home on the supplied Android device.
[Device evidence](device-lobby.json) records that result separately from VM tests.
The subsequent Training/download-failure trace contains startup messages,
heartbeat and repeated metadata reports, but no observed Training request. It
does not establish which missing asset causes the failure or that Training's
server-side game logic has executed.

## Original content and HTTP delivery

The APK fingerprint is `8f3a0350bb1c87f1676dc4571fd5a84cf6afe5dc`, version
`3.1945.13`. Its original manifest contains 1,200 entries. The checkout includes
the 1,075 available original files, totaling 91,265,310 bytes, and records the
125 absent entries in [the inventory](../content/inventory.json). Absent files
include `sc/map_dl.sc`, additional character assets and high-resolution textures.
The server pins the complete manifest's SHA-256 as well as its version and SHA;
each present file must match its original SHA-1 before it is served.

`npm start` binds the game on 9339 and HTTP content on 9338. `CONTENT_URL` is the
URL reachable from the phone; the checked-in development value is
`http://223.223.223.1:9338`. It is independent of `CONTENT_HOST`, the bind address.
Both TCP ports must be reachable. `CONTENT_ROOT` can point to another directory
containing the same original `fingerprint.json` and `assets/` layout.

LoginOk now carries this URL in native vectors `field_0x128` and `field_0x130`.
The native LoginOk dispatcher reads them through getters `0x434c58` and
`0x4c0ea8`, at calls `0x722864` and `0x7230ec`. The former flows through
`0x65a108` into the configuration collection at `0x118a18()+0x280`; the latter
reaches its collection at +0x298. Their broader business semantics are not
inferred from those offsets. The encrypted native Messaging test accepts both
populated vectors and compares their decoded UTF-8 values with Node's source
values; [the report](native-starter-transport.json) records
`nativeContentUrlVectorsMatched: true`. Phone HTTP delivery still needs a device
run with this server update.

HTTP GET/HEAD support the original fingerprint and manifest-listed assets at
`/<asset-path>`, `/<fingerprint>/<asset-path>` and
`/<individual-file-SHA1>/<asset-path>`. Assets are sent in their original stored
format, with byte ranges, content length, SHA-1 ETags and immutable caching.
Unknown paths and traversal are rejected. A changed or corrupt file is not
served as a valid asset. `.gitattributes` disables line-ending conversion for the
pinned manifest and assets, including on Windows checkouts.

When a file is absent, an optional HTTPS upstream can supply
`/<fingerprint>/<asset-path>`. On-demand requests are deduplicated, with four
active downloads, bounded queue/body size and timeout. A temporary file is
published atomically only when its original SHA-1 matches; existing files are
never overwritten. The default development upstream is
`https://game-assets.clashroyaleapp.com`. **Its availability and retention of
this old content have not been verified.** This environment's egress proxy
rejected the attempted CONNECT with 403. That is not a CDN 404 and does not prove
the files are unavailable at the origin. An additive domain allowance was saved
in the environment draft; saving a draft does not apply it to the running task.

To prefetch from an accessible source preserving that layout:

```bash
node tools/fetch-content.js --base-url https://game-assets.clashroyaleapp.com
```

The command exits nonzero for missing, corrupt or failed files. To use another
verified HTTPS mirror, set `CONTENT_UPSTREAM_URL` and use its base URL for the
prefetch command. No missing files have been fabricated or marked restored.
`content/inventory.json` describes the original APK baseline; runtime startup
rescans actual files, so successful later downloads reduce the runtime missing
count without changing that historical inventory.

## Download diagnostics

Message 10459 carries an event name and serialized JSON. Native content-event
builder `0x1ca158` uses `label`, `type`, `product` and `productDetail`; the product
`download_url` supplies the URL in `productDetail`. Failure builder `0x53e98c`
adds `failCode` as a decimal string. The relevant phase strings are
`ContentDownloadStarted`, `ContentDownloadFailed` and `ContentDownloadSucceeded`.
The original JSON serializer escapes forward slashes; the added native fixture
preserves that representation and Node parses it without altering the semantics.

With `TRACE_NETWORK=1`, the handler records only a recognized download phase,
bounded numeric error code, hostname and manifest-listed asset path. It discards
queries, credentials and arbitrary metadata. `content-file-served`,
`content-file-missing` and `content-download-failed` identify the HTTP outcome.
The `13752` native builder at `0x682aac` multiplies a measured float by 1000 and
includes a socket-derived string. Its validated receipt is now handled without
retaining the string or inventing a response. Message 11712 remains unresolved.

## Recovered Training requests

`0x2b1ef8` is identified by the native `startTrainingCampMatch failed - No Npc
found!` diagnostic. It selects an eligible record from CSV kind 18, the NPC
table. The observed outgoing branches are:

| Message | Native encode / decode | Wire fields | Current server behavior |
| --- | --- | --- | --- |
| 17967 | `0x6ed88c` / `0x7499d4` | DataReference kind 18 at +0x80 | Verified codec; no battle handler |
| 10953 | `0x1cfe5c` / `0x2c68c0` | DataReference kind 79 at +0x80, kind 18 at +0x88 | Verified codec; kind 79 business meaning unresolved |
| 12405 | `0x480d04` / `0x410668` | Two VInts, bounded native command list | HomeLogicStopped codec; no transition handler |

The 17967 branch runs through `0x5ebae8 -> 0x41c7d4`; the extra-data branch
constructs 10953 through `0x246340 -> 0x1b5568`. HomeLogicStopped uses the same
nested command format as EndClientTurn, but has no trailing byte-array field.

Six fixtures execute the original ARM64 encoders and decoders twice. NPC lookup
uses the supplied table's actual named-row order; kind 79 uses explicitly
synthetic data objects to establish the reference format, not a usable game
mode. The HomeLogicStopped fixtures cover empty and mixed 703/805 command lists.
Malformed lengths, unknown commands and trailing data are rejected in Node.

These codecs do **not** implement the battle-start response, simulation,
matchmaking or results. During analysis, message 22177 was traced to UDP setup
and message 22871 to a BattleResult handler; neither is assumed to be a Training
start packet. No guessed packet is sent to force the client past a state check.
[The full catalogue](packet-coverage.json) lists all 284 message IDs, 167 verified
wire codecs and the actual runtime handlers separately. There are also 135
native command IDs with 89 verified command codecs; only 703/805 have starter
runtime behavior.

## Reproduce the checks

```bash
npm test
npm run lint
node tools/check-server.js
node tools/packets.js --json
GAME_ANALYSIS_DIR=/workspace/game-analysis /workspace/game-analysis/venv/bin/python tools/reverse/verify_training.py
GAME_ANALYSIS_DIR=/workspace/game-analysis /workspace/game-analysis/venv/bin/python tools/reverse/verify_startup.py
GAME_ANALYSIS_DIR=/workspace/game-analysis /workspace/game-analysis/venv/bin/python tools/reverse/verify_starter_transport.py
```

The CLI check starts isolated real servers and validates encrypted starter login,
both URL vectors, byte-exact HTTP fingerprint/assets, post-login messages and
heartbeat. It also checks disabled-Home encrypted login and plaintext starter
mode. It preserves the existing server key and account directory. Node's 613
tests include HTTP ranges, caching, corrupt/escaped paths, verified download
publication, concurrent fetch deduplication and shutdown cancellation. Native VM
checks require the retained analysis environment and original library; ordinary
startup uses only the checkout and Node 18+.

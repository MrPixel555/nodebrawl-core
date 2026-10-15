# Content delivery and Training protocol evidence

The user confirmed that network-v6 displays Home on the supplied Android device.
The latest network-v8 run also confirms content downloads complete; its server
trace includes a Training NPC request 17967 and unresolved command 595. See
[the current player-feature scope](player-state.md). The failure history below
precedes that successful download run.
[Device evidence](device-lobby.json) records that result separately from VM tests.
The subsequent network-v6 trace reports MandatoryDownloadStarted/Failed for
`sc/map_dl.sc`, `sc/level_2019_halloween_dl.sc` and other files with error code
zero. No asset HTTP receipt or Training request appears in the supplied server
trace. The user confirms the same phone browser displays
`http://223.223.223.1:9338/fingerprint.json`. Browser access establishes basic
reachability, not the app's network policy.

## Restored original content

The APK fingerprint is `8f3a0350bb1c87f1676dc4571fd5a84cf6afe5dc`, version
`3.1945.13`. Its unchanged manifest contains 1,200 entries. The APK provided
1,075 files (91,265,310 bytes); [the original inventory](../content/inventory.json)
preserves the 125 absent entries. After the environment's network change,
the original CDN returned 200 for `sc/map_dl.sc`. All 125 absent files were then
retrieved over verified HTTPS and matched their original SHA-1 entries.

The checkout now contains **all 1,200 original assets, 176,402,252 bytes**, with
**zero missing files**. [Restoration evidence](content-restoration.json) records
the source, 125 per-file sizes/SHA-1/SHA-256 hashes and the unchanged manifest
hash. The largest file is 7,148,412 bytes. No replacement assets, patched game
files or changed fingerprints were used. The server pins the complete manifest's
SHA-256 and checks every present file before it is served. `.gitattributes`
disables line-ending conversion for assets and the pinned manifest on Windows.

To verify files and restore any entries later deleted from the checkout:

```bash
node tools/fetch-content.js --base-url https://game-assets.clashroyaleapp.com
```

In this Node 24 cloud environment, the successful restore used
`node --use-env-proxy tools/fetch-content.js --base-url https://game-assets.clashroyaleapp.com`
to honor the configured HTTPS proxy. The tool preserves certificate and original
SHA checks, bounds concurrency/body size/timeouts, deduplicates on-demand work
and atomically publishes verified files without overwriting existing files.
The result was `present:1075, downloaded:125, failed:0`. A repeat uses only
verified local files and does not redownload them.

## Android policy and the advertised HTTPS URL

The supplied APK manifest has min SDK 16, target SDK 28, no
`usesCleartextTraffic` opt-in and no `networkSecurityConfig` reference. On
Android 9+, this manifest does not permit cleartext HTTP by default. See the
[Android network security configuration documentation](https://developer.android.com/privacy-and-security/security-config#CleartextTrafficPermitted).
The server's previous default advertised `http://223.223.223.1:9338`, which was
incompatible with that default policy despite working in the browser.

DEX analysis identifies the actual HTTP path:
`NativeHTTPClientManager.startGetRequest` creates `com.supercell.titan.cz`.
Its private `c()Z` opens a Java HttpURLConnection and calls `getInputStream()`
at bytecode offset 0x22, then `getResponseCode()` at 0x30 and stores the result
in field `h:I` at 0x38. Field h initially contains zero. `run()V` catches a
request exception and reports failure; an exception before the response code
leaves h at zero. Thus error zero does not mean an HTTP server returned status
zero. The device exception text was not captured, so the exact thrown exception
remains unobserved. [Sanitized evidence](device-download-failure.json) distinguishes
static findings and device observations. `tools/inspect-apk.py` now reports
literal manifest network attributes without optional Android-analysis packages;
external referenced security XML is explicitly unresolved.

The default advertised URL is now **`https://game-assets.clashroyaleapp.com`**.
Both LoginOk URL vectors receive this base URL. Clients download the original
content over trusted HTTPS directly from the CDN. Existing environment variables
survive a Git pull: replace a previously set HTTP URL explicitly in Windows CMD:

```bat
set CONTENT_URL=https://game-assets.clashroyaleapp.com
npm start
```

The game TCP endpoint remains `223.223.223.1:9339`; the server key and ready
Frida script are unchanged. The user subsequently confirmed download completion on the phone with network-v8. No TLS trust check or Android network policy is
bypassed. For independent content hosting, put the complete local content service
behind a trusted HTTPS reverse proxy and set CONTENT_URL to its HTTPS base URL.
The HTTP listener on 9338 remains useful for internal checks; advertising it
directly produces a startup explanation about this APK's policy.

LoginOk native getters `0x434c58` and `0x4c0ea8` read vectors field_0x128 and
field_0x130, at dispatcher calls `0x722864` and `0x7230ec`. The former flows
through `0x65a108` into the configuration collection at `0x118a18()+0x280`;
the latter reaches +0x298. Their broader business semantics are not inferred
from those offsets. The encrypted native Messaging test accepts both populated
HTTPS vectors and compares their decoded UTF-8 values with Node's source
values; [the report](native-starter-transport.json) records the URL and
`nativeContentUrlVectorsMatched: true`.

The local HTTP service supports GET/HEAD of the original fingerprint and
manifest-listed assets at `/<asset-path>`, `/<fingerprint>/<asset-path>` and
`/<individual-file-SHA1>/<asset-path>`. Byte ranges, content length, SHA-1 ETags
and immutable caching preserve the original bytes. Unknown/traversal paths and
corruption are rejected. `content-http-response` records status, method and a
known asset name or fixed route category for every completed local response,
including rejected paths. It does not retain unknown paths, queries, addresses
or headers. Malformed HTTP yields a fixed diagnostic without raw request data.
With the default HTTPS CDN URL, phone asset requests correctly do not appear in
the local HTTP log; client metadata still reports known download phases.

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
| 10953 | `0x1cfe5c` / `0x2c68c0` | PvE reference kind 79 at +0x80, NPC kind 18 at +0x88 | Verified codec; no battle handler |
| 12405 | `0x480d04` / `0x410668` | Two VInts, bounded native command list | HomeLogicStopped codec; no transition handler |

The 17967 branch runs through `0x5ebae8 -> 0x41c7d4`; the extra-data branch
constructs 10953 through `0x246340 -> 0x1b5568`. HomeLogicStopped uses the same
nested command format as EndClientTurn, but has no trailing byte-array field.

Six fixtures execute the original ARM64 encoders and decoders twice. NPC lookup
uses the supplied table's actual named-row order. The native file manifest
`0x3f8548` now identifies kind 79 as `csv_logic/pve_gamemodes.csv`; the harness
uses its actual record order too. These are still lookup adapters, not a
constructed playable game mode. [Native CSV verification](native-csv.md) checks
the original parser and record constructors separately. The HomeLogicStopped
fixtures cover empty and mixed 703/805 command lists.
Malformed lengths, unknown commands and trailing data are rejected in Node.

These codecs do **not** implement the battle-start response, simulation,
matchmaking or results. During analysis, message 22177 was traced to UDP setup
and message 22871 to a BattleResult handler; neither is assumed to be a Training
start packet. No guessed packet is sent to force the client past a state check.
[The full catalogue](packet-coverage.json) lists all 284 message IDs, 166 verified
wire codecs and the actual runtime handlers separately. There are also 135
native command IDs with 91 verified command codecs; starter runtime supports
563/703/805 and initial naming 948. These actions do not start a battle.
Message 28991's deferred raw/zlib GameMode stream and acknowledgement 15263
have since been identified; its former empty-body classification was wrong.
Its full snapshot remains unresolved. See [the native battle path](battle-snapshot.md).

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
mode. It preserves the existing server key and account directory. Node's 614
tests include HTTP ranges, caching, corrupt/escaped paths, verified download
publication, concurrent fetch deduplication and shutdown cancellation. Native VM
checks require the retained analysis environment and original library; ordinary
startup uses only the checkout and Node 18+.

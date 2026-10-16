# AvatarStream and name-confirmation diagnosis

Message **11712** carries one fixed-width Big Endian account ID pair. Its native
constructor is `0x535908`, encoder `0x65f3b0`, decoder `0x48bc08`. Lobby entry
constructs it at `0x59f208`, takes the Home account ID and sends the request.
It contains no name string. The user repeated the operation and confirmed this
message occurred before entering/submitting the name.

The response is **28299**, encoded by `0x2ebe8c` and decoded by `0x2326c8`.
Its first VInt counts polymorphic stream entries. This server has no stream
entries, so it responds with **`00`**, an allocated list with zero entries.
The original stream consumer `0x6e6968` accepts that list, sets its loaded flag
at `+0x24`, transfers ownership from the message and frees it. The probe runs
this twice against the same manager to check repeated loading.

An absent list encoded as `7f` is unsafe: decoding it succeeds, but the native
consumer dereferences null at `0x6e6ab8`. The probe explicitly verifies this
negative case with page zero unreadable. An empty packet is also not the native
empty-list format. [Probe report](native-avatar-stream.json).

Only the authenticated account may request its stream. Foreign account requests
fail validation. No balance, name or account state changes. There is no invented
battle history, clan invitation or stream reward. Nonempty entry codecs and
their gameplay remain unresolved, so the general 28299 codec remains marked
unresolved in the packet catalogue.

## Naming preflight blocker identified and corrected

The later TRACE_NETWORK device log establishes the failure before final 948:
**16592 arrived and the server incorrectly sent 25074**. This is a candidate-name
check, and its proper response is **20821**, with a false error flag for success.
The original naming listener advances to the next confirmation screen when it
receives that response. The old clan reply never calls that listener.
See [the native probe, runtime fix and retest instructions](name-check.md).

The investigation below explains why the earlier 11712/595 observations alone
could not identify this failure. The 595 Arena1 boost is a separate operation.


The final name callback `0x2b7f38` constructs **948**, copies the UTF-8 name and
queues it through `0x6037ec`. `verify_name_submission.py` executes that original
path with text-widget, GameClient and queue-capture adapters. This establishes
the command created by that callback, not that the Android dialog reached it.
Command 595 has no name string; its original callers include the Trophy Road
UI and an automatic branch during lobby entry.

A turn may contain both 948 and an unsupported 595. The server rejects the
complete batch atomically; accepting only the name would misrepresent the
client's predicted state. Previously the log hid supported commands in that
rejected batch. It now records `turnCommandIds` alongside `commandIds` and a
bounded `unresolved-command-data` event with 595's public selectors, even with
network tracing disabled. It never logs the name, command-base account IDs or
complete payload. The fix does not claim naming is working on the device.

The subsequent device report contained only `turnCommandIds:[595]`, with
`field_0x28:[54,1]`, selectors `-1/-1` and `field_0x30:false`. Thus that turn
was not a rejected mixed naming batch. It is the automatic Arena1 chest-speed
boost branch, now implemented with persistent native Home state; see
[Arena1 boost](arena-boost.md). Other 595 branches remain unsupported. This
observation still does not establish that the device sent a name command.

Keep app data, `.local/accounts` and the existing key when updating. Repeat the
final name confirmation and inspect `starter-name-set`, `starter-turn-rejected`,
or `unsupported-turn` with `turnCommandIds` and the adjacent selector event.

## Verification

Run native probes with the retained matching library and Python environment:

```sh
GAME_ANALYSIS_DIR=/workspace/game-analysis /workspace/game-analysis/venv/bin/python tools/reverse/verify_avatar_stream.py
GAME_ANALYSIS_DIR=/workspace/game-analysis /workspace/game-analysis/venv/bin/python tools/reverse/verify_name_submission.py
```

TCP tests cover repeated self requests, exact native response bytes, unchanged
stored state, rejection of another account's request, and encrypted request/
response sequencing alongside Home and KeepAlive. Rejected mixed name/595 turns
retain both command IDs without persisting the name or leaking it in logs.

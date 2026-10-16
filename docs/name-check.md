# Candidate-name preflight and final naming

The supplied TRACE_NETWORK device log pinpoints the gray OK button: after Home,
the client sends **16592**, but the previous server replies **25074**. That reply
belongs to clan search and never advances the naming listener. The earlier
16592/clan-search classification was wrong. Request 11712 and command 595 are
separate operations.

The handler now replies **20821**, version 0, with:

| Field | Accepted | Invalid candidate |
| --- | --- | --- |
| `field_0x7c`, bool | false | true |
| `field_0x80`, fixed BE int32 | 0 | 1 |
| `field_0x88`, nullable string | null | null |
| Plain payload hex | `0000000000ffffffff` | `0100000001ffffffff` |

The false flag means success. This polarity is verified against the original
consumer, rather than inferred from a field name. The handler uses the same
local name validation as final command 948: nonempty/non-whitespace, at most
200 UTF-8 bytes and no ASCII control characters. This is a development-server
format policy, not the official profanity/availability service. The native UI
also applies its own input restrictions.

A candidate check never writes account state or charges currency. Final
confirmation still queues command **948**, which atomically persists the first
name, nameSet=true and name-change count 0. Later paid renames and automatic
Training Camp onboarding remain incomplete. Do not erase app data or `.local`.

## Native evidence

`tools/reverse/verify_name_check.py` executes the matching original ARM64 code
with page zero unreadable:

- First-screen submit `0x4b4e44` constructs 16592 through `0x3954ec` and queues
  the UTF-8 candidate. Its codecs are `0x5ac59c` / `0x4c0af0`.
- 20821 codecs `0x3ceba0` / `0x30b20c` consume and reproduce all nine bytes.
- Full dispatcher `0x71e538` reaches the 20821 branch at `0x71fcc0`, obtains
  the active listener through original `0x22febc` / `0x148784` and inspects
  the error flag at `0x71fcec`.
- A false flag reaches `0x7224c4`, invokes listener vtable +0x10, then original
  `0x61e61c` / `0x67494c` opens naming screen stage 1 with the same UTF-8 text.
  A true flag with reason 1 instead invokes the invalid-name text callback.
- Two success dispatches and one error dispatch are checked. An unrelated
  25074 dispatch with no connected clan manager leaves the naming state unchanged.

UI window lookup, text-widget lookup, asset construction/screen push, localized
text display and network queue capture are explicit adapters. The original
message routing, listener lookup and success transition execute unchanged.
This verifies the native route to the next screen, not Android rendering or
all subsequent confirmation screens. [Machine-readable report](native-name-check.json).
The separate [final-name callback probe](native-name-submission.json) verifies
948 construction; Node TCP tests verify persistence across a new server/store.

```sh
GAME_ANALYSIS_DIR=/workspace/game-analysis /workspace/game-analysis/venv/bin/python tools/reverse/verify_name_check.py
npm test
npm run lint
```

Tests compare exact native wire fixtures, accepted/rejected checks, unchanged
account storage before final submission, encrypted message sequencing and
subsequent heartbeat. Candidate names and credentials are absent from logs.
CLI smoke checks run preflight then final naming/deck/boost turns and profile
over both plaintext and nacl17 with isolated accounts.

## Device retest

Pull the update and restart the server. Use the existing key, account data and
Frida script. Enter the name and continue through the client's confirmation
screens. With network tracing, expect **16592 -> 20821**. The server also logs
`name-check-result` with only an accepted boolean, even when network tracing is
off. Final completion should produce **13597 containing 948** and
`starter-name-set`. A check result alone does not establish that the final name
was saved. Device verification of this correction remains pending.

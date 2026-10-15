# Commands in the supplied library

The native diagnostic strings identify EndClientTurn, whose message vtable
`0xa48b18` returns ID **13597**. Its encoder `0x520928` and decoder `0x17c560`
use two VInts, a VInt command count (maximum 512), commands, and a length-prefixed
optional byte array. These commands have no individual size prefix. An unknown
command cannot be skipped while reliably locating the following command.

`lib/protocol/command-profile.json` records 135 command types created by native
factory `0x41a1dc` over IDs 1 through 1000. Of these, 89 straight-line codecs
have two complete native encode/decode/reencode observations. Two branched
codecs (563/595) are now overlaid from `command-extra.json`, with independent
native fixtures. The merged catalogue has 91 verified codecs and 44 unresolved
types. This is codec coverage, not 91 implemented gameplay actions. Nothing is inferred from the sample server's
usual IDs.

The shared command encoder `0x25079c` writes fields +0x10 and +0xc as VInts and
the inline pair at +0x14 as two VInts. Parent `0x68d558` adds +0x1c before that
prefix. Child fields can precede or follow their parent, including strings and
packed booleans; their exact order is recorded. Helper `0x1032d8` writes an inline
pair as fixed-width BE integers, which differs from the VInt pair. Field names
remain native offsets where semantics have not been established.

## Implemented starter behavior

`HOME_MODE=starter` registers EndClientTurn and command **703**, SelectDeck.
Its final VInt at +0x1c selects deck 0 through 4. Native executor `0x32f870`
checks the five-deck feature, changes Home through `0x48f950`, and notifies the
observer. The [native observation](native-select-deck.json) runs that original
executor and Home collection logic: three changes succeed, a repeated selection
returns 4 without a callback, and indices 5/-1 return 3 without a change. The
CSV lookup objects, enabled feature setting and observer callback are explicit
VM adapters, not the initialized Android game.

The server persists selected index, all five card arrays, resources and name
state under the existing serialized atomic account store. Fresh accounts are
unnamed; legacy accounts preserve their identity and previously advertised name
status. Native command **563** now updates deck contents and active card order;
**948** persists the first name (-1 -> 0 name-change counter) without spending
resources. Subsequent paid renames, purchases and card upgrades remain unsupported.
[Player state and profile evidence](player-state.md) describes the exact native
validation/executors and the 12373 -> 22757 Profile route. Complete native Home
fixtures include a fresh unnamed account and non-default resources/reordered
cards. Real TCP tests cover naming, profile, rejected batches and persistence
across stopping and replacing the server/store.

Empty turns are accepted. All commands in a batch are decoded and checked before
any account mutation. An unsupported known command, unknown codec, or non-null
extra data leaves the whole batch unapplied, with metadata-only diagnostics.
Invalid counts, truncated payloads, invalid UTF-8 and invalid deck indices are
rejected. The server does not invent acknowledgements for the native client
prediction path. It does not yet validate the simulation checksum or command
sequence semantics; do not use this development handler as a competitive game
authority.

Command **805**, executor `0x474628`, synchronizes Home +0x3c8 with Avatar +0xd8.
With both at one, it returns zero unchanged for execution flags 1/2/3. The starter
handler accepts this operation alone or alongside deck selection, without an
account write for 805 alone. This is specific to the fixed starter level; it
does not implement level progression. The
[native level regression](native-home-level-regression.json) also demonstrates
why encoding Home level zero caused the next device lobby crash. See
[the call chain and CSV adapter limits](lobby-crash.md).

Command 595's data-reference/boolean wire layout now passes native round trips,
but its business behavior is still unresolved and is not applied. Android
rendering of the new profile, name-dialog timing and deck interactions remain
unverified. Battle, Training and Party still require separate implementation.

## Reproduction

Ordinary Node startup uses the committed profile/fixtures and needs no APK:

```bash
node tools/packets.js --commands
npm test
npm run lint
```

With the retained analysis workspace and its Python environment:

```bash
GAME_ANALYSIS_DIR=/workspace/game-analysis /workspace/game-analysis/venv/bin/python tools/reverse/commands.py
GAME_ANALYSIS_DIR=/workspace/game-analysis /workspace/game-analysis/venv/bin/python tools/reverse/verify_turns.py
GAME_ANALYSIS_DIR=/workspace/game-analysis /workspace/game-analysis/venv/bin/python tools/reverse/verify_player_commands.py
```

The factory harness disables only an optional debug-log flag so unknown IDs
return null without Android formatted logging. Library code and integrity
checks are not patched. Unknown native helpers or control flow are never replaced
with guessed codecs.

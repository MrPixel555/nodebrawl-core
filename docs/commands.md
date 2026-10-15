# Commands in the supplied library

The native diagnostic strings identify EndClientTurn, whose message vtable
`0xa48b18` returns ID **13597**. Its encoder `0x520928` and decoder `0x17c560`
use two VInts, a VInt command count (maximum 512), commands, and a length-prefixed
optional byte array. These commands have no individual size prefix. An unknown
command cannot be skipped while reliably locating the following command.

`lib/protocol/command-profile.json` records 135 command types created by native
factory `0x41a1dc` over IDs 1 through 1000. Of these, 89 straight-line codecs
have two complete native encode/decode/reencode observations. The remaining 46
retain `fields: null` and the extraction reason. This is codec coverage, not
89 implemented gameplay actions. Nothing is inferred from the sample server's
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

The server persists the last selection in `account.starter.selectedDeck` under
the existing serialized atomic account store. Old account files default to deck
0 without migration or credential replacement. Repeated selections do not
rewrite the file. Reconnection binds that index into a full native-encoded Home;
the six complete Home fixtures include decks 1 and 4. Plaintext and encrypted
TCP tests send turns, verify heartbeat nonce progression, and confirm persistence.

Empty turns are accepted. All commands in a batch are decoded and checked before
any account mutation. An unsupported known command, unknown codec, or non-null
extra data leaves the whole batch unapplied, with metadata-only diagnostics.
Invalid counts, truncated payloads, invalid UTF-8 and invalid deck indices are
rejected. The server does not invent acknowledgements for the native client
prediction path. It does not yet validate the simulation checksum or command
sequence semantics; do not use this development handler as a competitive game
authority.

Name-change command 948 has a verified string codec and an identified native
executor, but its price, cooldown, counter and notification behavior are not
implemented. Deck-content command 563 remains a nested unresolved codec. Thus
choosing another starter deck persists; rearranging its cards and renaming a
player do not yet persist. Device lobby and interaction results are still pending.

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
```

The factory harness disables only an optional debug-log flag so unknown IDs
return null without Android formatted logging. Library code and integrity
checks are not patched. Unknown native helpers or control flow are never replaced
with guessed codecs.

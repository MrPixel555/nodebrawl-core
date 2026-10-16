# Persistent starter player state and profile

The supplied network-v8 trace reaches Home, and the user confirms content
downloads complete. The attached server trace still shows unsupported request
17967 (Training), request 13006, request 11712, and command 595. The 11712 request
now has a verified empty AvatarStream response. The subsequently observed 595
Arena1 boost branch is now supported; Training and the other listed battle paths
remain incomplete. The accompanying
report names broken Party, battles, emotes, profile and onboarding. These are
separate missing features; a successful Home decode does not implement them.

## Persistent state and commands

Accounts retain five deck arrays, selected deck, gold, gems, free gems, name-set
status, name-change count and the one-time Arena1 boost in
`.local/accounts/accounts.json`. Initial gold and
gems are 100; seeing those values twice does not establish an account reset.
Previously Home always encoded 100. It now encodes the persisted balances, with
independent native fixtures covering 8192 gold, 37 gems and 21 free gems. There
is now a native-verified gold-pack transaction (command 687) that changes these
balances. Battle rewards and other shop actions remain open. Invalid stored balances fail validation instead of silently
falling back to 100. Existing account IDs, tokens, names and server keys survive.

Fresh accounts start with Avatar `+0x14d` (`nameSet`) false and `+0x150`
(`nameChangeState`) -1. The previous template advertised an already named player.
Original validation `0x2160d4` and price calculation `0x67956c` permit the initial
name without a level, gems or cooldown. Executor `0x19b0a0` for command **948**
sets the name, nameSet and count -1 -> 0, leaving gems unchanged. The server
implements that initial naming operation. Later paid renames, cooldown and
progression remain unimplemented. Legacy accounts keep their previously
advertised named state; they are not deleted or forced through onboarding.
The user subsequently confirmed that the initial-name dialog never appears;
the flag alone is insufficient. The original lobby also checks tutorial
BattleInfo type 102. [Current naming diagnosis](unlocked-cards-and-shop.md).
The starter Avatar still advertises seven NPC wins (`+0x144`, JSON `npcWins`),
which intentionally bypassed Training during lobby bring-up. Changing that to
zero without implementing the tutorial battle would strand new players before
Home. This is a starter account flow, not completed fresh-player onboarding.

Command **563** encodes the base fields, deck index, count 0 or 8, eight global
card IDs, an inline fixed Long, a packed flag and optional Long. Original executor
`0x6750b0` checks ownership, duplicates and availability, updates the requested
deck and selects it. Its native execution also rearranges the active card
collection. The provider now binds **both** the five deck arrays and the active
collection's spell ordinals. The handler now accepts eight distinct cards from
all 95 unlocked collectible spells and persists the complete validated batch
atomically. Foreign deck operations and upgrades remain unimplemented.
Command 703 and unchanged level synchronization 805 still work.

Command **595** has native-verified wire decoding and now supports the observed
`field_0x28:[54,1], field_0x30:false` branch. It grants the one-time 24-hour
Arena1 `ChestSpeedUp` boost, with persistent claim and remaining-time fields in
Home. Fully linked native CSV execution verifies its initial grant and repeat
rejection; it does not change a name or currency. Other 595 reward branches
remain unsupported. [Implementation and native evidence](arena-boost.md).
Unknown or unsupported commands and non-null turn extra
data leave the whole batch unapplied; no acknowledgement is invented for native
client prediction. Command checksums and sequence validation remain incomplete.
`unsupported-turn.commandIds` lists unsupported commands, while the new
`turnCommandIds` lists **all** commands in that rejected turn. For example,
`commandIds:[595], turnCommandIds:[948,595]` means initial naming was decoded
but rejected along with the unsupported command, so it did not persist.
`unresolved-command-data` reports up to eight of unresolved 595 branches' public game-data
references and selection fields even without TRACE_NETWORK; base fields,
player names and full payloads stay private. The native Trophy Road UI uses
595 (`0x524554`), and lobby entry can also enqueue it (`0x59f610`). Neither
occurrence establishes what the device submitted when confirming a name.

The user clarified that 11712 precedes name confirmation and is unrelated to
that action. The original final-name callback `0x2b7f38` constructs command
948, owns a copy of the submitted UTF-8 string, and queues that command through
`0x6037ec`. A [native probe](native-name-submission.json) verifies that path
with explicit text-widget/client/queue adapters. It does not verify Android
dialog navigation or prove which commands the supplied device sent. The next
device log had `turnCommandIds:[595]` alone, with the Arena1 boost reference.
It does not contain a submitted 948, so the mixed-turn hypothesis did not
explain that observation. The next network trace established the actual blocker: request 16592 received
the unrelated clan response 25074. The corrected **16592 -> 20821** preflight
advances the original native naming listener to the next confirmation screen.
The candidate check does not persist the name; final command 948 does.
[Native response dispatch and test evidence](name-check.md). Android confirmation
of this correction remains pending.

## Player Profile route

Native profile UI constructor `0x72f064` creates request object `0x4d7dbc` at
`0x72f4d4`. Its vtable `0xa350a8` returns message **12373**, carrying the target
fixed Long. UI receiver `0x1c65ec` compares the reply type with `0x58e5`
(**22757**) and dispatches it to profile rendering `0x1078e4`. That routine takes
the profile Home from `+0x88` (`0x6d628c`) and Avatar from `+0x90` (`0x14cad0`).

The server handles **12373 -> 22757** using the saved account name, selected deck
and card collection. It generates a native-backed starter profile with those two
required objects present. Full native decoder `0x11c3bc` consumes all bytes;
encoder `0x37e848` reproduces them. Complete fixtures cover Persian UTF-8,
multi-byte IDs and different active decks. Profiles omit account tokens, creation
dates and actual private gold/gem balances. This provider implements starter
profiles, not every optional nested object or clan/season statistic. The general
22757 codec remains unresolved in the coverage catalogue.

Missing accounts receive **26360**, reason **2**, with the requested ID. Native
missing-player UI `0x1b1788` checks that reason at `0x1b17e0` before showing
`popup_profile_deleted`. Message **11712 is not this profile request**; its
startup occurrence is an **AvatarStream request**. The self-only handler sends
28299 containing an allocated empty list. Both codecs and the original stream
consumer accept it, including a repeated response. This is separate from name
registration and Player Profile; [native details](avatar-stream.md).

## Validation and outstanding features

`tools/reverse/starter_home.py` generates Home/profile templates and complete
native fixtures. `tools/reverse/verify_player_commands.py` runs the original
initial-name and deck-content executors with explicit CSV/context/observer
adapters. [The execution report](native-player-state.json) records those limits.
No Android UI or full game-data initialization is emulated by these adapters.
The [network-v8 device observation](device-network-v8.json) predates these new
features and must not be used as proof that their Android UI works. The newer
[device report](device-feature-report.json) separately confirms Player Profile
rendering on the prior push. Expanded inventory and its updated card-count
statistic still need device validation.

TCP tests allocate an account, set its name, reorder a deck, request its profile,
stop the server, start a different server/store, then verify saved name, deck,
resources and identity. Invalid/unsupported batches leave the file unchanged.
CLI checks cover naming, deck contents and profile over nacl17 and plaintext,
with isolated temporary accounts and keys.

| Requested feature | Current status |
| --- | --- |
| Home and original content downloads | User confirmed on Android, network-v8 |
| Persistent resources/name/five decks | Implemented and native/TCP verified, including gold-pack transactions |
| Arena1 24-hour chest-speed boost, command 595 | Native/TCP verified with persisted remaining time and one-time claim; User observed arena-boost-claimed; remaining-time UI not verified |
| Name preflight 16592 -> 20821 and final command 948 | Native dispatch and TCP/restart verified; Android retest pending; automatic tutorial prompt remains incomplete |
| Player Profile | User confirmed rendering before the expanded inventory update |
| Normal battle, Training, Party | Battle-start state and simulation still missing |
| Automatic Training Camp onboarding | Requires the missing battle-start and tutorial flow |
| Emotes | Native Home `+0x640` manager identified; catalogue/asset metadata still missing |
| Shop, progression, clan creation/membership/chat | Still unimplemented |

The empty native emote manager sends zero inventory and eight empty selected
slots. Native `0x197c34` serializes it; `0x472f78 -> 0x562a4c` resolves selected
slots against its inventory. Emote items contain two asset descriptors, not just
a numeric ID. `offline_emotes.csv` lists asset pack filenames/counts; it does not
establish owned IDs, export names or hashes. No guessed emote asset or empty
battle packet is sent to claim those features work.

Keep the existing account directory and key when updating. Do not clear app data
or `.local` for this change. Check `starter-name-set`, `starter-deck-updated`,
`player-profile-sent` and `starter-turn-rejected` events. These log no player
names, tokens or resource values.

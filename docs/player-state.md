# Persistent starter player state and profile

The supplied network-v8 trace reaches Home, and the user confirms content
downloads complete. The attached server trace still shows unsupported request
17967 (Training), request 13006, request 11712, and command 595. The accompanying
report names broken Party, battles, emotes, profile and onboarding. These are
separate missing features; a successful Home decode does not implement them.

## Persistent state and commands

Accounts retain five deck arrays, selected deck, gold, gems, free gems, name-set
status and name-change count in `.local/accounts/accounts.json`. Initial gold and
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

Command **595** now has native-verified wire decoding, including its data
reference and packed boolean. Its business meaning and executor dependencies
remain unresolved, so it is still rejected atomically as an unsupported action.
It is not labelled a Party or matchmaking action merely because it was observed
near a Training attempt. Unknown or unsupported commands and non-null turn extra
data leave the whole batch unapplied; no acknowledgement is invented for native
client prediction. Command checksums and sequence validation remain incomplete.
With TRACE_NETWORK enabled, `unresolved-command-data` reports up to eight of
595's public game-data references; base fields and full payloads stay private.

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
startup occurrence remains separately unresolved.

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
| Initial name state and command 948 | Native/TCP verified; initial Android dialog still missing |
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

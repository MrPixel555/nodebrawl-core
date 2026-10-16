# Unlocked cards, gold packs and reconnect verification

The user confirmed that the previously pushed Player Profile displays. The
latest Home now includes all **95** collectible, non-`NotInUse` spells from
tables 26/27/28: 65 character, 12 building and 18 other spells. This development
policy also unlocks ElixirGolem, whose CSV release marker is `Soon`. Internal
disabled rows and Hero/ability tables are not granted as collectible cards.

The active deck remains eight cards. Home's inventory vector at `+0x138`
contains the other 87, in source order. Changing the selected deck rebuilds
both sections; no spell appears in both. All five decks accept eight distinct
cards from this set and are persisted. Cards retain native internal level zero;
rarity-specific display levels are resolved by the client. Upgrade/progression
commands are not implemented by unlocking the inventory.

`tools/reverse/unlocked_home.py` executes complete native Home decode/re-encode,
asserts all inventory IDs and active/inventory disjointness, and emits typed
bindings plus original per-card codec bytes. Fixtures cover Persian names,
multi-byte IDs, changed resources and decks using newly unlocked cards. A
profile fixture also verifies a deck containing those cards. The Node-generated
expanded Home passed native Messaging decryption and complete decoding through
`verify_starter_transport.py`. Android inventory rendering remains unverified.

## Gold packs: command 687

The original command encoder `0x11a520` writes base fields, then a table-55
reference using `0x66be6c`; decoder `0x3750a4` resolves that table. The native
executor is `0x1be468`, and its price getter is `0x6dbd14`.

| Reference | Pack | Gold | Gems |
| --- | --- | ---: | ---: |
| 55, 0 | Gold1 | 1,000 | 60 |
| 55, 1 | Gold2 | 10,000 | 500 |
| 55, 2 | Gold3 | 100,000 | 4,500 |

`verify_resource_packs.py` uses fully linked original game-data tables, not
substituted pack/price/resource lookups. It verifies successful gem spending,
free-gem clamping, insufficient-gem rejection (native result 5), and the
5,000,000 gold cap (result 6). The native executor delegates gold credit through
listener slot `+0x18`; the probe captures its exact resource/amount/cost
arguments. It does **not** claim a no-op listener mutates gold. The server
implements that authoritative credit and debit atomically in the account store.
[Native evidence](native-resource-packs.json).

TCP tests buy Gold1 from 100/100, edit a deck with newly unlocked spells, close
the connection, reopen through a fresh AccountStore, and verify 1,100 gold,
40 gems, 40 free gems and the saved deck. Rejected later commands roll back the
entire batch. Concurrent stores cannot both spend the same initial 100 gems.
Exact-cap and over-cap cases are checked separately.

## Account and initial-name diagnosis

With `TRACE_NETWORK=1`, `account-login` reports only `kind: created` or
`kind: resumed`. No identity, token or device identifier is logged. Preserve
`.local/accounts` and `.local/server-key.json`. A server restart or `git pull`
does not reset them. Do not clear Android app data to test persistence: doing so
removes the game's saved credentials and legitimately creates a new account.
The Frida Home event now also reports `inventoryCards`, `nameSet`,
`nameChangeCount` and `npcWins`, without logging names or balances. Training
diagnostics report only public NPC/PvE data references; unresolved 527/836
diagnostics include only their recovered public selector fields.

The user clarified that the initial name dialog never appeared. This is not
evidence of a changed identity on reconnect. Name command 948 persists when sent,
but the current starter Home bypasses the first seven NPC wins. In native lobby
code `0x142310`, an unset name alone does not open the dialog: it also checks
the GameMode BattleInfo type **102**, or the separate Avatar `demoAccount` flag.
The latter is not an initial-name flag and also gates shop commands; it is not
set as a shortcut. Correct automatic naming/Training Camp still requires the
tutorial GameMode flow.

Training `17967`, matchmaking command `527`, cancellation `13006`, clan creation
`10453`, free reward `836`, full Party events/battles and emotes remain open.
Returning a codec or an empty social list is not completion of these features.

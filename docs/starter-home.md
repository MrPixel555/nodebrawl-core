# Starter Home for the supplied 3.1.0 library

`HOME_MODE=starter` enables an initial player state for Android lobby testing.
The device decoded Home and resolved its cards/arena. A missing event catalogue
was corrected and confirmed present on the next device run, which then exposed
a separate zero Home-level crash. The provider now keeps Home and Avatar at
level one; the original native synchronization command passes in the VM.
The corrected Android UI still needs a device run.
See [the crash analysis](lobby-crash.md).

The generated profile in `server/data/starter-home.json` contains native-encoded
constant sections and five typed identity bindings: one fixed-width Home Long,
three avatar pairs of signed VInts, and a length-prefixed UTF-8 player name.
These bindings use the persisted account ID/name from AccountStore; the LoginOk
identity and credentials belong to that same account. Each response is freshly
encoded, so different VInt widths and name lengths do not shift fixed offsets
incorrectly. Server key/account files stay in `.local` and are not replaced.
An additional typed VInt binding restores the persisted selected-deck index.

The candidate state contains five decks with the same eight spells, an active
collection of eight native Card objects, level 1, Arena1, 100 gold and 100 gems.
The spell IDs are 26000000, 26000001, 26000003, 26000005, 26000014, 26000018,
28000000 and 28000001: Knight, Archers, Giant, Minions, Musketeer, Mini P.E.K.K.A,
Fireball and Arrows in the supplied CSVs. Nine commodity groups are encoded,
including gold and initial maximum-arena/card-count statistics. This is a fixed
starter profile. Selecting one of its five decks is persisted through native
command 703 inside EndClientTurn 13597; command 805 succeeds unchanged for this
fixed level-one profile. All five decks still contain the same
cards. Changing deck contents, name changes, resource changes, quests, shop and
battles are not implemented. See [command evidence and scope](commands.md).

`tools/reverse/starter_home.py` runs the original Home/card/avatar constructors,
encoder and decoder in Unicorn. CSV data lookup is an explicit adapter: spell
ordinal table 7 concatenates named character, building and other spell records;
resource/arena tables preserve their named-row order. This does not initialize
the entire Android game-data system. The device has now confirmed the *actual*
resolved card IDs for this deck. Unknown fields retain native decoded
defaults rather than taking the sample server's packet as an authoritative schema.

Native decoding consumes all 625 bytes for ID [0,37]/name Player, and native
re-encoding produces identical bytes. Six complete native fixtures cover a new
account, multi-byte account IDs, the int32 boundary, longer names and Persian
UTF-8 and selected decks 1 and 4. Node's actual provider matches these bytes. The
[encrypted observation](native-starter-transport.json) verifies Node-generated
LoginOk, the starter Home (637 bytes for its variable identity) and KeepAlive
through the original native session parser. The handshake fields and CSV lookup
objects in that test are synthetic. This is separate from the
[earlier device transport](device-transport.json). The subsequent
[device Home evidence](device-home.json) confirms initial decoding. The
[subsequent device run](device-home-v5.json) confirms the catalogue fix and
heartbeat, followed by a distinct UI crash. The level-state correction changes
one byte without changing packet length; it passes its
[native regression](native-home-level-regression.json), not a full Android UI test.

Reproduce with the retained local analysis environment:

```bash
GAME_ANALYSIS_DIR=/workspace/game-analysis /workspace/game-analysis/venv/bin/python tools/reverse/starter_home.py
GAME_ANALYSIS_DIR=/workspace/game-analysis /workspace/game-analysis/venv/bin/python tools/reverse/verify_home_level.py
GAME_ANALYSIS_DIR=/workspace/game-analysis /workspace/game-analysis/venv/bin/python tools/reverse/verify_starter_transport.py
```

The generated JSON profile and fixtures are committed so ordinary Node startup
does not need an APK, native library, Python or extracted game assets.

The ready Frida client uses `--trace-home 1`. It stops peer key/nonce overrides
after the first encrypted reply but retains bounded native tracing until
OwnHomeData decoding finishes or the game socket closes. Expect
`native-home-decode-start` and `native-home-decode-complete`, with consumed bytes,
card IDs, deck count, Avatar level, Home level and arena ID. Both levels should
be one. It does not log the packet body, account
token, private scalar, player ID or player name. A completed native decode is
not proof that the later Android UI initialization succeeds.

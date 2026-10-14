# Starter Home for the supplied 3.1.0 library

`HOME_MODE=starter` enables an initial player state for the next Android lobby
test. It sends LoginOk and OwnHomeData instead of the deliberate missing-Home
LoginFailed. This is not yet an Android-verified lobby or a playable server.

The generated profile in `server/data/starter-home.json` contains native-encoded
constant sections and five typed identity bindings: one fixed-width Home Long,
three avatar pairs of signed VInts, and a length-prefixed UTF-8 player name.
These bindings use the persisted account ID/name from AccountStore; the LoginOk
identity and credentials belong to that same account. Each response is freshly
encoded, so different VInt widths and name lengths do not shift fixed offsets
incorrectly. Server key/account files stay in `.local` and are not replaced.

The candidate state contains five decks with the same eight spells, an active
collection of eight native Card objects, level 1, Arena1, 100 gold and 100 gems.
The spell IDs are 26000000, 26000001, 26000003, 26000005, 26000014, 26000018,
28000000 and 28000001: Knight, Archers, Giant, Minions, Musketeer, Mini P.E.K.K.A,
Fireball and Arrows in the supplied CSVs. Nine commodity groups are encoded,
including gold and initial maximum-arena/card-count statistics. This is a fixed
starter profile; commands, resource changes, quests, shop and battles are not
implemented by these constant sections.

`tools/reverse/starter_home.py` runs the original Home/card/avatar constructors,
encoder and decoder in Unicorn. CSV data lookup is an explicit adapter: spell
ordinal table 7 concatenates named character, building and other spell records;
resource/arena tables preserve their named-row order. This does not initialize
the entire Android game-data system. The next device trace reports the *actual*
resolved card IDs to check that assumption. Unknown fields retain native decoded
defaults rather than taking the sample server's packet as an authoritative schema.

Native decoding consumes all 623 bytes for ID [0,37]/name Player, and native
re-encoding produces identical bytes. Four complete native fixtures cover a new
account, multi-byte account IDs, the int32 boundary, longer names and Persian
UTF-8. Node's actual provider matches these bytes. The
[encrypted observation](native-starter-transport.json) verifies Node-generated
LoginOk, the starter Home (635 bytes for its variable identity) and KeepAlive
through the original native session parser. The handshake fields and CSV lookup
objects in that test are synthetic. This is separate from the
[confirmed device transport](device-transport.json), which opened LoginFailed
and did not yet receive this Home.

Reproduce with the retained local analysis environment:

```bash
GAME_ANALYSIS_DIR=/workspace/game-analysis /workspace/game-analysis/venv/bin/python tools/reverse/starter_home.py
GAME_ANALYSIS_DIR=/workspace/game-analysis /workspace/game-analysis/venv/bin/python tools/reverse/verify_starter_transport.py
```

The generated JSON profile and fixtures are committed so ordinary Node startup
does not need an APK, native library, Python or extracted game assets.

The ready Frida client uses `--trace-home 1`. It stops peer key/nonce overrides
after the first encrypted reply but retains bounded native tracing until
OwnHomeData decoding finishes or the game socket closes. Expect
`native-home-decode-start` and `native-home-decode-complete`, with consumed bytes,
card IDs, deck count, level and arena ID. It does not log the packet body, account
token, private scalar, player ID or player name. A completed native decode is
not proof that the later Android UI initialization succeeds.

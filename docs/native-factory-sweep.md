# Exhaustive native message construction check

`tools/reverse/verify_factory.py --all` executes the supplied library's original
factory `0x622544` for every ID from 0 through 65535, with both values of its
observed flag. The flag's business meaning is unresolved; it is not treated as
a client/server direction selector.

The [report](native-factory-sweep.json) records **131,072 factory calls with zero
errors**, 275 successful constructions and 268 distinct message IDs. Every
constructed object's type getter returns the requested ID. Its vtable, encoder,
decoder and type getter match a previously catalogued class variant. Login has
more than one catalogued variant, so comparison preserves those variants.

No additional message IDs were found. Sixteen catalogued classes are not
constructed by this factory with either tested flag; their absence is recorded,
not interpreted as proof that those messages are unused. Other native paths
construct messages directly.

```bash
GAME_ANALYSIS_DIR=/workspace/game-analysis \
  /workspace/game-analysis/venv/bin/python tools/reverse/verify_factory.py --all
```

Construction coverage is separate from payload decoding and gameplay. This
check does not make all 284 catalogued messages usable, recover unresolved
nested codecs or implement Training, matchmaking, Party, shop and clan logic.
In particular, a no-op virtual decoder does not establish an empty payload:
the deferred consumer of [28991](battle-snapshot.md) reads a full world later.

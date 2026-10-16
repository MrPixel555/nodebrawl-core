# Native CSV parser and record identities

The supplied library's file manifest at `0x3f8548` has **74 entries**: 72 mode-0
CSV files plus two mode-1 entries. It directly identifies the game-data kinds
used by packet references, including:

| Kind | File |
| --- | --- |
| 12 | csv_logic/predefined_decks.csv |
| 15 | csv_logic/locations.csv |
| 18 | csv_logic/npcs.csv |
| 57 | csv_logic/regions.csv |
| 72 | csv_logic/game_modes.csv |
| 79 | csv_logic/pve_gamemodes.csv |

The last mode-1 entry's path is empty in this VM observation; resolving that
runtime-dependent path is outside the mode-0 checks. It is not treated as a
missing asset or added to the static kind/path mapping.

`tools/reverse/native_csv.py` runs the original hierarchical CSV parser
`0x4a461c` and DataTable loader `0x41c214`. It first runs the actual CSV static
initializer `0xe1140`; otherwise the missing quote-delimiter NativeString causes
quoted cells to be split incorrectly. Record constructors and typed parser
code run directly. There are no substituted CSV row or table lookup callbacks.
The VM supplies bounded heap and standard libc behavior, including ASCII
`strcasecmp` and signed decimal `atoi`.

The verifier pins each decoded input to the SHA-256 recorded from the uploaded
APK. It checks native record names and global IDs against every named CSV row
in the selected tables. The default checks locations (53), NPCs (59) and PvE
modes (18); the original getter also returns
`locations/training_arena.csv` for TrainingCamp. [The report](native-csv.json)
lists the exact tables verified, source hashes and native manifest. The full
mode-0 run passed for **all 72 tables and 6,726 record identities**. The first
column supplies record names, including `season_default.csv`, whose first
column is called `tr` rather than `Name`.

```bash
GAME_ANALYSIS_DIR=/workspace/game-analysis \
  /workspace/game-analysis/venv/bin/python tools/reverse/verify_native_csv.py
GAME_ANALYSIS_DIR=/workspace/game-analysis \
  /workspace/game-analysis/venv/bin/python tools/reverse/verify_vm_runtime.py
```

`--all --checkpoint /workspace/game-analysis/native-csv-verified-state` verifies
all mode-0 manifest tables and retains expensive parser results between runs.
Use only checkpoints generated locally by this tool. Checkpoints validate the
library hash, fixed VM memory regions, block sizes and SHA-256 before reuse;
they cannot preserve custom native hooks or held mutexes. They are local
analysis artifacts, never server account/key files or Node runtime inputs.

Large parsers can continue the exact suspended CPU state across at most five
bounded execution slices. Ordinary VM calls retain their single-slice budget.
The runtime verifier executes a native loop across slice boundaries and tests
heap exhaustion and libc ABI behavior. It does not replace failed instructions
or change CSV values to pass checks.

The VM also supports bounded integer/string `vsnprintf` at the libc boundary,
using the Android AArch64 register-save/stack `va_list` layout. Tests execute
the original C++ variadic String formatter and check truncation, stack spill,
width, precision and unsupported conversion rejection. Formatting a normal
name such as `Combined Table 49` no longer gets mistaken for a fatal game
diagnostic. Native assertions still run and are not suppressed.

ELF GOT import slots are bound to the same libc adapter entries as direct PLT
calls; this also covers indirect calls without invoking an absent Android
dynamic loader. Restoring a memory checkpoint rebinds those slots. The runtime
checks exercise direct, GOT and PLT-suffix paths. Optional CPU register capture
includes flags and the full SIMD bank for bounded, single-thread CSV parser
continuation with matching memory; it is not a standalone process snapshot.

Raw DataTable construction is only an initial step. Cross-table field linking,
map/tower creation, players, GameMode snapshots and battle simulation require
further verification. These parser checks do not establish playable Training,
Party, normal battle or emotes. Node server startup still needs only Node 18+;
the optional reverse-engineering workflow uses the retained Python environment.

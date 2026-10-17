# Native-bridge loading compatibility

The supplied logs show MuMu Android 12 x86-64 using Houdini
`12.0.0_z.38816.m`. `System.loadLibrary("fmod")` succeeds, while `g` fails.
The native-bridge trace returns a null handle for `libg.so` and only the
generic error `dlopen failed`. No native backtrace identifies an instruction
or constructor failure. The user separately confirmed that the unmodified
game runs on the same emulator and the patched game runs on physical ARM64.

The normal x86 linker messages reporting `EM_AARCH64 instead of EM_X86_64`
occur before native-bridge loading; by themselves they are not the root
cause, since the same route successfully loads ARM64 fmod. The logs also
contain other attempts, including `libframework-connectivity-jni.so not
found`; these are not evidence that the original failing g library needs
an additional system library. No such library was bundled or force-loaded.
The uploaded archive's notes/previous analyses were treated as evidence to
check, not instructions to execute. Raw device logs are not committed.

## Change

Previously the patch moved `e_phoff` from 64 to `0xd80000`, expanded the PHDR
count from 8 to 9 and put the new table in the appended RX segment. Android's
ARM64 loader accepts that arrangement, but the user reports that Houdini
rejects the patched library. The log does not expose Houdini's internal
rejection reason, so the relocated table was a compatibility hypothesis,
not a confirmed diagnosis. The user subsequently reported that the
canonical-header revision still fails. The uploaded report matches its exact
published APK/library hashes and confirms e_phoff=64/e_phnum=8. That layout
change alone did not resolve the problem on this MuMu device; the cause remains
unresolved.

## Current two-load layout

A subsequent live capture recorded the exact canonical-header APK/library.
It includes the native x86 loader's ARM64 rejection for both fmod and g,
and Houdini initialization, but no internal native-bridge error or native
backtrace. That wrong-machine message is still not sufficient to identify
why the translator rejects g. OpenGL extension lookups in a graphics worker
also appear; they are not evidence that g has a missing GL dependency.

The new candidate removes the third PT_LOAD entirely. It uses the existing
virtual gap between the first RX load and the second RW load:

| Property | Supplied original | New candidate |
| --- | --- | --- |
| PT_LOAD count | 2 | 2 |
| Load flags | RX, RW | RX, RW |
| PHDR offset/count | 64 / 8 | 64 / 8 |
| RW virtual address | `0xa29a48` | `0xa29a48` |
| RW file offset | `0xa19a48` | `0xa29a48` |
| GNU build-id and Android NDK notes | Both present | Both preserved |

The RX load extends to contain the adapter at `0xa194c0`. Its end remains
below the original RW mapping after both 4 KiB and 16 KiB page rounding.
The RW data is shifted 64 KiB in the file, with dynamic/RELRO/section file
offsets updated; its virtual addresses and all original relocations remain
unchanged. An ordinary allocated executable `.text.private_peer` section
covers the new code. No segment is made RWX and no note descriptor is reused.
This reduces assumptions about native-bridge ELF layouts; it does **not**
prove the proprietary Houdini loader's root cause or confirm device success.

Ten APK tests validate the two-load layout, original sections/imports/relocations,
complete mapped-image changes, both notes, nonoverlapping page-rounded mappings,
and the original 13 integrity tables. Native startup decryption and both
handshake paths are tested separately. These are **not Houdini execution**.

## Device verification

Install the updated `client/ClashRoyale-3.1.0-private-arm64.apk` as an update;
the signing identity is unchanged. Do not clear app data. Open it directly,
confirm it gets past native-library loading and reaches Home, then try a
Training battle. Keep `assets/configs.so` and the server key as configured.

For the next failing run, use live capture from the repository root:

```bat
set ADB=tools\ADB\adb.exe
node tools/client/diagnose.js 127.0.0.1:7555 --launch
```

Use the actual adb executable path/device serial on your machine; `ADB`
can be omitted if adb is on PATH. No Frida is required. The explicit `--launch`
option stops only this game's running process and starts GameApp; it never
clears application data. Live logcat is drained before/during that launch and
saved before any getprop/dumpsys/pull calls. It records ABI/bridge properties,
relevant log lines, and the
**installed** APK/library hashes and program-header location. It writes a
local JSON file and full `.raw.log` under `.local/client-diagnostics/`, and
prints their paths. It does not install, reset or upload anything. Without
`--launch` it takes a read-only snapshot before metadata requests and never
starts or stops the game. Review the files before sharing them. The APK ZIP
reader was checked against the built APK;
no Android/ADB device is attached to the build environment.

The previous collector captured logs after metadata requests and kept only
2000 broad linker/package lines. In the supplied report, ADB linker chatter
and NewFileUpdater messages occupied every retained line, excluding the game
load/failure. The collector now preserves target-process details without that
tail cutoff, includes a complete raw capture, and indicates whether a game
load/failure was seen. Ten diagnostic regression tests cover ELF layout extraction, capture order, noisy
logs, metadata errors and actual child-process stream collection; Android/ADB
execution is still not available in the build environment.

Successful Houdini/native-bridge loading and actual gameplay remain unverified;
the reported MuMu test of the earlier canonical-header/three-load revision failed.
The current two-load candidate still needs a device result. This ARM64 APK cannot
support a bridge that only translates ARM32 or an emulator without working
ARM64 translation; no ARMv7 or x86 game library was supplied.

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

The new layout keeps the table at **64**, keeps its **8 descriptors**, and
places the complete table within the first original PT_LOAD. The optional
Android NDK-ident PT_NOTE descriptor becomes the appended RX PT_LOAD. Its
note bytes/section remain intact; the original GNU build-id PT_NOTE and all
load/dynamic, stack, RELRO and unwind descriptors remain unchanged. Load
segments remain in ascending virtual-address order with their original
alignment requirements; the appended segment is 64 KiB aligned.
The peer key, native adapter code, seven call sites, configuration file,
original game DEX, UI and assets are unchanged by this loader-layout fix.

Regression checks require this layout, verify that only the permitted PHDR
slot and seven original instructions change in executable mappings, and
recheck the original 13 integrity tables. Native startup decryption and both
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
load/failure was seen. Eight regression tests cover capture order, noisy
logs, metadata errors and actual child-process stream collection; Android/ADB
execution is still not available in the build environment.

Successful Houdini/native-bridge loading and actual gameplay remain unverified;
the reported MuMu test of the canonical-header revision failed. This ARM64 APK cannot
support a bridge that only translates ARM32 or an emulator without working
ARM64 translation; no ARMv7 or x86 game library was supplied.

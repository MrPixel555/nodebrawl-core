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
rejection reason, so the relocated table is a compatibility hypothesis,
not a confirmed diagnosis.

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

If loading still fails, run this immediately after the failed launch:

```bat
set ADB=tools\ADB\adb.exe
node tools/client/diagnose.js 127.0.0.1:7555
```

Use the actual adb executable path/device serial on your machine; `ADB`
can be omitted if adb is on PATH. This read-only collector requires no
Frida. It records ABI/bridge properties, relevant log lines, and the
**installed** APK/library hashes and program-header location. It writes a
local JSON file under `.local/client-diagnostics/`, prints its path, and
does not install, launch, stop, reset or upload anything. Review that file
before sharing it. The APK ZIP reader was checked against the built APK;
no Android/ADB device is attached to the build environment.

Houdini/native-bridge loading and actual gameplay remain unverified for
this revision until that device test is returned. This ARM64 APK cannot
support a bridge that only translates ARM32 or an emulator without working
ARM64 translation; no ARMv7 or x86 game library was supplied.

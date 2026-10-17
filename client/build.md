# Rebuilding the private client

This is an optional **offline Linux build**, separate from `npm start`.
Required: Python 3, host C compiler, Clang/LLD 19, JDK 21, Android stubs, R8
8.3.37 and apksigner 35.0.2. No Android NDK/sysroot is needed for the tiny
freestanding adapter. Keep build work outside Git or under `.local/`.

Inputs are deliberately pinned:

| Input | SHA-256 |
| --- | --- |
| Supplied original APK | `dce6a6bf55e7021f6410438e47adf69e1e0c6120bc34f8c3457350e2366178c1` |
| Separately supplied encrypted ARM64 libg.so | `4dd79f7c143fe87dba0e3c7521fe150bf1e018783a2e04632bd38bba5dafde5a` |
| Library bundled in supplied APK (strings already decoded) | `6020d2fb42fa13c81ac755cbec31621b3b104ebfdbfb65ae4b1a4356b7b0a46a` |
| android-4.1.1.4.jar | `84072541cbb711eff89f7277100ff854929a446dba7ceb1b195c340e0b4fd3cb` |
| r8-8.3.37.jar | `59753e70a74f918389cc87f1b7d66b5c0862932559167425708ded159e3de439` |

JAR download locations:

- https://repo.maven.apache.org/maven2/com/google/android/android/4.1.1.4/android-4.1.1.4.jar
- https://dl.google.com/dl/android/maven2/com/android/tools/r8/8.3.37/r8-8.3.37.jar

The builder verifies both JAR hashes. Its D8 library input includes the JDK
home because the Maven Android stubs omit `java.lang` classes. Source and
target bytecode levels are Java 8; only API-16-compatible launcher calls are
used. The original target SDK 28 manifest and network policy are retained.

Example, using your own absolute paths:

```sh
python3 -m venv .local/client-build-venv
.local/client-build-venv/bin/pip install -r client/requirements-build.txt
.local/client-build-venv/bin/python tools/client/build.py \
  --apk /path/original.apk \
  --library /path/original-encrypted-libg.so \
  --android-jar /path/android-4.1.1.4.jar \
  --r8 /path/r8-8.3.37.jar \
  --apksigner /path/apksigner.jar \
  --java-home /path/jdk-21 \
  --clang clang-19 --linker ld.lld-19 \
  --work .local/client-build \
  --output client/ClashRoyale-3.1.0-private-arm64.apk
```

The builder generates/reuses `.local/client-signing.p12` and its separate
password file. **Back up both privately.** Losing this identity prevents
installing future self-built APKs as updates to APKs signed by it. Do not
commit either file. A fresh signing identity changes the APK hash and signing
certificate even with identical source and native code.

It preserves original ZIP entries, replaces the manifest and ARM64 library,
adds `classes2.dex` and license notices, aligns stored entries, and signs with
v1/v2/v3. The signature is independently verified by apksigner. No Frida
runtime or script is bundled. The existing Frida tools remain available for
the original unmodified APK and diagnostics.

Two builds in independent work directories, using the retained signing
identity and tool versions above, produced the identical 104,734,939-byte APK:
`bf8a4328b7dd4898860c73115be26d77ad80d897b27bd6001ed525a72033e6c9`.
All eight APK structure/integrity tests passed, including deliberate corruption
of a modified instruction causing the main checksum to differ.

Native code is position independent and has no dynamic relocations, mutable
globals or extra shared-library dependencies. An appended 64 KiB-aligned RX
PT_LOAD also contains the expanded ELF program header table. The original
segments, notes, RELRO and unwind header remain intact. The integrity updater
checks the original checksum baseline, updates affected stored constants
through their string XOR encoding, reaches a fixed point and then rechecks
all 13 identified tables against the final ELF. It never disables a checksum
branch. [Third-party notices](THIRD_PARTY.md).

Verification:

```sh
.local/client-build-venv/bin/pip install -r client/requirements-verify.txt
.local/client-build-venv/bin/python tools/client/test_apk.py \
  --original /path/original.apk --library /path/original-encrypted-libg.so \
  --apk client/ClashRoyale-3.1.0-private-arm64.apk \
  --report client/build-report.json --work .local/client-checks

GAME_ANALYSIS_DIR=/path/existing-analysis-workspace \
  .local/client-build-venv/bin/python tools/client/verify_native.py \
  --library .local/client-build/libg.patched.so \
  --report .local/client-build/native-report.json \
  --output client/native-verification.json
```

The second command uses the repository's existing analysis artifacts
(`memory.bin`, `libg.so`, schemas and native Home fixture). It executes the
original startup string decryptor, both native Login paths, the native LoginOk,
Home and heartbeat parsers, and the compiled endpoint adapter. It never
overrides crypto arguments. Only synthetic client ephemeral secrets cross a
local test pipe to the Node oracle; no server private key is accessed.

These checks **do not execute Android's dynamic linker, Activity UI or game
lobby/battle on a device**. Signature verification, ELF checksum consistency
and native protocol execution are separate evidence, not a claim of device
compatibility. Device validation should first open the launcher, connect,
reach Home, close/reopen, then change the endpoint and reconnect.

#!/usr/bin/env python3
"""Offline APK build. Not a dependency of the Node.js server."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import secrets
import struct
import subprocess
import zipfile

from elf_patch import REPO, PUBLIC_KEY, patch_library
from manifest import patch_manifest
from configuration import validate_config

ANDROID_SHA = '84072541cbb711eff89f7277100ff854929a446dba7ceb1b195c340e0b4fd3cb'
R8_SHA = '59753e70a74f918389cc87f1b7d66b5c0862932559167425708ded159e3de439'


def sha(data):
    return hashlib.sha256(data).hexdigest()


def checked_jar(path, expected):
    if sha(path.read_bytes()) != expected:
        raise ValueError('Unexpected toolchain JAR: ' + path.name)


def repack(source, replacements, output):
    """Align uncompressed ZIP entries to four bytes before APK signing."""
    with zipfile.ZipFile(source) as original, zipfile.ZipFile(output, 'w', allowZip64=False) as target:
        existing = set()
        for entry in original.infolist():
            upper = entry.filename.upper()
            if upper.startswith('META-INF/') and (upper.endswith(('.SF', '.RSA', '.DSA', '.EC')) or upper == 'META-INF/MANIFEST.MF'):
                continue
            if entry.filename in existing:
                raise ValueError('Duplicate APK entry')
            existing.add(entry.filename)
            value = replacements.get(entry.filename, original.read(entry))
            entry.extra = b''
            if entry.compress_type == zipfile.ZIP_STORED:
                position = target.fp.tell() + 30 + len(entry.filename.encode('utf-8'))
                padding = -(position + 4) % 4
                entry.extra = struct.pack('<HH', 0xd935, padding) + bytes(padding)
            target.writestr(entry, value)
        for name, value in replacements.items():
            if name not in existing:
                entry = zipfile.ZipInfo(name, (2026, 1, 1, 0, 0, 0))
                entry.compress_type = zipfile.ZIP_DEFLATED
                entry.external_attr = 0o100644 << 16
                target.writestr(entry, value)


def check_alignment(apk):
    with zipfile.ZipFile(apk) as archive, open(apk, 'rb') as stream:
        for entry in archive.infolist():
            if entry.compress_type == zipfile.ZIP_STORED:
                stream.seek(entry.header_offset)
                header = stream.read(30)
                name, extra = struct.unpack_from('<HH', header, 26)
                if (entry.header_offset + 30 + name + extra) % 4:
                    raise ValueError('Unaligned stored APK entry: ' + entry.filename)


def signing_key(directory, java):
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    key = directory / 'client-signing.p12'
    password = directory / 'client-signing.password'
    if key.exists() != password.exists():
        raise ValueError('Incomplete local signing identity; restore its missing file')
    if not key.exists():
        password.write_text(secrets.token_urlsafe(32) + '\n')
        password.chmod(0o600)
        subprocess.run([java, 'sun.security.tools.keytool.Main', '-genkeypair', '-keystore', str(key), '-storetype', 'PKCS12', '-storepass:file', str(password), '-alias', 'private-client', '-keyalg', 'RSA', '-keysize', '3072', '-sigalg', 'SHA256withRSA', '-validity', '10000', '-dname', 'CN=Nodebrawl Private Client', '-noprompt'], check=True)
        key.chmod(0o600)
    return key, password


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['apk', 'library', 'android-jar', 'r8', 'apksigner']:
        parser.add_argument('--' + name, type=Path, required=True)
    parser.add_argument('--clang', default='clang')
    parser.add_argument('--linker', default='ld.lld')
    parser.add_argument('--java', default='java')
    parser.add_argument('--java-home', type=Path, required=True)
    parser.add_argument('--work', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--signing-dir', type=Path, default=REPO / '.local')
    parser.add_argument('--public-key', default=PUBLIC_KEY)
    parser.add_argument('--config', type=Path, default=REPO / 'client/configs.so')
    args = parser.parse_args()
    args.work.mkdir(parents=True, exist_ok=True)
    checked_jar(args.android_jar, ANDROID_SHA)
    checked_jar(args.r8, R8_SHA)
    config = args.config.read_bytes()
    validate_config(config)
    with zipfile.ZipFile(args.apk) as original:
        if sha(args.apk.read_bytes()) != 'dce6a6bf55e7021f6410438e47adf69e1e0c6120bc34f8c3457350e2366178c1':
            raise ValueError('Expected the supplied, hash-verified 3.1.0 APK')
        if 'classes2.dex' in original.namelist():
            raise ValueError('Expected the original single-DEX APK')
        # The uploaded APK contains the strings-decrypted analysis variant.
        # Use the separately uploaded, pinned encrypted original so its startup
        # string decryption receives the expected input.
        library, report = patch_library(args.library.read_bytes(), args.work / 'native', args.clang, args.linker, args.public_key)
        report['originalBundledLibrarySha256'] = sha(original.read('lib/arm64-v8a/libg.so'))
        manifest = patch_manifest(original.read('AndroidManifest.xml'))
    (args.work / 'libg.patched.so').write_bytes(library)
    (args.work / 'native-report.json').write_text(json.dumps(report, indent=2) + '\n')
    classes = args.work / 'classes'
    dex = args.work / 'dex'
    classes.mkdir(exist_ok=True)
    dex.mkdir(exist_ok=True)
    for previous in classes.rglob('*.class'):
        previous.unlink()
    (dex / 'classes.dex').unlink(missing_ok=True)
    stubs = args.work / 'compile-stubs'
    stubs.mkdir(exist_ok=True)
    subprocess.run([args.java, 'com.sun.tools.javac.Main', '-source', '8', '-target', '8', '-Xlint:-options', '-classpath', str(args.android_jar), '-d', str(stubs), str(REPO / 'tools/client/stubs/android/support/multidex/MultiDexApplication.java')], check=True)
    stub_jar = args.work / 'compile-stubs.jar'
    with zipfile.ZipFile(stub_jar, 'w') as archive:
        for compiled in stubs.rglob('*.class'):
            archive.write(compiled, str(compiled.relative_to(stubs)))
    source = REPO / 'client/application/org/nodebrawl/client/ServerApplication.java'
    subprocess.run([args.java, 'com.sun.tools.javac.Main', '-source', '8', '-target', '8', '-Xlint:-options', '-classpath', str(args.android_jar) + os.pathsep + str(stub_jar), '-d', str(classes), str(source)], check=True)
    subprocess.run([args.java, '-cp', str(args.r8), 'com.android.tools.r8.D8', '--release', '--min-api', '16', '--lib', str(args.android_jar), '--lib', str(args.java_home), '--classpath', str(stub_jar), '--output', str(dex), *map(str, sorted(classes.rglob('*.class')))], check=True)
    notices = (REPO / 'client/THIRD_PARTY.md').read_bytes()
    replacements = {'lib/arm64-v8a/libg.so': library, 'AndroidManifest.xml': manifest, 'classes2.dex': (dex / 'classes.dex').read_bytes(), 'assets/private-client-notices.txt': notices, 'assets/configs.so': config}
    unsigned = args.work / 'client-unsigned.apk'
    repack(args.apk, replacements, unsigned)
    check_alignment(unsigned)
    key, password = signing_key(args.signing_dir, args.java)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run([args.java, '-jar', str(args.apksigner), 'sign', '--ks', str(key), '--ks-key-alias', 'private-client', '--ks-pass', 'file:' + str(password), '--v1-signing-enabled', 'true', '--v2-signing-enabled', 'true', '--v3-signing-enabled', 'true', '--v4-signing-enabled', 'false', '--out', str(args.output), str(unsigned)], check=True)
    verified = subprocess.check_output([args.java, '-jar', str(args.apksigner), 'verify', '--verbose', '--print-certs', str(args.output)], text=True)
    print(verified)
    check_alignment(args.output)
    with zipfile.ZipFile(args.apk) as original, zipfile.ZipFile(args.output) as built:
        for name in original.namelist():
            if name not in replacements and not name.upper().startswith('META-INF/'):
                if original.read(name) != built.read(name):
                    raise ValueError('Unexpected APK change: ' + name)
    report.update({'originalApkSha256': sha(args.apk.read_bytes()), 'apkSha256': sha(args.output.read_bytes()), 'apkBytes': args.output.stat().st_size,
                   'launcherActivity': 'com.supercell.clashroyale.GameApp', 'configurationAsset': 'assets/configs.so', 'settingsUi': False, 'applicationClass': 'org.nodebrawl.client.ServerApplication', 'originalGameDexUnchanged': True, 'originalAssetsUnchanged': True,
                   'storedEntriesAligned': True, 'androidRuntimeVerified': False, 'signingVerification': verified.strip().splitlines()})
    (args.output.parent / 'build-report.json').write_text(json.dumps(report, indent=2) + '\n')
    print('Built', args.output, str(report['apkBytes']) + ' bytes', report['apkSha256'])


if __name__ == '__main__':
    main()

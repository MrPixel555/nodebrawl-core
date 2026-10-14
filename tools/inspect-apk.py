#!/usr/bin/env python3
"""Extract APK assets and record its library identity in a fresh analysis directory."""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import tempfile
import struct
import zipfile

from apk_data import manifest_identity

EXPECTED_LIBRARY = '4dd79f7c143fe87dba0e3c7521fe150bf1e018783a2e04632bd38bba5dafde5a'
DECRYPTED_LIBRARY = '6020d2fb42fa13c81ac755cbec31621b3b104ebfdbfb65ae4b1a4356b7b0a46a'
MAX_ENTRY = 256 * 1024 * 1024
MAX_TOTAL = 2 * 1024 * 1024 * 1024


def digest_file(path):
    result = hashlib.sha256()
    with path.open('rb') as source:
        while data := source.read(1024 * 1024):
            result.update(data)
    return result.hexdigest()


def inspect_apk(source, destination):
    if destination.exists():
        raise ValueError('Output already exists; use a fresh directory')
    destination.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(source) as archive, tempfile.TemporaryDirectory(prefix='.apk-inspect-', dir=destination.parent) as temporary:
        root = Path(temporary)
        names = set()
        total = 0
        selected = []
        for member in archive.infolist():
            name = member.filename
            path = PurePosixPath(name)
            if path.is_absolute() or '..' in path.parts or '\\' in name or '\0' in name or name in names:
                raise ValueError('Unsafe or duplicate archive path')
            names.add(name)
            if not member.is_dir() and (name.startswith('assets/') or (name.startswith('lib/') and name.endswith('/libg.so')) or name == 'AndroidManifest.xml'):
                if member.flag_bits & 1:
                    raise ValueError('Encrypted ZIP entries are unsupported')
                if not 0 <= member.file_size <= MAX_ENTRY:
                    raise ValueError('APK entry exceeds resource limit')
                total += member.file_size
                if total > MAX_TOTAL:
                    raise ValueError('APK assets exceed resource limit')
                selected.append(member)
        libraries, assets = [], []
        for member in selected:
            target = root / member.filename
            target.parent.mkdir(parents=True, exist_ok=True)
            sha, size = hashlib.sha256(), 0
            with archive.open(member) as reader, target.open('xb') as writer:
                while data := reader.read(1024 * 1024):
                    size += len(data)
                    if size > member.file_size:
                        raise ValueError('ZIP entry exceeds declared size')
                    sha.update(data)
                    writer.write(data)
            if size != member.file_size:
                raise ValueError('Truncated ZIP entry')
            record = {'path': member.filename, 'bytes': size, 'sha256': sha.hexdigest()}
            if member.filename.startswith('lib/'):
                record['matchesCurrentLibrary'] = sha.hexdigest() == EXPECTED_LIBRARY
                record['matchesDecryptedLibrary'] = sha.hexdigest() == DECRYPTED_LIBRARY
                libraries.append(record)
            elif member.filename.startswith('assets/'):
                assets.append(record)
        metadata = {
            'apkSha256': digest_file(source),
            'apkBytes': source.stat().st_size,
            'libraries': libraries,
            'assets': assets,
            'fingerprintCandidates': [a['path'] for a in assets if PurePosixPath(a['path']).name == 'fingerprint.json'],
            'csvCandidates': [a['path'] for a in assets if a['path'].endswith('.csv')],
            'manifest': manifest_identity((root / 'AndroidManifest.xml').read_bytes()) if (root / 'AndroidManifest.xml').is_file() else None,
            'exactVersionVerified': (root / 'AndroidManifest.xml').is_file(),
            'notes': ['Manifest version and content fingerprint version are distinct.', 'APK signing certificates have not been verified by this inspection tool.'],
        }
        (root / 'apk-evidence.json').write_text(json.dumps(metadata, indent=2) + '\n')
        root.rename(destination)
    print(f'APK assets extracted: {len(assets)}; native libraries: {len(libraries)}')
    print(f'Bundled library matches current profile: {any(x["matchesCurrentLibrary"] for x in libraries)}')
    print(f'Bundled library matches strings-decrypted profile: {any(x["matchesDecryptedLibrary"] for x in libraries)}')
    print(f'Evidence: {(destination / "apk-evidence.json").resolve()}')
    return metadata


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('apk', type=Path)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    try:
        inspect_apk(args.apk, args.output)
    except (OSError, ValueError, IndexError, struct.error, zipfile.BadZipFile, RuntimeError) as error:
        parser.exit(1, f'{error}\n')


if __name__ == '__main__':
    main()

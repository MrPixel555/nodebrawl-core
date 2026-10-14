#!/usr/bin/env python3
"""Verify extracted APK assets, decompress Supercell CSVs and inventory game tables."""
import argparse
import csv
import hashlib
import io
import json
import lzma
from pathlib import Path, PurePosixPath
import struct
import tempfile

MAX_CSV = 32 * 1024 * 1024


def manifest_identity(data):
    """Read literal manifest-root attributes from Android binary XML, without executing it."""
    def u16(pos): return struct.unpack_from('<H', data, pos)[0]
    def u32(pos): return struct.unpack_from('<I', data, pos)[0]
    def length(pos, wide=False):
        value = u16(pos) if wide else data[pos]
        pos += 2 if wide else 1
        mask = 0x8000 if wide else 0x80
        if value & mask:
            value = ((value & (mask - 1)) << (16 if wide else 8)) | (u16(pos) if wide else data[pos])
            pos += 2 if wide else 1
        return value, pos
    if len(data) < 8 or u16(0) != 3 or u32(4) != len(data):
        raise ValueError('Invalid Android binary XML header')
    strings, pos = [], u16(2)
    while pos < len(data):
        kind, header, size = struct.unpack_from('<HHI', data, pos)
        if size < header or header < 8 or pos + size > len(data):
            raise ValueError('Invalid Android XML chunk')
        if kind == 1:
            count, flags, start = u32(pos + 8), u32(pos + 16), u32(pos + 20)
            if count > 100000 or header + 4 * count > size:
                raise ValueError('Invalid string pool')
            strings = []
            for n in range(count):
                cursor = pos + start + u32(pos + header + n * 4)
                if flags & 256:
                    _, cursor = length(cursor)
                    size_text, cursor = length(cursor)
                    text = data[cursor:cursor + size_text].decode('utf-8')
                else:
                    size_text, cursor = length(cursor, True)
                    text = data[cursor:cursor + size_text * 2].decode('utf-16le')
                strings.append(text)
        elif kind == 0x102:
            ext = pos + header
            if strings[u32(ext + 4)] == 'manifest':
                count, start, stride = u16(ext + 12), u16(ext + 8), u16(ext + 10)
                result = {}
                if stride < 20 or ext + start + count * stride > pos + size:
                    raise ValueError('Invalid XML attributes')
                for n in range(count):
                    attr = ext + start + n * stride
                    name, raw, value = strings[u32(attr + 4)], u32(attr + 8), u32(attr + 16)
                    if name in ('package', 'versionCode', 'versionName'):
                        result[name] = strings[raw] if raw != 0xffffffff else (strings[value] if data[attr + 15] == 3 else value)
                return result
        pos += size
    raise ValueError('Manifest root was not found')


def decompress_csv(data):
    # Supercell uses an LZMA-alone header with a four-byte, rather than eight-byte, length.
    if len(data) >= 9 and data[0] == 0x5d:
        expected = int.from_bytes(data[5:9], 'little')
        if expected > MAX_CSV:
            raise ValueError('CSV expansion exceeds limit')
        decoder = lzma.LZMADecompressor(format=lzma.FORMAT_ALONE, memlimit=64 * 1024 * 1024)
        decoded = decoder.decompress(data[:9] + bytes(4) + data[9:], max_length=MAX_CSV + 1)
        if len(decoded) != expected or not decoder.eof or decoder.unused_data:
            raise ValueError('Invalid or truncated Supercell LZMA CSV')
        return decoded
    if len(data) > MAX_CSV:
        raise ValueError('CSV exceeds limit')
    return data


def build(source, destination):
    if destination.exists():
        raise ValueError('Output exists; choose a fresh directory')
    assets = source / 'assets'
    fingerprint = json.loads((assets / 'fingerprint.json').read_text())
    verified, missing = 0, []
    for record in fingerprint['files']:
        name = PurePosixPath(record['file'])
        if name.is_absolute() or '..' in name.parts or '\\' in str(name):
            raise ValueError('Unsafe fingerprint path')
        path = assets / str(name)
        if path.is_symlink():
            raise ValueError('Asset symlinks are not supported')
        if not path.is_file():
            missing.append(str(name))
            continue
        if hashlib.sha1(path.read_bytes()).hexdigest() != record['sha']:
            raise ValueError(f'Fingerprint SHA-1 mismatch: {name}')
        verified += 1
    identity = manifest_identity((source / 'AndroidManifest.xml').read_bytes())
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='.apk-data-', dir=destination.parent) as temporary:
        output, tables = Path(temporary), []
        for path in sorted(assets.rglob('*.csv')):
            if path.is_symlink():
                raise ValueError('CSV symlinks are not supported')
            decoded = decompress_csv(path.read_bytes())
            relative = path.relative_to(assets)
            target = output / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(decoded)
            rows = list(csv.reader(io.StringIO(decoded.decode('utf-8-sig'), newline='')))
            names = [row[0] for row in rows[2:] if row and row[0]]
            tables.append({'path': str(relative), 'columns': rows[0] if rows else [],
                           'types': rows[1] if len(rows) > 1 else [], 'dataRows': max(0, len(rows)-2),
                           'namedRecords': len(names), 'names': names,
                           'decodedSha256': hashlib.sha256(decoded).hexdigest()})
        report = {'manifest': identity, 'contentVersion': fingerprint.get('version'),
                  'contentFingerprint': fingerprint.get('sha'), 'verifiedAssets': verified, 'missingFingerprintAssets': missing,
                  'tables': tables, 'notes': ['Table IDs and gameplay semantics are not inferred from filenames.',
                                             'Asset hashes do not verify APK signatures.']}
        (output / 'game-data.json').write_text(json.dumps(report, indent=2) + '\n')
        output.rename(destination)
    print(json.dumps({key: value for key, value in report.items() if key != 'tables'}, indent=2))
    print(f'Decoded CSV tables: {len(tables)}')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('extracted_apk', type=Path)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    try:
        build(args.extracted_apk, args.output)
    except (OSError, ValueError, IndexError, struct.error, lzma.LZMAError) as error:
        parser.exit(1, f'{error}\n')

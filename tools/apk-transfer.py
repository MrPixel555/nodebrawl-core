#!/usr/bin/env python3
"""Split large uploads into 28 MiB parts, or verify and reassemble those parts."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import tempfile

PART_SIZE = 28 * 1024 * 1024


def split_file(source, directory):
    directory.mkdir(parents=True, exist_ok=True)
    manifest_path = directory / (source.name + '.manifest.json')
    if manifest_path.exists():
        raise ValueError('Manifest already exists; use a fresh output directory')
    records, created = [], []
    total, digest = 0, hashlib.sha256()
    try:
        with source.open('rb') as reader:
            while data := reader.read(PART_SIZE):
                name = source.name + f'.part{len(records) + 1:04d}'
                target = directory / name
                with target.open('xb') as writer:
                    created.append(target)
                    writer.write(data)
                digest.update(data)
                total += len(data)
                records.append({'name': name, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()})
        if not records:
            raise ValueError('Source file is empty')
        manifest = {'schema': 1, 'filename': source.name, 'bytes': total, 'sha256': digest.hexdigest(), 'parts': records}
        with manifest_path.open('x', encoding='utf8') as writer:
            created.append(manifest_path)
            json.dump(manifest, writer, indent=2, ensure_ascii=False)
            writer.write('\n')
    except Exception:
        for target in created:
            target.unlink(missing_ok=True)
        raise
    print(f'Created {len(records)} parts; upload every part and {manifest_path.name}')
    print(f'Original SHA-256: {digest.hexdigest()}')


def safe_name(value):
    return isinstance(value, str) and value not in ['', '.', '..'] and '/' not in value and '\\' not in value and ':' not in value


def join_file(manifest_path, destination, parts_directory=None):
    manifest = json.loads(manifest_path.read_text(encoding='utf8'))
    if manifest.get('schema') != 1 or not safe_name(manifest.get('filename')):
        raise ValueError('Invalid manifest')
    records = manifest.get('parts')
    if not isinstance(records, list) or not 1 <= len(records) <= 1024:
        raise ValueError('Invalid part list')
    if destination.exists():
        raise ValueError('Destination already exists; it will not be overwritten')
    directory = parts_directory or manifest_path.parent
    names = set()
    for number, record in enumerate(records, 1):
        expected_name = manifest['filename'] + f'.part{number:04d}'
        if record.get('name') != expected_name or not safe_name(record['name']) or record['name'] in names:
            raise ValueError('Invalid, duplicate or out-of-order part name')
        if type(record.get('bytes')) is not int or not 0 < record['bytes'] <= PART_SIZE:
            raise ValueError('Invalid part size')
        names.add(record['name'])
    destination.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(prefix='.apk-join-', dir=destination.parent)
    temporary = Path(temporary_name)
    total, digest = 0, hashlib.sha256()
    try:
        with os.fdopen(descriptor, 'wb') as writer:
            for record in records:
                source = directory / record['name']
                if source.is_symlink():
                    raise ValueError('Part symlinks are not accepted')
                part_digest, part_size = hashlib.sha256(), 0
                with source.open('rb') as reader:
                    while data := reader.read(1024 * 1024):
                        part_size += len(data)
                        if part_size > record['bytes']:
                            raise ValueError('Part exceeds declared size')
                        part_digest.update(data)
                        digest.update(data)
                        writer.write(data)
                if part_size != record['bytes'] or part_digest.hexdigest() != record.get('sha256'):
                    raise ValueError('Part checksum or size mismatch: ' + record['name'])
                total += part_size
        if total != manifest.get('bytes') or digest.hexdigest() != manifest.get('sha256'):
            raise ValueError('Reassembled file checksum or size mismatch')
        # Create a new name atomically; a concurrently created destination is preserved.
        os.link(temporary, destination)
    finally:
        temporary.unlink(missing_ok=True)
    print(f'Verified reassembled file: {destination.resolve()}')
    print(f'SHA-256: {digest.hexdigest()}')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    split = commands.add_parser('split')
    split.add_argument('source', type=Path)
    split.add_argument('--output', type=Path, default=Path('apk-parts'))
    join = commands.add_parser('join')
    join.add_argument('manifest', type=Path)
    join.add_argument('--output', type=Path, required=True)
    join.add_argument('--parts-directory', type=Path)
    args = parser.parse_args()
    try:
        if args.command == 'split':
            split_file(args.source, args.output)
        else:
            join_file(args.manifest, args.output, args.parts_directory)
    except (OSError, ValueError, KeyError, TypeError) as error:
        parser.exit(1, f'{error}\n')


if __name__ == '__main__':
    main()

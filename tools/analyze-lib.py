#!/usr/bin/env python3
"""Reproduce the uploaded library's protocol evidence without executing it natively."""
import argparse
import hashlib
import json
import lzma
import os
from pathlib import Path
import subprocess
import sys

PINNED_SHA = '4dd79f7c143fe87dba0e3c7521fe150bf1e018783a2e04632bd38bba5dafde5a'
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('library', type=Path)
parser.add_argument('--output', required=True, type=Path)
args = parser.parse_args()
args.output.mkdir(parents=True, exist_ok=True)
raw = args.library.read_bytes()
if args.library.suffix == '.xz':
    raw = lzma.decompress(raw, memlimit=256 * 1024 * 1024)
if hashlib.sha256(raw).hexdigest() != PINNED_SHA:
    parser.error('This analysis profile is pinned to the uploaded library; another binary requires new offsets and validation')
destination = args.output / 'libg.so'
if destination.exists() and destination.read_bytes() != raw:
    parser.error('Output directory contains another library')
destination.write_bytes(raw)
environment = os.environ.copy()
environment['GAME_ANALYSIS_DIR'] = str(args.output.resolve())
scripts = Path(__file__).parent / 'reverse'
for step in ['analyze_elf.py', 'inspect_hook_integrity.py', 'verify_messaging_workers.py', 'find_messages.py', 'extract_schemas.py', 'verify_schemas.py', 'verify_factory.py']:
    subprocess.run([sys.executable, str(scripts / step)], env=environment, check=True)
export = subprocess.run(['node', str(Path(__file__).parent / 'export-native-schemas.js')], check=True, stdout=subprocess.PIPE)
(args.output / 'extra-schemas.json').write_bytes(export.stdout)
subprocess.run([sys.executable, str(scripts / 'verify_extra.py')], env=environment, check=True)
subprocess.run([sys.executable, str(scripts / 'verify_cipher.py')], env=environment, check=True)
subprocess.run([sys.executable, str(scripts / 'verify_home.py')], env=environment, check=True)
subprocess.run([sys.executable, str(scripts / 'verify_transport.py')], env=environment, check=True)
subprocess.run([sys.executable, str(scripts / 'verify_login_envelope.py')], env=environment, check=True)
subprocess.run([sys.executable, str(scripts / 'verify_development_peer.py')], env=environment, check=True)
fixtures = json.loads((args.output / 'native-fixtures.json').read_text())
failures = json.loads((args.output / 'native-failures.json').read_text())
if failures:
    raise SystemExit(f'{len(failures)} native codec verifications failed; consult native-failures.json')
extras = json.loads((args.output / 'native-extra.json').read_text())
ciphers = json.loads((args.output / 'native-salsa17-box.json').read_text())
agreements = json.loads((args.output / 'native-curve-boxes.json').read_text())
print(f'Validated {len(fixtures)} flat native observations, {len(extras)} Login/response round trips, {len(ciphers)} authenticated cipher vectors and {len(agreements)} key-agreement boxes. Results: {args.output.resolve()}')
print('Decrypted library is for analysis only; it has not had Arxan checksums updated and must not replace the client library.')

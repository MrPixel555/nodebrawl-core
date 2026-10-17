#!/usr/bin/env python3
"""Replace only assets/configs.so and re-sign; no Java/native recompilation."""
import argparse
import hashlib
from pathlib import Path
import subprocess
import tempfile
import zipfile

from build import REPO, check_alignment, repack, signing_key
from configuration import validate_config


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['apk', 'config', 'apksigner', 'output']:
        parser.add_argument('--' + name, type=Path, required=True)
    parser.add_argument('--signing-dir', type=Path, default=REPO / '.local')
    parser.add_argument('--java', default='java')
    args = parser.parse_args()
    if args.apk.resolve() == args.output.resolve():
        parser.error('Use a separate output filename to preserve the input APK')
    config = args.config.read_bytes()
    validate_config(config)
    with zipfile.ZipFile(args.apk) as archive:
        if 'assets/configs.so' not in archive.namelist():
            parser.error('Expected the file-configured private client APK')
    key, password = signing_key(args.signing_dir, args.java)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='client-config-') as directory:
        unsigned = Path(directory) / 'unsigned.apk'
        repack(args.apk, {'assets/configs.so': config}, unsigned)
        check_alignment(unsigned)
        subprocess.run([args.java, '-jar', str(args.apksigner), 'sign', '--ks', str(key), '--ks-key-alias', 'private-client', '--ks-pass', 'file:' + str(password), '--v4-signing-enabled', 'false', '--out', str(args.output), str(unsigned)], check=True)
    subprocess.run([args.java, '-jar', str(args.apksigner), 'verify', '--verbose', str(args.output)], check=True)
    check_alignment(args.output)
    with zipfile.ZipFile(args.apk) as original, zipfile.ZipFile(args.output) as updated:
        for name in original.namelist():
            if not name.upper().startswith('META-INF/') and name != 'assets/configs.so':
                if original.read(name) != updated.read(name):
                    raise ValueError('Unexpected APK modification: ' + name)
        assert updated.read('assets/configs.so') == config
    print('Updated', args.output, hashlib.sha256(args.output.read_bytes()).hexdigest())


if __name__ == '__main__':
    main()

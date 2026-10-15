import importlib.util
import json
import lzma
from pathlib import Path
import struct
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('apk_data', Path(__file__).resolve().parents[2] / 'tools/apk_data.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def manifest(target=None, cleartext=None, security_config=None):
    values = ['manifest', 'package', 'versionName', 'versionCode', 'com.supercell.clashroyale', '3.1.0',
              'uses-sdk', 'targetSdkVersion', 'application', 'usesCleartextTraffic', 'networkSecurityConfig']
    texts, offsets = bytearray(), []
    for text in values:
        offsets.append(len(texts))
        encoded = text.encode()
        texts.extend(bytes([len(text), len(encoded)]) + encoded + b'\0')
    pool = struct.pack('<HHIIIIII', 1, 28, 28 + 4 * len(values) + len(texts), len(values), 0, 256, 28 + 4 * len(values), 0)
    pool += struct.pack('<' + 'I' * len(values), *offsets) + texts
    attrs = b''.join(struct.pack('<IIIHBBI', 0xffffffff, key, raw, 8, 0, kind, value)
                     for key, raw, kind, value in [(1, 4, 3, 4), (2, 5, 3, 5), (3, 0xffffffff, 16, 400)])
    element = struct.pack('<HHIII', 0x102, 16, 36 + len(attrs), 1, 0xffffffff)
    element += struct.pack('<IIHHHHHH', 0xffffffff, 0, 20, 20, 3, 0, 0, 0) + attrs
    def extra(tag, fields):
        attrs = b''.join(struct.pack('<IIIHBBI', 0xffffffff, key, 0xffffffff, 8, 0, kind, value) for key, kind, value in fields)
        return struct.pack('<HHIII', 0x102, 16, 36 + len(attrs), 1, 0xffffffff) + struct.pack('<IIHHHHHH', 0xffffffff, tag, 20, 20, len(fields), 0, 0, 0) + attrs
    if target is not None:
        element += extra(6, [(7, 16, target)])
    fields = ([] if cleartext is None else [(9, 18, int(cleartext))]) + ([] if security_config is None else [(10, 1, security_config)])
    element += extra(8, fields)
    return struct.pack('<HHI', 3, 8, 8 + len(pool) + len(element)) + pool + element


class ApkDataTests(unittest.TestCase):
    def test_manifest_version_uses_typed_integer(self):
        self.assertEqual(module.manifest_identity(manifest()), {'package': 'com.supercell.clashroyale', 'versionName': '3.1.0', 'versionCode': 400})

    def test_manifest_rejects_truncation(self):
        with self.assertRaises(ValueError):
            module.manifest_identity(manifest()[:-1])

    def test_android_cleartext_default_changes_at_target_28(self):
        for target in [27, 28, 34]:
            policy = module.manifest_identity(manifest(target=target), include_network=True)['networkPolicy']
            self.assertEqual(policy['targetSdkVersion'], target)
            self.assertIs(policy['cleartextTrafficPermittedByManifest'], target < 28)
            self.assertIsNone(policy['usesCleartextTraffic'])

    def test_literal_cleartext_override_and_unresolved_network_config(self):
        for explicit in [True, False]:
            policy = module.manifest_identity(manifest(target=28, cleartext=explicit), include_network=True)['networkPolicy']
            self.assertIs(policy['cleartextTrafficPermittedByManifest'], explicit)
        policy = module.manifest_identity(manifest(target=28, security_config=0x7f010001), include_network=True)['networkPolicy']
        self.assertIsNone(policy['cleartextTrafficPermittedByManifest'])

    def test_supercell_lzma_roundtrip(self):
        source = b'Name,Value\nstring,int\nGold,100\n'
        compressed = lzma.compress(source, format=lzma.FORMAT_ALONE)
        supercell = compressed[:5] + struct.pack('<I', len(source)) + compressed[13:]
        self.assertEqual(module.decompress_csv(supercell), source)
        with self.assertRaises((ValueError, lzma.LZMAError)):
            module.decompress_csv(supercell[:-8])

    def test_expansion_limit(self):
        with self.assertRaises(ValueError):
            module.decompress_csv(b'\x5d\0\0\x04\0' + struct.pack('<I', module.MAX_CSV + 1))

    def test_plain_csv(self):
        self.assertEqual(module.decompress_csv(b'Name,Value\n'), b'Name,Value\n')

    def test_fingerprint_mismatch_creates_no_output(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'assets').mkdir()
            (root / 'assets/fingerprint.json').write_text(json.dumps({'files': [{'file': 'table.csv', 'sha': '0' * 40}]}))
            (root / 'assets/table.csv').write_text('Name,Value\n')
            with self.assertRaisesRegex(ValueError, 'SHA-1 mismatch'):
                module.build(root, root / 'out')
            self.assertFalse((root / 'out').exists())

    def test_fingerprint_traversal(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'assets').mkdir()
            (root / 'assets/fingerprint.json').write_text(json.dumps({'files': [{'file': '../escape', 'sha': '0' * 40}]}))
            with self.assertRaisesRegex(ValueError, 'Unsafe'):
                module.build(root, root / 'out')


if __name__ == '__main__':
    unittest.main()

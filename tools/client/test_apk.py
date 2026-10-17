"""Offline structure/integrity tests against the supplied and built APKs."""
import argparse
import hashlib
import io
import json
from pathlib import Path
import struct
import sys
import unittest
import zipfile

from loguru import logger
logger.remove()
from androguard.core.axml import AXMLPrinter
from androguard.core.dex import DEX
from elftools.elf.elffile import ELFFile
from lxml import etree

from build import check_alignment
from elf_patch import CALLS, LIBRARY_SHA, PUBLIC_KEY, Checksums, branch, ranges, runtime_image
from manifest import APPLICATION, GAME, ANDROID, patch_manifest
from configuration import validate_config

args = None


class ApkTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.original = zipfile.ZipFile(args.original)
        cls.patched = zipfile.ZipFile(args.apk)
        cls.report = json.loads(args.report.read_text())
        cls.ns = '{' + ANDROID + '}'

    @classmethod
    def tearDownClass(cls):
        cls.original.close()
        cls.patched.close()

    def test_unique_entries_and_crc(self):
        names = self.patched.namelist()
        self.assertEqual(len(names), len(set(names)))
        self.assertIsNone(self.patched.testzip())

    def test_only_manifest_library_and_new_files_change(self):
        for name in self.original.namelist():
            if not name.upper().startswith('META-INF/') and name not in ['AndroidManifest.xml', 'lib/arm64-v8a/libg.so']:
                self.assertEqual(hashlib.sha256(self.original.read(name)).digest(), hashlib.sha256(self.patched.read(name)).digest(), name)
        self.assertEqual(set(self.patched.namelist()) - set(self.original.namelist()) - {name for name in self.patched.namelist() if name.startswith('META-INF/')}, {'classes2.dex', 'assets/private-client-notices.txt', 'assets/configs.so'})

    def test_manifest_preserves_launcher_and_has_no_settings_activity(self):
        data = self.patched.read('AndroidManifest.xml')
        self.assertEqual(data, patch_manifest(self.original.read('AndroidManifest.xml')))
        printer = AXMLPrinter(data)
        self.assertTrue(printer.is_valid())
        root = printer.get_xml_obj()
        old = AXMLPrinter(self.original.read('AndroidManifest.xml')).get_xml_obj()
        application = root.find('application')
        self.assertEqual(application.get(self.ns + 'name'), APPLICATION)
        application.set(self.ns + 'name', old.find('application').get(self.ns + 'name'))
        self.assertEqual(etree.tostring(root), etree.tostring(old))
        self.assertTrue(all('org.nodebrawl' not in a.get(self.ns + 'name', '') for a in application.findall('activity')))
        game = next(a for a in application.findall('activity') if a.get(self.ns + 'name') == GAME)
        self.assertTrue(any(a.get(self.ns + 'name') == 'android.intent.action.MAIN' for a in game.findall('intent-filter/action')))

    def test_application_dex_has_no_activity_or_instrumentation_runtime(self):
        dex = DEX(self.patched.read('classes2.dex'))
        classes = dex.get_classes()
        self.assertEqual([c.get_name() for c in classes], ['Lorg/nodebrawl/client/ServerApplication;'])
        self.assertEqual(classes[0].get_superclassname(), 'Landroid/support/multidex/MultiDexApplication;')
        self.assertFalse(any('frida' in name.lower() or 'gadget' in name.lower() for name in self.patched.namelist()))

    def test_configuration_is_plain_text_and_validated(self):
        self.assertEqual(self.patched.read('assets/configs.so'), Path('client/configs.so').read_bytes())
        self.assertEqual(validate_config(b'223.223.223.1:9339\n'), ('223.223.223.1', 9339))
        self.assertEqual(validate_config(b'game.example.com:1234\r\n'), ('game.example.com', 1234))
        for value in [b'', b'256.2.3.4:9339', b'host:0', b'host:65536', b'http://example.com:9339', b'host:9339\ntrailing', b'a:9339\0x']:
            with self.assertRaises(ValueError):
                validate_config(value)

    def test_elf_adds_only_immutable_segment_and_seven_calls(self):
        library = self.patched.read('lib/arm64-v8a/libg.so')
        elf = ELFFile(io.BytesIO(library))
        original_library = args.library.read_bytes()
        original = ELFFile(io.BytesIO(original_library))
        self.assertEqual(hashlib.sha256(original_library).hexdigest(), LIBRARY_SHA)
        self.assertEqual(hashlib.sha256(library).hexdigest(), self.report['patchedLibrarySha256'])
        self.assertEqual(self.report['serverPublicKey'], PUBLIC_KEY)
        self.assertIn(bytes.fromhex(PUBLIC_KEY), library)
        self.assertEqual(elf.num_segments(), original.num_segments() + 1)
        for n, old in enumerate(original.iter_segments()):
            self.assertEqual(dict(old.header), dict(elf.get_segment(n).header))
        added = elf.get_segment(elf.num_segments() - 1)
        self.assertEqual(added['p_flags'], 5)
        self.assertGreaterEqual(elf['e_phoff'], added['p_offset'])
        self.assertLess(elf['e_phoff'] + elf['e_phnum'] * elf['e_phentsize'], added['p_offset'] + added['p_filesz'])
        self.assertEqual(added['p_offset'] % added['p_align'], added['p_vaddr'] % added['p_align'])
        memory, _ = runtime_image(elf)
        before, _ = runtime_image(original)
        permitted = set()
        for change in self.report['calls']:
            at = change['address']
            self.assertIn(at, CALLS)
            self.assertEqual(bytes(memory[at:at + 4]), branch(at, change['target']))
            permitted.update(range(at, at + 4))
        for segment in original.iter_segments():
            if segment['p_type'] == 'PT_LOAD' and segment['p_flags'] & 1:
                start, size = segment['p_vaddr'], segment['p_filesz']
                differing = {n for n in range(start, start + size) if before[n] != memory[n]}
                self.assertTrue(differing.issubset(permitted | set(range(32, 40)) | {56, 57}))
        self.assertEqual(len(self.report['calls']), 7)

    def test_all_integrity_tables_and_tamper_detection(self):
        memory, _ = runtime_image(ELFFile(io.BytesIO(self.patched.read('lib/arm64-v8a/libg.so'))))
        checksum = Checksums(args.work)
        self.assertEqual(len(self.report['integrity']), 13)
        for table in self.report['integrity']:
            entries = ranges(memory, int(table['table'], 16))
            actual = checksum.calculate(memory, entries)
            self.assertEqual(actual, table['updatedKeys'])
            for value, locations in zip(actual, table['locations']):
                for at in locations:
                    self.assertEqual(struct.unpack_from('<I', memory, at)[0], value)
        main = next(t for t in self.report['integrity'] if t['table'] == '0xbeefd4')
        memory[0x2641e4] ^= 1
        self.assertNotEqual(checksum.calculate(memory, ranges(memory, 0xbeefd4)), main['updatedKeys'])

    def test_stored_entry_alignment(self):
        check_alignment(args.apk)

    def test_apk_identity_and_github_size(self):
        self.assertEqual(args.apk.stat().st_size, self.report['apkBytes'])
        self.assertLess(args.apk.stat().st_size, 100 * 1024 * 1024)
        self.assertEqual(hashlib.sha256(args.apk.read_bytes()).hexdigest(), self.report['apkSha256'])


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['original', 'library', 'apk', 'report', 'work']:
        parser.add_argument('--' + name, type=Path, required=True)
    args = parser.parse_args()
    args.work.mkdir(parents=True, exist_ok=True)
    unittest.main(argv=[sys.argv[0]], verbosity=2)

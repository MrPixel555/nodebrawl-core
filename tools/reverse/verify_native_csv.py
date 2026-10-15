"""Compare native CSV row identities/typed values with the verified APK assets."""
import argparse
import csv
import hashlib
import json
from pathlib import Path

from native_csv import NativeCsv
from native_vm import ROOT

REPOSITORY = Path(__file__).resolve().parents[2]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--checkpoint', type=Path)
    parser.add_argument('--all', action='store_true', help='Parse and verify all mode-0 manifest tables')
    args = parser.parse_args()
    model = NativeCsv()
    if args.checkpoint and (args.checkpoint / 'state.json').exists():
        model.restore(args.checkpoint)
    manifest = model.manifest()
    assert len(manifest) == 74
    mapping = {row['kind']: row['path'] for row in manifest if row['mode'] == 0}
    assert len(mapping) == 72
    assert {kind: mapping[kind] for kind in (12, 15, 18, 57, 72, 79)} == {
        12: 'csv_logic/predefined_decks.csv', 15: 'csv_logic/locations.csv',
        18: 'csv_logic/npcs.csv', 57: 'csv_logic/regions.csv',
        72: 'csv_logic/game_modes.csv', 79: 'csv_logic/pve_gamemodes.csv'}
    expected = {row['path']: row for row in json.loads((REPOSITORY / 'docs/apk-evidence.json').read_text())['tables']}
    verified = []
    for kind, path in mapping.items():
        if not args.all and kind not in (15, 18, 79):
            continue
        source = ROOT / 'game-data-verified' / path
        digest = hashlib.sha256(source.read_bytes()).hexdigest()
        assert digest == expected[path]['decodedSha256'], path
        rows = [row for row in list(csv.DictReader(source.open(encoding='utf-8-sig', newline='')))[1:] if row['Name']]
        table = model.load(path, kind)
        vm = model.vm
        assert model.integer(table + 0x14) == len(rows), path
        for index, row in enumerate(rows):
            pointer = vm.call(0x2b53d4, table, index)
            assert model.integer(pointer + 0x20) == kind * 1000000 + index
            assert model.read_string(vm.call(0x3c0638, pointer)) == row['Name'], (path, index)
        record = {'kind': kind, 'path': path, 'decodedSha256': digest,
                  'nativeRecords': len(rows), 'nativeNamesAndGlobalIdsMatched': True}
        if kind == 15:
            node = model.nodes[path]
            csv_table = model.qword(node)
            column = vm.call(0x2d3f24, csv_table, model.string('FileName'))
            assert column != 0xffffffff and column < 100
            location = vm.call(0x320e20, csv_table, 1)
            # Native row index differs from record index for multi-row records.
            value = vm.call(0x44cbd0, location, column)
            assert model.read_string(value) == 'locations/training_arena.csv'
            record['trainingCampFile'] = model.read_string(value)
        if args.checkpoint:
            model.save(args.checkpoint)
        verified.append(record)
        print(f"PASS {kind} {path}: {len(rows)} native identities", flush=True)
    report = {'librarySha256': hashlib.sha256((ROOT / 'libg.so').read_bytes()).hexdigest(),
              'manifestFunction': '0x3f8548', 'manifestEntries': manifest,
              'csvStaticInitializer': '0xe1140', 'csvParser': '0x4a461c',
              'dataTableLoader': '0x41c214', 'verifiedTables': verified,
              'scope': 'Original CSV parser and record constructors; libc adapters only. Cross-table field linking, battle snapshots, simulation and Android battle UI remain unverified.'}
    (ROOT / 'native-csv-verification.json').write_text(json.dumps(report, indent=2) + '\n')
    print('Native CSV identities PASS; full battle/gameplay NOT verified')


if __name__ == '__main__':
    main()

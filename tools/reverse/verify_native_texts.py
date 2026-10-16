"""Verify a retained original-parser text table against every decoded APK cell.

The input is a locally generated NativeCsv checkpoint, not an uploaded VM state.
This read-only check does not initialize game data, render text or start battles.
"""
import argparse
import csv
import hashlib
import json
from pathlib import Path

from native_csv import NativeCsv
from native_vm import ROOT

REPOSITORY = Path(__file__).resolve().parents[2]
PATH = 'csv_client/texts.csv'


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--checkpoint', type=Path, required=True,
                        help='Locally generated NativeCsv checkpoint containing the completed text table')
    args = parser.parse_args()
    model = NativeCsv()
    model.restore(args.checkpoint)
    assert PATH in model.nodes, 'Original text CSV parsing must complete before this check'
    source = ROOT / 'game-data-verified' / PATH
    digest = hashlib.sha256(source.read_bytes()).hexdigest()
    evidence = json.loads((REPOSITORY / 'docs/apk-evidence.json').read_text())['tables']
    assert digest == next(row['decodedSha256'] for row in evidence if row['path'] == PATH)
    with source.open(newline='', encoding='utf-8') as handle:
        rows = list(csv.reader(handle))
    headers, types, cells = rows[0], rows[1], rows[2:]
    assert len(headers) == 22 and types == ['string'] * 22
    assert all(len(row) == 22 for row in cells)
    named = [(index, row[0]) for index, row in enumerate(cells) if row[0]]
    table = model.qword(model.nodes[PATH])
    assert model.integer(table + 12) == len(headers)
    assert model.integer(table + 0x2c) == len(named)
    for column in range(len(headers)):
        descriptor = model.qword(model.qword(table + 0x10) + column * 8)
        assert model.integer(descriptor) == 0
        assert model.integer(descriptor + 0x14) == len(cells)
        values = model.qword(descriptor + 8)
        for index, row in enumerate(cells):
            assert model.read_string(values + index * 24) == row[column], (index, column)
    vm = model.vm
    for index, (physical, name) in enumerate(named):
        row = vm.call(0x320e20, table, index)
        assert vm.call(0x393ba0, row) == physical
        assert model.read_string(vm.call(0x44cbd0, row, 0)) == name
    # Exercise native getters on both named and continuation rows/languages.
    continuation = [index for index, row in enumerate(cells) if not row[0]]
    samples = sorted({0, len(cells) - 1, *continuation})
    for index in samples:
        for column in range(len(headers)):
            assert model.read_string(vm.call(0x2c4dac, table, column, index)) == cells[index][column]
    report = {
        'librarySha256': hashlib.sha256((ROOT / 'libg.so').read_bytes()).hexdigest(),
        'path': PATH, 'decodedSourceSha256': digest, 'nativeParser': '0x4a461c',
        'columns': headers, 'physicalRows': len(cells), 'namedRows': len(named),
        'continuationRows': continuation, 'cellsMatched': len(cells) * len(headers),
        'allNativeNamesAndPhysicalOffsetsMatched': True, 'gameCodeAdapters': [],
        'scope': 'Original base text CSV only; source strings and native getter behavior. Does not verify patch overlays, fonts/rendering, cross-table linking or gameplay.'}
    (ROOT / 'native-texts-verification.json').write_text(json.dumps(report, indent=2) + '\n')
    print(f'Native texts PASS: {len(named)} names, {len(cells)} physical rows, {len(cells) * len(headers)} cells; gameplay NOT verified')


if __name__ == '__main__':
    main()

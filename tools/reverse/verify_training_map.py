"""Run the original Training terrain parser against independently decoded CSV.

Verifies geometry and source tower coordinates, not instantiated battle objects,
HP, teams, collision/pathfinding, snapshots, simulation or Android battle UI.
"""
import csv
import hashlib
import json
import struct
from pathlib import Path

from native_csv import NativeCsv
from native_vm import ROOT

REPOSITORY = Path(__file__).resolve().parents[2]


def main():
    model = NativeCsv()
    vm = model.vm
    sources = ['locations/training_arena.csv', 'tilemaps/tilemap.csv']
    evidence = {row['path']: row for row in json.loads((REPOSITORY / 'docs/apk-evidence.json').read_text())['tables']}
    hashes = {}
    for path in sources:
        hashes[path] = hashlib.sha256((ROOT / 'game-data-verified' / path).read_bytes()).hexdigest()
        assert hashes[path] == evidence[path]['decodedSha256'], path
    visual, tile = [model.parse(path) for path in sources]
    level = vm.alloc(0xb8)
    vm.call(0x1bf3b4, level)
    vm.call(0x316148, level, visual, tile)
    vm.call(0x21ba6c, level, count=100000000, max_slices=5)
    width, height = vm.call(0x5a4f44, level), vm.call(0x5f819c, level)
    assert (width, height) == (36, 64)
    with (ROOT / 'game-data-verified' / sources[1]).open(newline='') as handle:
        rows = list(csv.reader(handle))
    assert rows[0][0] == 'Map' and rows[1][1:37] == ['x'] * 36 and rows[2][1:37] == ['int'] * 36
    end = next(index for index, row in enumerate(rows[3:], 3) if row[0])
    cells = rows[3:end]
    assert len(cells) == height and all(len(row[1:37]) == width for row in cells)
    raw = [int(value or 0) for row in cells for value in row[1:37]]
    arrays = []
    for offset, mask in [(0xa0, 0x7f), (0xa8, 0x180)]:
        data = bytes(vm.uc.mem_read(model.qword(level + offset), width * height * 4))
        native = list(struct.unpack('<' + 'i' * (width * height), data))
        assert native == [value & mask for value in raw]
        arrays.append({'offset': hex(offset), 'mask': hex(mask), 'cells': len(native),
                       'int32LittleEndianSha256': hashlib.sha256(data).hexdigest(),
                       'distinctValues': sorted(set(native)), 'allCellsMatched': True})
    layout = vm.call(0x14f3bc, tile, model.string('Layout'))
    assert layout and vm.call(0x4d4af8, layout) == 2
    expected = {'PrincessTower': [[29, 51], [7, 13], [7, 51], [29, 13]],
                'KingTower': [[18, 6], [18, 58]]}
    towers = {}
    for name, positions in expected.items():
        node = vm.call(0x14f3bc, layout, model.string(name))
        table = vm.call(0x33c9e4, node)
        assert table and vm.call(0x5fc16c, table) == len(positions)
        actual = []
        for index in range(len(positions)):
            row = vm.call(0x320e20, table, index)
            actual.append([vm.call(0x68acec, row, column) for column in (0, 1)])
        assert actual == positions
        assert all(0 <= x < width and 0 <= y < height for x, y in actual)
        towers[name] = actual
    report = {
        'librarySha256': hashlib.sha256((ROOT / 'libg.so').read_bytes()).hexdigest(),
        'decodedSourceSha256': hashes, 'levelConstructor': '0x1bf3b4',
        'sourceAssignment': '0x316148', 'tileParser': '0x21ba6c',
        'width': width, 'height': height, 'nativeTerrainArrays': arrays,
        'nativeCsvTowerCoordinates': towers, 'gameCodeAdapters': [],
        'scope': 'Native terrain extraction and CSV coordinates only. Does not instantiate towers/players or verify their stats, battle snapshot, physics, simulation or Android UI.'}
    (ROOT / 'native-training-map.json').write_text(json.dumps(report, indent=2) + '\n')
    print('Training map PASS: 36x64, both native terrain arrays (4608 values), six source tower coordinates; battle NOT verified')


if __name__ == '__main__':
    main()

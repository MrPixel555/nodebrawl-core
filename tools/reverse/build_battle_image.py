"""Build the optional offline image consumed by the Node battle runtime.

Requires GAME_ANALYSIS_DIR and the existing Python reverse-engineering tools.
The input checkpoint must already contain fully linked original CSV tables.
No accounts or constructed matches are put in the output image.
"""
import argparse
import csv
import hashlib
import json
from pathlib import Path

from native_csv import NativeCsv
from native_vm import ROOT

LIBRARY_SHA256 = '4dd79f7c143fe87dba0e3c7521fe150bf1e018783a2e04632bd38bba5dafde5a'


def build(checkpoint, output):
    assert hashlib.sha256((ROOT / 'libg.so').read_bytes()).hexdigest() == LIBRARY_SHA256
    output.mkdir(parents=True, exist_ok=True)
    image = output / 'image'
    model = NativeCsv()
    model.restore(checkpoint)
    vm = model.vm
    assert model.integer(0xd6c128) == 1, 'CSV fields must be fully linked'

    def fatal(cpu):
        raise RuntimeError('Native diagnostic: ' + cpu.string(cpu.reg(0)).decode(errors='replace'))

    vm.register_hook(0x736afc, fatal)

    def rows(kind):
        table = model.qword(0xd5dc68 + kind * 8)
        vtable = model.qword(table)
        return [vm.call(model.qword(vtable + 0x28), table, i)
                for i in range(vm.call(model.qword(vtable + 0x20), table))]

    def name(pointer):
        return model.read_string(model.qword(pointer + 8))

    def source_rows(filename):
        with (ROOT / 'game-data-verified' / 'csv_logic' / (filename + '.csv')).open(encoding='utf-8') as source:
            # The first data row declares column types, not a game record.
            return list(csv.DictReader(source))[1:]

    locations = []
    for index, pointer in enumerate(rows(15)):
        row = model.qword(pointer + 0x10)
        visual = model.read_string(vm.call(0x33d9c0, row, model.string('FileName'), 0))
        tiles = model.read_string(vm.call(0x33d9c0, row, model.string('TileDataFileName'), 0))
        if not visual or not tiles:
            continue
        print('Loading', index, visual, flush=True)
        vm.call(0x49b630, model.parse(visual), model.parse(tiles), index,
                count=100000000, max_slices=5)
        level = model.qword(model.qword(0xd62cd0) + 8 * index)
        locations.append({'id': 15000000 + index, 'name': name(pointer),
                          'file': visual, 'tilemap': tiles,
                          'width': vm.call(0x5a4f44, level),
                          'height': vm.call(0x5f819c, level)})
    assert len(locations) == 53
    # Save before allocating export-only strings and temporary metadata.
    vm.hooks.pop(0x736afc)
    model.save(image, scope='Fully linked original CSV data and all original arena LevelData, with no constructed match or accounts.')
    (image / 'state.json').rename(image / 'manifest.json')
    vm.register_hook(0x736afc, fatal)

    spells = [{'index': i + 1, 'id': model.integer(p + 0x20), 'name': name(p),
               'hasExtraFields': bool(vm.call(0x1e6e98, p) & 1)}
              for i, p in enumerate(rows(7))]
    catalogue = {'librarySha256': LIBRARY_SHA256, 'locations': locations, 'spells': spells}
    for kind, filename, key in [(18, 'npcs', 'npcs'), (54, 'arenas', 'arenas'),
                                (72, 'game_modes', 'modes'), (79, 'pve_gamemodes', 'pveModes')]:
        by_name = {row['Name']: row for row in source_rows(filename) if row['Name']}
        catalogue[key] = [{'id': model.integer(p + 0x20), **by_name[name(p)]} for p in rows(kind)]
    spell_ids = {spell['name']: spell['id'] for spell in spells}
    decks = {}
    current = None
    for row in source_rows('predefined_decks'):
        if row['Name']:
            current = row['Name']
            decks[current] = []
        if row['Spells']:
            assert current is not None
            decks[current].append({'d': spell_ids[row['Spells']],
                                   'l': int(row['SpellLevel'] or '1') - 1, 'c': 1})
    catalogue['decks'] = decks
    (output / 'catalogue.json').write_text(json.dumps(catalogue, separators=(',', ':')) + '\n')
    imports = [{'address': address, 'slot': slot, 'name': vm.imports[address]}
               for slot, address in vm.import_slots.items()]
    imports.sort(key=lambda item: item['address'])
    (output / 'imports.json').write_text(json.dumps(imports, indent=2) + '\n')
    print('Saved', len(locations), 'locations and', len(spells), 'spell descriptors to', output)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--checkpoint', type=Path, default=ROOT / 'native-csv-linked-state')
    parser.add_argument('--output', type=Path, required=True)
    options = parser.parse_args()
    build(options.checkpoint, options.output)

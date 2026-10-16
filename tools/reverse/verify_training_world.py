"""Construct and round-trip a native two-player Training replay world.

Requires a locally produced fully linked NativeCsv checkpoint. This is not a
live Training provider: replay setup, gameplay stepping, input handling, dynamic
account bindings and Android battle UI are distinct verification targets.
"""
import argparse
import csv
import hashlib
import json
import struct
from pathlib import Path

from native_csv import NativeCsv
from native_vm import ROOT


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--checkpoint', type=Path, default=ROOT / 'native-csv-linked-state')
    args = parser.parse_args()
    model = NativeCsv()
    model.restore(args.checkpoint)
    vm = model.vm
    assert vm.uc.mem_read(0xd6c128, 1)[0] == 1, 'Original game-data field linking must have completed'

    def fatal(machine):
        raise RuntimeError('Native diagnostic: ' + machine.string(machine.reg(0)).decode(errors='replace'))

    vm.register_hook(0x736afc, fatal)

    def data(kind, name):
        table = model.qword(0xd5dc68 + kind * 8)
        pointer = vm.call(model.qword(model.qword(table) + 0x38), table, model.string(name))
        assert pointer, (kind, name)
        return pointer

    def identity(pointer):
        return model.integer(pointer + 0x20)

    location, npc, mode = data(15, 'TrainingCamp'), data(18, 'Npc8'), data(72, 'Training')
    row = model.qword(location + 0x10)
    visual_path = model.read_string(vm.call(0x33d9c0, row, model.string('FileName'), 0))
    tile_path = model.read_string(vm.call(0x33d9c0, row, model.string('TileDataFileName'), 0))
    visual, tile = model.parse(visual_path), model.parse(tile_path)
    vm.call(0x49b630, visual, tile, identity(location) % 1000000, count=100000000, max_slices=5)
    level = model.qword(model.qword(0xd62cd0) + 8 * (identity(location) % 1000000))
    assert (vm.call(0x5a4f44, level), vm.call(0x5f819c, level)) == (36, 64)
    source = ROOT / 'game-data-verified/csv_logic'
    with (source / 'npcs.csv').open(newline='') as handle:
        npc_row = next(row for row in list(csv.DictReader(handle))[1:] if row['Name'] == 'Npc8')
    with (source / 'predefined_decks.csv').open(newline='') as handle:
        predefined = list(csv.DictReader(handle))[1:]
    npc_deck, active = [], False
    for entry in predefined:
        if entry['Name']:
            if active:
                break
            active = entry['Name'] == npc_row['PredefinedDeck']
        if active:
            npc_deck.append({'d': identity(data(7, entry['Spells'])), 'l': int(entry['SpellLevel']) - 1, 'c': 1})
    assert len(npc_deck) == 8
    own_deck = [{'d': identity(data(7, name)), 'l': 0, 'c': 1} for name in
                ('Knight', 'Archer', 'Giant', 'Minions', 'Musketeer', 'MiniPekka', 'Fireball', 'Arrows')]

    def avatar(low, name, level):
        return {'accountID.hi': 0, 'accountID.lo': low, 'name': name,
                'expLevel': level, 'expPoints': 0, 'arena': 54000001}

    battle = {'gmt': 0, 'plt': 0, 'gamemode': identity(mode), 'location': identity(location),
              'arena': 54000001, 'NPC': identity(npc), 'hbd': [{'em': {}}, {'em': {}}],
              'deck0': own_deck, 'deck1': npc_deck, 'avatar0': avatar(1, 'Player', 1),
              'avatar1': avatar(0, 'Trainer', int(npc_row['ExpLevel']))}
    game = vm.alloc(0x200)
    vm.call(0x3cd494, game, 1)
    world = model.qword(game + 0xa0)
    owner = vm.alloc(8)
    vm.uc.mem_write(owner, struct.pack('<ii', 0, 1))
    vm.call(0x1d6044, world, owner)
    root = {'rndSeed': 2, 'time': 1600000000, 'battle': battle, 'cmd': [], 'evt': []}
    parsed = vm.call(0x73b08c, model.string(json.dumps(root)))
    vm.call(0x2211f0, game, parsed, 0, 0, count=100000000, max_slices=10)
    assert model.integer(game + 0x1c) == 4 and model.integer(world + 0x10) == 3
    assert model.integer(world + 0x50) == 2
    assert all(model.qword(game + 0xd0 + 8 * i) for i in range(2))
    observations = []
    for force in (False, True):
        stream, buffer = vm.stream()
        vm.call(0x15a920, game, stream, 1, 0, 1, count=100000000, max_slices=5)
        init_bytes = model.integer(stream + 0x14)
        vm.call(0x121748, game, stream, 1, 0, int(force), count=100000000, max_slices=5)
        size = model.integer(stream + 0x14)
        wire = bytes(vm.uc.mem_read(buffer, size))
        fresh = vm.alloc(0x200)
        vm.call(0x3cd494, fresh, 1)
        decoded_world = model.qword(fresh + 0xa0)
        vm.call(0x1d6044, decoded_world, owner)
        inp, _ = vm.stream(wire)
        vm.call(0x6123b8, fresh, inp, count=100000000, max_slices=5)
        assert model.integer(inp + 0x14) == init_bytes
        vm.call(0x431508, fresh, inp, 1, 0, count=100000000, max_slices=5)
        assert model.integer(inp + 0x14) == size
        assert model.integer(decoded_world + 0x50) == 2
        out, buf = vm.stream()
        vm.call(0x15a920, fresh, out, 1, 0, 1, count=100000000, max_slices=5)
        vm.call(0x121748, fresh, out, 1, 0, int(force), count=100000000, max_slices=5)
        assert model.integer(out + 0x14) == size and bytes(vm.uc.mem_read(buf, size)) == wire
        observations.append({'forceWorldType4': force, 'initializationBytes': init_bytes, 'totalBytes': size,
                             'worldType': model.integer(decoded_world + 0x10), 'players': 2,
                             'payloadSha256': hashlib.sha256(wire).hexdigest(), 'nativeReencodeEqual': True})
    report = {'librarySha256': hashlib.sha256((ROOT / 'libg.so').read_bytes()).hexdigest(),
              'fullyLinkedGameData': True, 'levelLoader': '0x49b630', 'map': [36, 64],
              'replayInitializer': '0x2211f0', 'gameModeState': 4, 'sourceWorldType': 3,
              'npc': identity(npc), 'npcDeck': npc_row['PredefinedDeck'], 'mode': identity(mode),
              'appearanceJson': [{'em': {}}, {'em': {}}], 'roundtrips': observations,
              'gameDataLookupAdapters': [], 'adaptedBoundary': ['fatal diagnostic capture', 'libc/POSIX VM imports'],
              'scope': 'Original replay initializer, two avatars, full map, initialization/full-state codecs. Synthetic probe account identities, names, seed/time and zero gmt/plt; NPC levels converted from CSV minus one. Not a verified live Training snapshot, stepped battle, input protocol, tower HP, AI or Android gameplay.'}
    (ROOT / 'native-training-world.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()

"""Build a starter Home using native codecs and explicit CSV-backed data adapters.

The data adapters implement table lookup only; Home/card/avatar codecs execute.
This is a lobby candidate for device testing, not verified Android gameplay.
"""
import csv
import hashlib
import json
import struct

from native_vm import NativeVM, ROOT
from verify_home import decode, encode, read_u32
from unicorn.arm64_const import UC_ARM64_REG_LR


def qword(vm, address):
    return struct.unpack('<Q', vm.uc.mem_read(address, 8))[0]


def word(vm, address, value):
    vm.uc.mem_write(address, struct.pack('<i', value))


class StarterHome:
    def __init__(self):
        self.vm = vm = NativeVM(trace_instructions=False)
        self.tables = {}
        self.rows = {}
        self.data = {}
        self.records = {}
        self.bindings = []
        self.stream = None
        table_vtable = vm.alloc(0x70)
        for slot, address, action in [
            (0x20, 0x20004000, lambda machine: len(self.tables[machine.reg(0)])),
            (0x28, 0x20004004, lambda machine: self.tables[machine.reg(0)][machine.reg(1)]),
            (0x58, 0x20004008, lambda machine: self.data[machine.reg(1)]),
            (0x68, 0x2000400c, lambda machine: self.tables[machine.reg(0)].index(machine.reg(1))),
        ]:
            vm.uc.mem_write(table_vtable + slot, struct.pack('<Q', address))
            vm.register_hook(address, lambda machine, action=action: machine.ret(action(machine)))
        for kind, name in [(26, 'spells_characters'), (27, 'spells_buildings'), (28, 'spells_other'), (54, 'arenas'), (5, 'resources')]:
            path = ROOT / 'game-data-verified/csv_logic' / (name + '.csv')
            rows = list(csv.DictReader(path.open(encoding='utf-8-sig', newline='')))[1:]
            rows = [row for row in rows if row['Name']]
            self.rows[kind] = rows
            pointers = []
            for index, row in enumerate(rows):
                pointer = vm.alloc(0x100)
                global_id = kind * 1000000 + index
                word(vm, pointer + 0x20, global_id)
                rarity = vm.alloc(0x100)
                vm.uc.mem_write(pointer + 0x30, struct.pack('<Q', rarity))
                self.data[global_id] = pointer
                self.records[(kind, row['Name'])] = pointer
                pointers.append(pointer)
            self.install_table(kind, pointers, table_vtable)
        # The spell table has a combined ordinal across the three spell CSVs.
        self.install_table(7, [self.data[kind * 1000000 + n] for kind in (26, 27, 28) for n in range(len(self.rows[kind]))], table_vtable)
        seed = bytearray(8192)
        seed[331] = 9
        self.object, self.buffer, consumed, _ = decode(vm, bytes(seed))
        assert consumed == 374
        self.home = qword(vm, self.object + 0x80)
        self.avatar = qword(vm, self.object + 0x88)
        self.deck = [self.records[kind, name] for kind, name in [
            (26, 'Knight'), (26, 'Archer'), (26, 'Giant'), (26, 'Minions'),
            (26, 'Musketeer'), (26, 'MiniPekka'), (28, 'Fireball'), (28, 'Arrows'),
        ]]
        self.deck_ids = [read_u32(vm, pointer + 0x20) for pointer in self.deck]
        # Five native deck arrays, eight global spell IDs in each.
        decks = qword(vm, self.home + 0x150)
        for n in range(5):
            pointer = qword(vm, decks + n * 8)
            vm.uc.mem_write(pointer, struct.pack('<8i', *self.deck_ids))
        word(vm, self.home + 0x134, 8)
        for n, data in enumerate(self.deck):
            card = vm.alloc(0x40)
            vm.call(0x3fe540, card)
            vm.uc.mem_write(card + 8, struct.pack('<Q', data))
            vm.uc.mem_write(self.home + 0x20 + n * 8, struct.pack('<Q', card))
        arena = self.records[54, 'Arena1']
        for offset in (0x38, 0x158):
            vm.uc.mem_write(self.avatar + offset, struct.pack('<Q', arena))
        for offset, value in [(0xd8, 1), (0xdc, 0), (0xe0, 100), (0xe4, 100), (0x144, 7)]:
            word(vm, self.avatar + offset, value)
        vm.uc.mem_write(self.avatar + 0x14d, b'\1')
        self.commodities(0, [('Gold', 100)])
        self.commodities(4, [('MaxScore', 0), ('MaxArena', 1), ('CardCount', 8)])
        # The decoder accepts an absent event catalogue, but lobby queries
        # 0x551634 -> 0x243178 dereference it without a null check. Preserve an
        # actual native empty catalogue, including its default revision -1.
        events = vm.alloc(0x18)
        vm.call(0x6a22ec, events)
        manager = qword(vm, self.home + 0x4f8)
        vm.uc.mem_write(manager + 0x10, struct.pack('<Q', events))
        vm.register_hook(0x344840, self.observe_home_id)
        vm.register_hook(0x241ecc, self.observe_avatar_id)
        vm.register_hook(0x5e0f60, self.observe_name)
        vm.register_hook(0x45d234, self.observe_selection)
        vm.register_hook(0x1544f4, self.observe_decode_return)
        self.decoded_message = None

    def observe_decode_return(self, vm):
        # Same saved X19 register and offsets used by the device Home callout.
        self.decoded_message = vm.reg(19)

    def install_table(self, kind, pointers, vtable):
        table = self.vm.alloc(8)
        self.vm.uc.mem_write(table, struct.pack('<Q', vtable))
        self.tables[table] = pointers
        self.vm.uc.mem_write(0xd5dc68 + kind * 8, struct.pack('<Q', table))

    def commodities(self, group, values):
        vm = self.vm
        collection = qword(vm, self.avatar + 0x90 + group * 8)
        pointers = vm.alloc(len(values) * 8)
        for n, (name, value) in enumerate(values):
            commodity = vm.alloc(16)
            vm.call(0x1c4a60, commodity, self.records[5, name], value)
            vm.uc.mem_write(pointers + n * 8, struct.pack('<Q', commodity))
        vm.uc.mem_write(collection, struct.pack('<Qii', pointers, len(values), len(values)))

    def observe_home_id(self, vm):
        if vm.reg(0) == self.stream and vm.reg(1) == qword(vm, self.home + 0x18):
            self.bindings.append({'offset': read_u32(vm, self.stream + 0x14), 'bytes': 8, 'field': 'accountId', 'type': 'long'})

    def observe_avatar_id(self, vm):
        if vm.reg(0) == self.stream and vm.reg(1) in [self.avatar + n for n in (0x10, 0x18, 0x20)]:
            self.bindings.append({'offset': read_u32(vm, self.stream + 0x14), 'bytes': self.id_bytes, 'field': 'accountId', 'type': 'vlong'})

    def observe_name(self, vm):
        if vm.reg(0) == self.stream and vm.reg(1) == self.avatar + 0x60:
            self.bindings.append({'offset': read_u32(vm, self.stream + 0x14), 'bytes': 4 + len(self.name.encode()), 'field': 'name', 'type': 'string'})

    def observe_selection(self, vm):
        if vm.reg(0) == self.stream and vm.uc.reg_read(UC_ARM64_REG_LR) == 0x34c6c0:
            self.bindings.append({'offset': read_u32(vm, self.stream + 0x14), 'bytes': 1, 'field': 'selectedDeck', 'type': 'vint'})

    def make(self, account_id=(0, 37), name='Player', selected_deck=0):
        vm = self.vm
        assert selected_deck in range(5)
        word(vm, self.home + 0x2a0, selected_deck)
        self.name = name
        def vint_size(value):
            return next((n for n, limit in enumerate([64, 8192, 1048576, 134217728], 1) if abs(value) < limit), 5)
        self.id_bytes = sum(vint_size(n) for n in account_id)
        vm.uc.mem_write(qword(vm, self.home + 0x18), struct.pack('<ii', *account_id))
        for offset in (0x10, 0x18, 0x20):
            vm.uc.mem_write(self.avatar + offset, struct.pack('<ii', *account_id))
        text = vm.alloc(len(name.encode()) + 1)
        vm.uc.mem_write(text, name.encode() + b'\0')
        vm.call(0x65612c, self.avatar + 0x60, text)
        self.bindings.clear()
        self.stream = self.object + 0x10
        payload = encode(vm, self.object, self.buffer)
        self.stream = None
        assert len(self.bindings) == 6, self.bindings
        # The complete native decoder must resolve all cards/resources/arena and
        # reproduce the full message, not merely accept its length prefix.
        second, buffer, consumed, reads = decode(vm, payload)
        assert self.decoded_message == second
        assert self.decoded_message + 0x10 == vm.input_stream
        assert consumed == len(payload)
        assert encode(vm, second, buffer) == payload
        avatar = qword(vm, second + 0x88)
        assert bytes(vm.uc.mem_read(avatar + 0x10, 24)) == struct.pack('<ii', *account_id) * 3
        assert read_u32(vm, avatar + 0xd8) == 1 and read_u32(vm, avatar + 0xe0) == 100
        assert qword(vm, avatar + 0x158) == self.records[54, 'Arena1']
        gold = qword(vm, qword(vm, qword(vm, avatar + 0x90)))
        assert qword(vm, gold) == self.records[5, 'Gold'] and read_u32(vm, gold + 8) == 100
        home = qword(vm, second + 0x80)
        events = qword(vm, qword(vm, home + 0x4f8) + 0x10)
        assert events and read_u32(vm, events + 0x14) == 0
        assert vm.call(0x551634, home) == 0
        assert vm.call(0x4c29a0, home) == 0
        assert read_u32(vm, home + 0x2a0) == selected_deck
        assert read_u32(vm, home + 0x134) == 8
        for n, expected in enumerate(self.deck):
            card = qword(vm, home + 0x20 + n * 8)
            assert qword(vm, card + 8) == expected
        return payload


def main():
    model = StarterHome()
    payload = model.make()
    parts = []
    at = 0
    for binding in sorted(model.bindings, key=lambda binding: binding['offset']):
        offset = binding['offset']
        assert at <= offset
        if offset > at:
            parts.append({'hex': payload[at:offset].hex()})
        parts.append({name: binding[name] for name in ('field', 'type')})
        at = offset + binding['bytes']
    if at < len(payload):
        parts.append({'hex': payload[at:].hex()})
    output = {'schema': 1, 'librarySha256': hashlib.sha256((ROOT / 'libg.so').read_bytes()).hexdigest(),
              'messageId': 21217, 'version': 0, 'parts': parts,
              'starter': {'deckIds': model.deck_ids, 'gold': 100, 'gems': 100, 'level': 1, 'arena': 'Arena1'},
              'androidLobbyVerified': False,
              'scope': 'Native codec round trip with CSV-backed data lookup adapters; not Android gameplay'}
    (ROOT / 'starter-home.json').write_text(json.dumps(output, indent=2) + '\n')
    fixtures = [{'accountId': [0, 37], 'name': 'Player', 'payloadHex': payload.hex()}]
    for account_id, name in [((0, 1), 'Player'), ((0, 8192), 'بازیکن'), ((0, 2147483647), 'Starter player with a longer name')]:
        fixtures.append({'accountId': list(account_id), 'name': name, 'payloadHex': model.make(account_id, name).hex()})
    for selected in (1, 4):
        fixtures.append({'accountId': [0, 1], 'name': 'Player', 'selectedDeck': selected,
                         'payloadHex': model.make((0, 1), 'Player', selected).hex()})
    (ROOT / 'starter-home-fixture.json').write_text(json.dumps(fixtures, indent=2) + '\n')
    print(f'Starter Home: {len(payload)} bytes, 8 resolved cards, 5 decks, native decode/reencode PASS')


if __name__ == '__main__':
    main()

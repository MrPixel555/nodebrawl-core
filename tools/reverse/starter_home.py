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
        self.expected_bindings = 62
        self.stream = None
        self.profile_id = None
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
        self.cards = {}
        for n, data in enumerate(self.deck):
            card = vm.alloc(0x40)
            vm.call(0x3fe540, card)
            vm.uc.mem_write(card + 8, struct.pack('<Q', data))
            vm.uc.mem_write(self.home + 0x20 + n * 8, struct.pack('<Q', card))
            self.cards[self.deck_ids[n]] = card
        arena = self.records[54, 'Arena1']
        for offset in (0x38, 0x158):
            vm.uc.mem_write(self.avatar + offset, struct.pack('<Q', arena))
        for offset, value in [(0xd8, 1), (0xdc, 0), (0xe0, 100), (0xe4, 100), (0x144, 7)]:
            word(vm, self.avatar + offset, value)
        # Home also carries the last applied avatar level. Leaving the seed's
        # zero here makes native command 805 request a 0 -> 2 transition, and
        # its level-data lookup indexes exp_levels at -1. Keep both copies at
        # level 1 before encoding; this is a wire field, not a runtime patch.
        word(vm, self.home + 0x3c8, 1)
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
        vm.register_hook(0x487e90, self.observe_flags)
        vm.register_hook(0x54ff70, self.observe_commodity)
        vm.register_hook(0x6d5a08, self.observe_card)
        vm.register_hook(0x1032d8, self.observe_profile_id)
        self.gold_pending = False
        vm.register_hook(0x1544f4, self.observe_decode_return)
        self.decoded_message = None
        self.fragments = {}
        for entry, end, offset, field in [(0x29e1d4, 0x34cfa8, 0x5d0, 'arenaBoostTimers'),
                                          (0x543f70, 0x34d26c, 0x650, 'arenaBoostClaim')]:
            vm.register_hook(entry, lambda machine, offset=offset, field=field: self.fragment_start(machine, offset, field))
            vm.register_hook(end, lambda machine, field=field: self.fragment_end(machine, field))

    def fragment_start(self, vm, offset, field):
        if self.stream is not None and vm.reg(0) == qword(vm, self.home + offset) and vm.reg(1) == self.stream:
            self.fragments[field] = read_u32(vm, self.stream + 0x14)

    def fragment_end(self, vm, field):
        if self.stream is not None and field in self.fragments:
            start = self.fragments.pop(field)
            self.bindings.append({'offset': start, 'bytes': read_u32(vm, self.stream + 0x14) - start,
                                  'field': field, 'type': 'nativeArenaBoost'})

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

    def observe_profile_id(self, vm):
        if self.profile_id is not None and vm.reg(1) == self.stream and vm.reg(0) == self.profile_id:
            self.bindings.append({'offset': read_u32(vm, self.stream + 0x14), 'bytes': 8, 'field': 'accountId', 'type': 'long'})

    def observe_name(self, vm):
        if vm.reg(0) == self.stream and vm.reg(1) == self.avatar + 0x60:
            self.bindings.append({'offset': read_u32(vm, self.stream + 0x14), 'bytes': 4 + len(self.name.encode()), 'field': 'name', 'type': 'string'})

    def observe_selection(self, vm):
        if vm.reg(0) != self.stream:
            return
        lr = vm.uc.reg_read(UC_ARM64_REG_LR)
        field = {0x34c6c0: 'selectedDeck', 0x71def0: 'nameChangeCount',
                 0x71e204: 'gems', 0x71e218: 'freeGems', 0x34c8ec: 'homeFlags'}.get(lr)
        extra = {}
        if lr == 0x34c67c:
            field = 'deckCard'
            extra = {'deck': vm.reg(22), 'slot': vm.reg(25) // 4}
        if lr == 0x71e1bc and self.gold_pending:
            field = 'gold'
            self.gold_pending = False
        if field:
            from verify_schemas import vint
            value = vm.reg(1) & 0xffffffff
            if value >= 0x80000000:
                value -= 0x100000000
            self.bindings.append({'offset': read_u32(vm, self.stream + 0x14),
                                  'bytes': len(vint(value)), 'field': field, 'type': 'vint', **extra})

    def observe_commodity(self, vm):
        if vm.reg(1) == self.stream:
            self.gold_pending = qword(vm, vm.reg(0)) == self.records[5, 'Gold']

    def observe_card(self, vm):
        if vm.reg(0) == self.stream and vm.uc.reg_read(UC_ARM64_REG_LR) == 0x5c4100:
            from verify_schemas import vint
            table = qword(vm, 0xd5dc68 + 7 * 8)
            ordinal = self.tables[table].index(vm.reg(1)) + 1
            self.bindings.append({'offset': read_u32(vm, self.stream + 0x14),
                                  'bytes': len(vint(ordinal)), 'field': 'activeCard',
                                  'type': 'vint', 'slot': vm.reg(21)})

    def observe_flags(self, vm):
        if vm.reg(0) == self.stream and vm.uc.reg_read(UC_ARM64_REG_LR) == 0x71e268:
            assert read_u32(vm, self.stream + 0x1c) == 0
            self.bindings.append({'offset': read_u32(vm, self.stream + 0x14), 'bytes': 1,
                                  'field': 'nameSet', 'type': 'bit', 'mask': 1})

    def make(self, account_id=(0, 37), name='Player', selected_deck=0, *, name_set=True,
             name_change_count=0, gold=100, gems=100, free_gems=100, decks=None):
        vm = self.vm
        assert selected_deck in range(5)
        word(vm, self.home + 0x2a0, selected_deck)
        word(vm, self.avatar + 0x150, name_change_count)
        vm.uc.mem_write(self.avatar + 0x14d, bytes([name_set]))
        word(vm, self.avatar + 0xe0, gems)
        word(vm, self.avatar + 0xe4, free_gems)
        self.commodities(0, [('Gold', gold)])
        decks = decks or [self.deck_ids[:] for _ in range(5)]
        for n, deck in enumerate(decks):
            pointer = qword(vm, qword(vm, self.home + 0x150) + n * 8)
            vm.uc.mem_write(pointer, struct.pack('<8i', *deck))
        for n, card_id in enumerate(decks[selected_deck]):
            vm.uc.mem_write(self.home + 0x20 + n * 8, struct.pack('<Q', self.cards[card_id]))
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
        assert len(self.bindings) == self.expected_bindings, self.bindings
        # The complete native decoder must resolve all cards/resources/arena and
        # reproduce the full message, not merely accept its length prefix.
        second, buffer, consumed, reads = decode(vm, payload)
        assert self.decoded_message == second
        assert self.decoded_message + 0x10 == vm.input_stream
        assert consumed == len(payload)
        assert encode(vm, second, buffer) == payload
        avatar = qword(vm, second + 0x88)
        assert bytes(vm.uc.mem_read(avatar + 0x10, 24)) == struct.pack('<ii', *account_id) * 3
        assert read_u32(vm, avatar + 0xd8) == 1 and read_u32(vm, avatar + 0xe0) == gems
        assert read_u32(vm, avatar + 0xe4) == free_gems
        assert read_u32(vm, avatar + 0x150) == name_change_count & 0xffffffff
        assert bytes(vm.uc.mem_read(avatar + 0x14d, 1)) == bytes([name_set])
        assert qword(vm, avatar + 0x158) == self.records[54, 'Arena1']
        gold_record = qword(vm, qword(vm, qword(vm, avatar + 0x90)))
        assert qword(vm, gold_record) == self.records[5, 'Gold'] and read_u32(vm, gold_record + 8) == gold
        home = qword(vm, second + 0x80)
        assert read_u32(vm, home + 0x3c8) == read_u32(vm, avatar + 0xd8) == 1
        events = qword(vm, qword(vm, home + 0x4f8) + 0x10)
        assert events and read_u32(vm, events + 0x14) == 0
        assert vm.call(0x551634, home) == 0
        assert vm.call(0x4c29a0, home) == 0
        assert read_u32(vm, home + 0x2a0) == selected_deck
        for n, deck in enumerate(decks):
            pointer = qword(vm, qword(vm, home + 0x150) + n * 8)
            assert bytes(vm.uc.mem_read(pointer, 32)) == struct.pack('<8i', *deck)
        assert read_u32(vm, home + 0x134) == 8
        for n, card_id in enumerate(decks[selected_deck]):
            card = qword(vm, home + 0x20 + n * 8)
            assert qword(vm, card + 8) == self.data[card_id]
        return payload

    def make_profile(self, *args, **kwargs):
        self.make(*args, **kwargs)
        vm = self.vm
        message = vm.alloc(0x1000)
        stream, buffer = vm.stream()
        vm.uc.mem_write(message + 0x10, bytes(vm.uc.mem_read(stream, 0x70)))
        public_home = vm.alloc(0x30)
        vm.call(0x1e0598, public_home)
        vm.uc.mem_write(public_home, struct.pack('<QQ', self.home + 0x20, qword(vm, self.home + 0x18)))
        vm.uc.mem_write(message + 0x88, struct.pack('<QQ', public_home, self.avatar))
        self.profile_id = qword(vm, public_home + 8)
        self.bindings.clear()
        self.stream = message + 0x10
        vm.call(0x37e848, message, count=10000000)
        payload = bytes(vm.uc.mem_read(buffer, read_u32(vm, message + 0x24)))
        self.stream = self.profile_id = None
        assert len(self.bindings) == 18, self.bindings
        decoded = vm.alloc(0x1000)
        inp, buf = vm.stream(payload)
        vm.uc.mem_write(decoded + 0x10, bytes(vm.uc.mem_read(inp, 0x70)))
        vm.call(0x11c3bc, decoded, count=10000000)
        assert read_u32(vm, decoded + 0x24) == len(payload)
        home = qword(vm, decoded + 0x88)
        avatar = qword(vm, decoded + 0x90)
        assert home and avatar and read_u32(vm, qword(vm, home) + 0x114) == 8
        assert bytes(vm.uc.mem_read(qword(vm, home + 8), 8)) == bytes(vm.uc.mem_read(avatar + 0x10, 8))
        word(vm, decoded + 0x24, 0)
        word(vm, decoded + 0x2c, 0)
        vm.call(0x37e848, decoded, count=10000000)
        assert bytes(vm.uc.mem_read(buf, read_u32(vm, decoded + 0x24))) == payload
        return payload


def make_parts(payload, bindings):
    parts = []
    at = 0
    for binding in sorted(bindings, key=lambda binding: binding['offset']):
        offset = binding['offset']
        assert at <= offset
        if offset > at:
            parts.append({'hex': payload[at:offset].hex()})
        part = {name: value for name, value in binding.items() if name not in ('offset', 'bytes')}
        if binding['type'] == 'bit':
            part['base'] = payload[offset]
        if part.get('field') == 'gold':
            # Bind the whole first resource group, including its count. The
            # native free pass reward adds resource 5000005 (FreeGold).
            assert parts[-1]['hex'].endswith('010501')
            parts[-1]['hex'] = parts[-1]['hex'][:-6]
            part = {'field': 'resourceBalances', 'type': 'nativeResources'}
        parts.append(part)
        at = offset + binding['bytes']
    if at < len(payload):
        parts.append({'hex': payload[at:].hex()})
    return parts


def main():
    model = StarterHome()
    payload = model.make()
    parts = make_parts(payload, model.bindings)
    output = {'schema': 1, 'librarySha256': hashlib.sha256((ROOT / 'libg.so').read_bytes()).hexdigest(),
              'messageId': 21217, 'version': 0, 'parts': parts,
              'starter': {'deckIds': model.deck_ids,
                          'cardOrdinals': {str(card_id): model.tables[qword(model.vm, 0xd5dc68 + 7 * 8)].index(model.data[card_id]) + 1 for card_id in model.deck_ids},
                          'gold': 100, 'gems': 100, 'level': 1, 'arena': 'Arena1'},
              'androidLobbyVerified': True,  # User-confirmed network-v6; see docs/device-lobby.json.
              'androidLobbyVerificationScope': 'Previous named starter Home; new-player naming, reordered decks and Profile UI need device verification',
              'scope': 'Native codec round trip with CSV-backed data lookup adapters; not Android gameplay'}
    (ROOT / 'starter-home.json').write_text(json.dumps(output, indent=2) + '\n')
    fixtures = [{'accountId': [0, 37], 'name': 'Player', 'payloadHex': payload.hex()}]
    for account_id, name in [((0, 1), 'Player'), ((0, 8192), 'بازیکن'), ((0, 2147483647), 'Starter player with a longer name')]:
        fixtures.append({'accountId': list(account_id), 'name': name, 'payloadHex': model.make(account_id, name).hex()})
    for selected in (1, 4):
        fixtures.append({'accountId': [0, 1], 'name': 'Player', 'selectedDeck': selected,
                         'payloadHex': model.make((0, 1), 'Player', selected).hex()})
    for state in [
        {'nameSet': False, 'nameChangeCount': -1},
        {'nameSet': True, 'nameChangeCount': 0, 'gold': 8192, 'gems': 37, 'freeGems': 21,
         'selectedDeck': 3, 'decks': [model.deck_ids[n:] + model.deck_ids[:n] for n in range(5)]},
    ]:
        kwargs = {'name_set': state.get('nameSet', True), 'name_change_count': state.get('nameChangeCount', 0),
                  'gold': state.get('gold', 100), 'gems': state.get('gems', 100),
                  'free_gems': state.get('freeGems', 100), 'decks': state.get('decks')}
        fixtures.append({'accountId': [0, 1], 'name': 'Player', 'starter': state,
                         'payloadHex': model.make((0, 1), 'Player', state.get('selectedDeck', 0), **kwargs).hex()})
    (ROOT / 'starter-home-fixture.json').write_text(json.dumps(fixtures, indent=2) + '\n')
    profile = model.make_profile(gold=0, gems=0, free_gems=0)
    profile_parts = make_parts(profile, model.bindings)
    del output['androidLobbyVerified']
    del output['androidLobbyVerificationScope']
    output.update(messageId=22757, parts=profile_parts, androidProfileVerified=False,
                  scope='Native profile codec round trip; decoded profile Home/card collection and Avatar present. Android profile UI unverified.')
    (ROOT / 'starter-profile.json').write_text(json.dumps(output, indent=2) + '\n')
    profile_fixtures = []
    for account_id, name, selected in [((0, 37), 'Player', 0), ((0, 8192), 'بازیکن', 3)]:
        state = {'selectedDeck': selected, 'decks': [model.deck_ids[n:] + model.deck_ids[:n] for n in range(5)],
                 'gold': 0, 'gems': 0, 'freeGems': 0}
        wire = model.make_profile(account_id, name, selected, decks=state['decks'], gold=0, gems=0, free_gems=0)
        profile_fixtures.append({'accountId': list(account_id), 'name': name, 'starter': state, 'payloadHex': wire.hex()})
    (ROOT / 'starter-profile-fixture.json').write_text(json.dumps(profile_fixtures, indent=2) + '\n')
    print(f'Starter Home: {len(payload)} bytes, 8 resolved cards, 5 decks, native decode/reencode PASS')
    print(f'Player Profile: {len(profile)} bytes, native card collection and Avatar decode/reencode PASS')


if __name__ == '__main__':
    main()

"""Native Home with every non-NotInUse collectible spell in this APK.

The active eight cards and the remaining inventory are disjoint. The runtime
rebuilds that inventory from native per-card encodings when a deck changes.
Table lookups are CSV adapters; the complete Home and card codecs execute.
"""
import hashlib
import json
import struct

from native_vm import ROOT
from starter_home import StarterHome, qword, make_parts
from verify_home import read_u32


class UnlockedHome(StarterHome):
    def __init__(self):
        super().__init__()
        vm = self.vm
        self.expected_bindings = 60
        self.owned_ids = []
        self.card_metadata = {}
        table = qword(vm, 0xd5dc68 + 7 * 8)
        for kind in (26, 27, 28):
            for index, row in enumerate(self.rows[kind]):
                if row['NotInUse'].upper() == 'TRUE':
                    continue
                identity = kind * 1000000 + index
                self.owned_ids.append(identity)
                self.card_metadata[identity] = {
                    'name': row['Name'], 'rarity': row['Rarity'],
                    'ordinal': self.tables[table].index(self.data[identity]) + 1,
                }
                if identity not in self.cards:
                    card = vm.alloc(0x40)
                    vm.call(0x3fe540, card)
                    vm.uc.mem_write(card + 8, struct.pack('<Q', self.data[identity]))
                    self.cards[identity] = card
        self.inventory = vm.alloc(8 * len(self.owned_ids))
        self.commodities(4, [('MaxScore', 0), ('MaxArena', 1), ('CardCount', len(self.owned_ids))])
        vm.register_hook(0x23c1e0, self.inventory_start)
        vm.register_hook(0x34c6ac, self.inventory_end)
        self.inventory_offset = None
        self.active = set(self.deck_ids)

    def inventory_start(self, vm):
        if vm.reg(0) == self.home + 0x138 and vm.reg(1) == self.stream:
            self.inventory_offset = read_u32(vm, self.stream + 0x14)

    def inventory_end(self, vm):
        if self.stream is not None and self.inventory_offset is not None:
            end = read_u32(vm, self.stream + 0x14)
            self.bindings.append({'offset': self.inventory_offset, 'bytes': end - self.inventory_offset,
                                  'field': 'inventory', 'type': 'nativeCards'})
            self.inventory_offset = None

    def observe_card(self, vm):
        # The same native serializer also encodes inventory cards. Only active
        # cards carry a slot binding; inventory is bound as a complete vector.
        if vm.reg(19) in {self.cards[identity] for identity in self.active}:
            super().observe_card(vm)

    def make(self, account_id=(0, 37), name='Player', selected_deck=0, **kwargs):
        decks = kwargs.get('decks') or [self.deck_ids[:] for _ in range(5)]
        self.active = set(decks[selected_deck])
        assert len(self.active) == 8 and self.active <= set(self.owned_ids)
        remaining = [identity for identity in self.owned_ids if identity not in self.active]
        vm = self.vm
        vm.uc.mem_write(self.inventory, struct.pack('<' + 'Q' * len(remaining), *(self.cards[i] for i in remaining)))
        vm.uc.mem_write(self.home + 0x138, struct.pack('<Qii', self.inventory, len(remaining), len(remaining)))
        payload = super().make(account_id, name, selected_deck, **kwargs)
        decoded_home = qword(vm, self.decoded_message + 0x80)
        count = read_u32(vm, decoded_home + 0x144)
        array = qword(vm, decoded_home + 0x138)
        assert count == len(remaining)
        ids = [read_u32(vm, qword(vm, qword(vm, array + n * 8) + 8) + 0x20) for n in range(count)]
        assert ids == remaining and len(set(ids) | self.active) == len(self.owned_ids)
        return payload


def main():
    model = UnlockedHome()
    wire = model.make()
    parts = make_parts(wire, model.bindings)
    vm = model.vm
    cards = []
    for identity in model.owned_ids:
        stream, buffer = vm.stream()
        vm.call(0x5c40d8, model.cards[identity], stream)
        size = read_u32(vm, stream + 0x14)
        cards.append({'id': identity, **model.card_metadata[identity],
                      'payloadHex': bytes(vm.uc.mem_read(buffer, size)).hex()})
    output = {'schema': 1, 'librarySha256': hashlib.sha256((ROOT / 'libg.so').read_bytes()).hexdigest(),
              'messageId': 21217, 'version': 0, 'parts': parts, 'cards': cards,
              'scope': 'Native full Home round trips with CSV lookup adapters; unlocked inventory Android UI unverified.'}
    (ROOT / 'unlocked-home.json').write_text(json.dumps(output, indent=2) + '\n')
    fixtures = []
    for identity, name, state in [
        ([0, 1], 'Player', {'nameSet': False, 'nameChangeCount': -1}),
        ([0, 8192], 'بازیکن', {'selectedDeck': 3, 'gold': 1100, 'gems': 40, 'freeGems': 21,
                               'decks': [model.owned_ids[n:n + 8] for n in range(5)]}),
    ]:
        wire = model.make(identity, name, state.get('selectedDeck', 0),
                          name_set=state.get('nameSet', True), name_change_count=state.get('nameChangeCount', 0),
                          gold=state.get('gold', 100), gems=state.get('gems', 100), free_gems=state.get('freeGems', 100),
                          decks=state.get('decks'))
        fixtures.append({'accountId': identity, 'name': name, 'starter': state, 'payloadHex': wire.hex()})
    (ROOT / 'unlocked-home-fixtures.json').write_text(json.dumps(fixtures, indent=2) + '\n')
    profile_state = {'selectedDeck': 3, 'decks': [model.owned_ids[n:n + 8] for n in range(5)],
                     'gold': 0, 'gems': 0, 'freeGems': 0}
    profile = model.make_profile((0, 8192), 'بازیکن', 3, decks=profile_state['decks'], gold=0, gems=0, free_gems=0)
    (ROOT / 'unlocked-profile.json').write_text(json.dumps({
        'schema': 1, 'librarySha256': output['librarySha256'], 'messageId': 22757, 'version': 0,
        'parts': make_parts(profile, model.bindings),
        'scope': 'Native profile codec with 95 owned-card statistic and eight active cards; changed inventory/profile Android UI unverified.',
    }, indent=2) + '\n')
    (ROOT / 'unlocked-profile-fixture.json').write_text(json.dumps({
        'accountId': [0, 8192], 'name': 'بازیکن', 'starter': profile_state, 'payloadHex': profile.hex(),
    }, indent=2) + '\n')
    print(f'Native unlocked Home PASS: {len(cards)} cards, 8 active + {len(cards) - 8} inventory; UTF-8 and changed decks round-trip')


if __name__ == '__main__':
    main()

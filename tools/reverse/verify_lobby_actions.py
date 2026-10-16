"""Verify native deck swaps and the zero-crown free season-pass reward.

Uses the original linked CSV tables and command executors. Only context time,
UI/analytics observers and libc/POSIX boundaries are adapted.
"""
import hashlib
import json
import struct
from pathlib import Path

from native_csv import NativeCsv
from native_vm import ROOT
from verify_home import decode, encode, read_u32
from verify_arena_boost import context, hook, capture, CLAIMED_AT
from verify_player_commands import fixture
from verify_schemas import vint


def main():
    model = NativeCsv()
    model.restore(ROOT / 'native-csv-linked-state')
    vm = model.vm
    sources = json.loads(Path('test/fixtures/native-unlocked-home.json').read_text())
    swaps, rewards, reward_fixtures, manager_fragments = [], [], [], {}

    def setup(source):
        message, buffer, used, _ = decode(vm, bytes.fromhex(source['payloadHex']))
        assert used == len(bytes.fromhex(source['payloadHex']))
        home, avatar = model.qword(message + 0x80), model.qword(message + 0x88)
        ctx = context(model, home, avatar)
        observer = vm.call(0x5f9674, ctx)
        table = model.qword(observer)
        for offset in range(0, 0x650, 8):
            if offset != 0xf0:
                vm.uc.mem_write(table + offset, struct.pack('<Q', 0x20004500))
        return message, buffer, home, avatar, ctx

    def deck(home):
        return [model.integer(model.qword(model.qword(home + 0x20 + n * 8) + 8) + 0x20) for n in range(8)]

    def inventory(home):
        array = model.qword(home + 0x138)
        return [model.integer(model.qword(model.qword(array + n * 8) + 8) + 0x20)
                for n in range(model.integer(home + 0x144))]

    for source in sources:
        message, buffer, home, avatar, ctx = setup(source)
        initial = {'selectedDeck': source.get('starter', {}).get('selectedDeck', 0),
                   'decks': [[model.integer(model.qword(model.qword(home + 0x150) + d * 8) + n * 4)
                              for n in range(8)] for d in range(5)], 'inventory': inventory(home)}
        observations = []
        for selectors in [(-1, 0, 7), (0, 2, -1), (1, 3, -1), (-1, 1, 6)]:
            fields = dict(zip(('field_0x1c', 'field_0x20', 'field_0x24'), selectors))
            wire = vint(693) + bytes(4) + b''.join(vint(n) for n in selectors)
            row, command = fixture(model, 693, fields, wire, list(selectors))
            before = deck(home), inventory(home)
            assert vm.call(0x49a670, command, ctx, 0, count=10000000) == 0
            assert before == (deck(home), inventory(home))
            assert vm.call(0x49a670, command, ctx, 2, count=10000000) == 0
            # Native selected-deck cache flush, also used by deck switching.
            vm.call(0x48852c, home, model.integer(home + 0x2a0))
            observations.append({'command': row, 'selectedDeck': model.integer(home + 0x2a0),
                                 'active': deck(home), 'inventory': inventory(home)})
        invalid = []
        for selectors in [(-1, 0, 0), (-1, -1, 1), (-1, 0, 8), (-2, 0, -1),
                          (87, 0, -1), (0, 8, -1), (0, 0, 1)]:
            wire = vint(693) + bytes(4) + b''.join(vint(n) for n in selectors)
            _, command = fixture(model, 693, {}, wire, 'invalid')
            before = deck(home), inventory(home)
            result = vm.call(0x49a670, command, ctx, 2, count=10000000)
            assert result != 0 and before == (deck(home), inventory(home))
            invalid.append({'selectors': list(selectors), 'result': result})
        fields = {'field_0x1c': 4}
        row, command = fixture(model, 703, fields, vint(703) + bytes(4) + vint(4), 'select-after-swaps')
        assert vm.call(0x32f870, command, ctx, 2, count=10000000) == 0
        observations.append({'command': row, 'selectedDeck': model.integer(home + 0x2a0),
                             'active': deck(home), 'inventory': inventory(home)})
        for selector in (1, 4):
            row, command = fixture(model, 869, {'field_0x1c': selector}, vint(869) + bytes(4) + vint(selector), 'home-bit')
            previous = model.integer(home + 0x2c4)
            assert vm.call(0x59ed34, command, ctx, 0) == 0 and model.integer(home + 0x2c4) == previous
            assert vm.call(0x59ed34, command, ctx, 2) == 0
            assert model.integer(home + 0x2c4) == previous | (1 << selector)
            observations.append({'command': row, 'selectedDeck': model.integer(home + 0x2a0),
                                 'active': deck(home), 'inventory': inventory(home), 'homeFlags': model.integer(home + 0x2c4)})
        target = inventory(home)[:8]
        fields = {'field_0x1c': 2, 'field_0x20': target, 'field_0x28': [0, 0],
                  'field_0x30': False, 'field_0x38': None}
        wire = vint(563) + bytes(4) + vint(2) + vint(8) + b''.join(vint(n) for n in target) + bytes(9)
        row, command = fixture(model, 563, fields, wire, 'replace-after-swaps')
        assert vm.call(0x6750b0, command, ctx, 2, count=10000000) == 0
        observations.append({'command': row, 'selectedDeck': model.integer(home + 0x2a0),
                             'active': deck(home), 'inventory': inventory(home)})
        swaps.append({'accountId': source['accountId'], 'initial': initial,
                      'observations': observations, 'invalid': invalid})

    for source in sources:
        for with_boost in (False, True):
            for initial_gold in (100, 4999900, 5000000):
                message, buffer, home, avatar, ctx = setup(source)
                manager = model.qword(home + 0x650)
                vm.call(0x621370, manager, count=10000000)
                if with_boost:
                    wire = vint(595) + bytes(4) + vint(-1) * 2 + vint(54) + vint(1) + b'\0'
                    _, command = fixture(model, 595, {}, wire, 'boost')
                    assert vm.call(0x59b664, command, ctx, 2, count=10000000) == 0
                commodity = model.qword(model.qword(model.qword(avatar + 0x90)))
                vm.uc.mem_write(commodity + 8, struct.pack('<i', initial_gold))
                fields = {'field_0x10': 0, 'field_0xc': 0, 'field_0x14': [0, 0],
                          'field_0x1c': 0, 'field_0x20': False, 'field_0x21': False}
                row, command = fixture(model, 836, fields, vint(836) + bytes(6), 'free-zero-crown-gold')
                assert vm.call(0x1d14cc, command, ctx, 0, count=10000000) == 0
                assert model.integer(commodity + 8) == initial_gold
                assert vm.call(0x1d14cc, command, ctx, 2, count=10000000) == 0
                final_gold = min(5000000, initial_gold + 500)
                assert model.integer(commodity + 8) == final_gold
                resources = model.qword(avatar + 0x90)
                free_gold = [model.qword(model.qword(resources) + i * 8)
                             for i in range(model.integer(resources + 0xc))
                             if model.integer(model.qword(model.qword(model.qword(resources) + i * 8)) + 0x20) == 5000005]
                credited = final_gold - initial_gold
                assert len(free_gold) == int(credited > 0)
                if credited:
                    assert model.integer(free_gold[0] + 8) == credited
                assert vm.call(0x1d14cc, command, ctx, 2, count=10000000) == 44
                assert model.integer(commodity + 8) == final_gold
                payload, fragments, _ = capture(model, message, buffer)
                key = 'withArenaBoost' if with_boost else 'withoutArenaBoost'
                fragment = fragments['arenaBoostClaim'].hex()
                if key in manager_fragments:
                    assert manager_fragments[key] == fragment
                manager_fragments[key] = fragment
                restored, restored_buffer, used, _ = decode(vm, payload)
                assert used == len(payload) and encode(vm, restored, restored_buffer) == payload
                restored_home = model.qword(restored + 0x80)
                restored_avatar = model.qword(restored + 0x88)
                restored_ctx = context(model, restored_home, restored_avatar)
                assert vm.call(0x1d14cc, command, restored_ctx, 2, count=10000000) == 44
                state = {**source.get('starter', {}), 'freePassGoldClaimed': True, 'gold': final_gold, 'freeGold': credited}
                selector = 4 if with_boost else 1
                _, mark = fixture(model, 869, {}, vint(869) + bytes(4) + vint(selector), 'home-bit')
                assert vm.call(0x59ed34, mark, ctx, 2) == 0
                state['homeFlags'] = 1 << selector
                payload, _, _ = capture(model, message, buffer)
                restored, restored_buffer, used, _ = decode(vm, payload)
                assert used == len(payload) and encode(vm, restored, restored_buffer) == payload
                assert model.integer(model.qword(restored + 0x80) + 0x2c4) == state['homeFlags']
                if with_boost:
                    state['arena1Boost'] = {'claimedAtMs': CLAIMED_AT, 'expiresAtMs': CLAIMED_AT + 86400000}
                reward_fixtures.append({'accountId': source['accountId'], 'name': source['name'],
                                        'starter': state, 'nowMs': CLAIMED_AT, 'payloadHex': payload.hex(),
                                        'nativeDecodeConsumed': used, 'nativeReencodeEqual': True})
                rewards.append({'initialGold': initial_gold, 'gold': final_gold, 'arenaBoost': with_boost,
                                'validation': 0, 'execution': 0, 'duplicate': 44, 'duplicateAfterDecode': 44})
    digest = hashlib.sha256((ROOT / 'libg.so').read_bytes()).hexdigest()
    report = {'librarySha256': digest, 'deckCommand': 693, 'deckExecutor': '0x49a670', 'swaps': swaps,
              'homeFlagsCommand': 869, 'homeFlagsExecutor': '0x59ed34', 'homeFlagsOffset': '0x2c4',
              'rewardCommand': 836, 'rewardExecutor': '0x1d14cc', 'reward': row,
              'rewards': rewards, 'homeFixtures': len(reward_fixtures),
              'gameCodeAdapters': ['context Home/Avatar/time', 'UI and analytics observers'],
              'scope': 'Original linked data, card swaps, free tier-zero 500 gold/cap/claim state and full Home roundtrips. No later crown tiers, premium rewards, live battle or Android UI verified.'}
    runtime = {'schema': 1, 'librarySha256': digest, 'tier': 0, 'gold': 500, 'goldLimit': 5000000,
               'claimedManagerHex': manager_fragments}
    for filename, value in [('native-lobby-actions.json', report), ('season-pass.json', runtime),
                            ('native-season-pass-home.json', reward_fixtures)]:
        (ROOT / filename).write_text(json.dumps(value, indent=2) + '\n')
    print('Native 693 swaps/inventory and 836 free tier-zero reward/cap/duplicate/reconnect: PASS')


if __name__ == '__main__':
    main()

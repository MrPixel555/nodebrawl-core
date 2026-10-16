"""Recover every original pass row and verify progress/seen persistence.

Python/Unicorn are analysis dependencies only. The production server is Node.js.
Positive crown totals are explicit test inputs, not evidence of battle rewards.
"""
import csv
import hashlib
import json
import struct
from pathlib import Path

from native_csv import NativeCsv
from native_vm import ROOT
from verify_home import decode, encode
from verify_arena_boost import context, hook, capture, CLAIMED_AT
from verify_player_commands import fixture
from verify_schemas import vint


def main():
    model = NativeCsv()
    model.restore(ROOT / 'native-csv-linked-state')
    vm = model.vm
    digest = hashlib.sha256((ROOT / 'libg.so').read_bytes()).hexdigest()
    passes, sources, selections = [], [], []
    for kind, filename in [(106, 'season_pass_rookie.csv'), (103, 'season_pass_pro.csv')]:
        path = ROOT / 'game-data-verified/csv_logic' / filename
        sources.append({'path': 'csv_logic/' + filename, 'decodedSha256': hashlib.sha256(path.read_bytes()).hexdigest()})
        grouped, name, threshold = {}, None, None
        for row in list(csv.DictReader(path.open(newline='')))[1:]:
            if row['Name']:
                name = row['Name']
                grouped[name] = {}
            if row['Crowns']:
                threshold = int(row['Crowns'])
            premium = row['Premium'].lower() == 'true'
            data = {key: value for key, value in row.items() if value and key not in ('Name', 'Crowns', 'Premium')}
            grouped[name].setdefault(threshold, {})['premium' if premium else 'free'] = data
        table = model.qword(0xd5dc68 + kind * 8)
        for index in range(model.integer(table + 0x14)):
            data = model.qword(model.qword(table + 8) + index * 8)
            name = model.read_string(model.qword(data + 8))
            vec = vm.alloc(16)
            interface = data + 0x30
            vm.call(model.qword(model.qword(interface) + 0x18), interface, vec)
            rewards = []
            for n in range(model.integer(vec + 12)):
                reward = model.qword(model.qword(vec) + n * 8)
                threshold = model.integer(reward + 8)
                tracks = {}
                for track, offset in [('free', 0x18), ('premium', 0x10)]:
                    descriptor = model.qword(reward + offset)
                    vt = model.qword(descriptor)
                    reward_kind = vm.call(model.qword(vt + 0x10), descriptor)
                    amount = vm.call(model.qword(vt + 0x28), descriptor)
                    cells = grouped[name][threshold][track]
                    # Do not infer enum values from column names alone.
                    expected = 3 if cells.get('Resource') else 4 if cells.get('Chest') else 5 if cells.get('Token') else 6 if cells.get('EmoteIDHigh') else 7 if cells.get('SkinSet') else 9 if cells.get('Strike') else 0
                    assert reward_kind == expected, (name, threshold, track, reward_kind, cells)
                    assert amount == int(cells.get('Amount', 0))
                    tracks[track] = {'kind': reward_kind, 'amount': amount, 'data': cells}
                rewards.append({'crowns': threshold, **tracks})
            assert len(rewards) == 36 and [r['crowns'] for r in rewards] == list(range(0, 351, 10))
            for selector in [-1, 0, 1, 9, 10, 19, 349, 350, 351, 2147483647]:
                selected = vm.call(0x2b29c8, interface, selector)
                threshold = model.integer(selected + 8) if selected else None
                assert threshold == (None if selector < 0 else min(350, selector // 10 * 10))
                selections.append({'passId': model.integer(data + 0x20), 'selector': selector, 'crowns': threshold})
            passes.append({'id': model.integer(data + 0x20), 'name': name, 'rewards': rewards})
    catalogue = {'schema': 1, 'librarySha256': digest, 'sources': sources,
                 'kinds': {'0': 'empty', '3': 'resource', '4': 'chest', '5': 'token', '6': 'emote', '7': 'skin', '9': 'strike'},
                 'passes': passes}
    (ROOT / 'season-rewards.json').write_text(json.dumps(catalogue, indent=2) + '\n')
    source = json.loads(Path('test/fixtures/native-unlocked-home.json').read_text())[0]
    observations, homes = [], []
    for crowns, initial_seen, selector, expected in [(0, -1, 0, 0), (0, -1, 1, 7), (10, -1, 9, 0),
            (10, 9, 8, 8), (10, 9, 9, 0), (10, 9, 10, 0), (350, -1, 350, 0),
            (511, -1, 510, 0), (2147483647, -1, 2147483647, 0), (10, -1, -1, 1)]:
        for claimed, boosted in [(False, False), (True, False), (True, True)]:
            message, buffer, _, _ = decode(vm, bytes.fromhex(source['payloadHex']))
            home, avatar = model.qword(message + 0x80), model.qword(message + 0x88)
            ctx = context(model, home, avatar)
            vt = model.qword(vm.call(0x5f9674, ctx))
            for off in range(0, 0x650, 8):
                if off != 0xf0:
                    vm.uc.mem_write(vt + off, struct.pack('<Q', 0x20004500))
            manager = model.qword(home + 0x650)
            vm.call(0x621370, manager, count=10000000)
            slot = vm.call(0x5d624c, manager)
            progress = model.qword(slot + 0x20)
            vm.uc.mem_write(progress + 8, struct.pack('<i', crowns))
            vm.uc.mem_write(progress + 0x24, struct.pack('<i', initial_seen))
            if claimed:
                vm.uc.mem_write(progress + 0xc, struct.pack('<i', 0))
            if boosted:
                _, boost = fixture(model, 595, {}, vint(595) + bytes(4) + vint(-1) * 2 + vint(54) + vint(1) + b'\0', 'boost')
                assert vm.call(0x59b664, boost, ctx, 2, count=10000000) == 0
            fields = {'field_0x10': 0, 'field_0xc': 0, 'field_0x14': [0, 0], 'field_0x1c': selector}
            row, command = fixture(model, 762, fields, vint(762) + bytes(4) + vint(selector), 'pass-seen')
            assert vm.call(0x460fac, command, ctx, 0) == expected
            assert model.integer(progress + 0x24) == initial_seen
            assert vm.call(0x460fac, command, ctx, 2) == expected
            seen = selector if expected == 0 else initial_seen
            assert model.integer(progress + 0x24) == seen
            payload, fragments, _ = capture(model, message, buffer)
            restored, restored_buffer, used, _ = decode(vm, payload)
            assert used == len(payload) and encode(vm, restored, restored_buffer) == payload
            restored_home = model.qword(restored + 0x80)
            restored_slot = vm.call(0x5d624c, model.qword(restored_home + 0x650))
            assert model.integer(model.qword(restored_slot + 0x20) + 0x24) == seen
            state = {**source['starter'], 'selectedDeck': 0, 'passCrowns': crowns, 'passSeenCrowns': seen,
                     'passInitialized': True, 'freePassGoldClaimed': claimed}
            # Claim marker is seeded here independently of balances: this fixture
            # verifies the manager serializer, not another gold credit.
            if boosted:
                state['arena1Boost'] = {'claimedAtMs': CLAIMED_AT, 'expiresAtMs': CLAIMED_AT + 86400000}
            homes.append({'accountId': source['accountId'], 'name': source['name'], 'starter': state,
                          'nowMs': CLAIMED_AT, 'managerHex': fragments['arenaBoostClaim'].hex(),
                          'payloadHex': payload.hex(), 'nativeDecodeConsumed': used, 'nativeReencodeEqual': True})
            observations.append({'command': row, 'crowns': crowns, 'initialSeen': initial_seen,
                                 'seen': seen, 'result': expected, 'claimed': claimed, 'boosted': boosted})
    claim_selectors = []
    for selector, expected in [(-1, 101), (0, 0), (1, 0), (9, 0), (10, 4), (19, 4), (350, 4)]:
        message, buffer, _, _ = decode(vm, bytes.fromhex(source['payloadHex']))
        home, avatar = model.qword(message + 0x80), model.qword(message + 0x88)
        ctx = context(model, home, avatar)
        vt = model.qword(vm.call(0x5f9674, ctx))
        for off in range(0, 0x650, 8):
            if off != 0xf0:
                vm.uc.mem_write(vt + off, struct.pack('<Q', 0x20004500))
        manager = model.qword(home + 0x650)
        vm.call(0x621370, manager, count=10000000)
        fields = {'field_0x10': 0, 'field_0xc': 0, 'field_0x14': [0, 0],
                  'field_0x1c': selector, 'field_0x20': False, 'field_0x21': False}
        row, command = fixture(model, 836, fields, vint(836) + bytes(4) + vint(selector) + b'\0', 'crown-selector')
        assert vm.call(0x1d14cc, command, ctx, 0, count=10000000) == expected
        assert vm.call(0x1d14cc, command, ctx, 2, count=10000000) == expected
        duplicate = None
        if expected == 0:
            duplicate = vm.call(0x1d14cc, command, ctx, 2, count=10000000)
            assert duplicate == 44
        claim_selectors.append({'command': row, 'result': expected, 'duplicate': duplicate})
    manager_shapes = []
    for arena_present, pass_present in [(False, False), (True, False), (False, True), (True, True)]:
        message, buffer, _, _ = decode(vm, bytes.fromhex(source['payloadHex']))
        home, avatar = model.qword(message + 0x80), model.qword(message + 0x88)
        context(model, home, avatar)
        manager = model.qword(home + 0x650)
        vm.call(0x621370, manager, count=10000000)
        slot = vm.call(0x5d624c, manager)
        for offset, value in [(0x20, 7), (0x28, -5), (0x24, 8192), (0x2c, -8192)]:
            vm.uc.mem_write(manager + offset, struct.pack('<i', value))
        arena, progress = model.qword(slot + 0x18), model.qword(slot + 0x20)
        for off, value in [(0x10, 128), (0xc, 37), (8, -7), (0x14, -8192)]:
            vm.uc.mem_write(arena + off, struct.pack('<i', value))
        for off, value in [(8, 350), (0xc, 340), (0x10, 330), (0x24, 349)]:
            vm.uc.mem_write(progress + off, struct.pack('<i', value))
        vm.uc.mem_write(progress + 0x20, b'\1')
        identities = []
        pointers = vm.alloc(16)
        for n, identity in enumerate([(7, 2147483647), (-1, 37)]):
            pointer = vm.alloc(8)
            vm.uc.mem_write(pointer, struct.pack('<ii', *identity))
            vm.uc.mem_write(pointers + n * 8, struct.pack('<Q', pointer))
            identities.append(list(identity))
        vm.uc.mem_write(progress + 0x28, struct.pack('<Qii', pointers, 2, 2))
        if not arena_present:
            vm.uc.mem_write(slot + 0x18, bytes(8))
        if not pass_present:
            vm.uc.mem_write(slot + 0x20, bytes(8))
        payload, fragments, _ = capture(model, message, buffer)
        # Distinct synthetic auxiliary values test serializer field order and
        # packed null flags only. Their wider game semantics are not claimed.
        manager_shapes.append({'hex': fragments['arenaBoostClaim'].hex(), 'fields': {
            'field_0x20': 7, 'field_0x28': -5, 'field_0x24': 8192, 'field_0x2c': -8192,
            'slots': [{'seasonId': 102000000, 'index': 0,
                       'arena': {'threshold': 128, 'field_0xc': 37, 'field_0x8': -7, 'field_0x14': -8192} if arena_present else None,
                       'pass': {'crowns': 350, 'freeClaimedCrowns': 340, 'premiumClaimedCrowns': 330,
                                'flag': True, 'arenaIndex': 2, 'seenCrowns': 349, 'identities': identities} if pass_present else None}]}})
    report = {'librarySha256': digest, 'command': 762, 'executor': '0x460fac',
              'managerEncoder': '0x543f70', 'slotEncoder': '0x181040', 'progressEncoder': '0x19a968',
              'passRows': len(passes), 'rewardRows': sum(len(p['rewards']) for p in passes),
              'tracks': 360, 'observations': observations, 'selections': selections, 'managerShapes': manager_shapes,
              'claimSelectors': claim_selectors,
              'catalogueSha256': hashlib.sha256((ROOT / 'season-rewards.json').read_bytes()).hexdigest(),
              'scope': 'Original CSV values and descriptor enum/amount checks for every pass track. Native 762 execution and 30 full Home roundtrips. ManagerShapes use synthetic distinct auxiliary values for native encoder order/null-flag verification only. Positive crowns are test inputs; earning crowns, later chest redemption, premium entitlement and season rollover are not implemented.'}
    (ROOT / 'native-pass-state.json').write_text(json.dumps(report, indent=2) + '\n')
    (ROOT / 'native-pass-state-home.json').write_text(json.dumps(homes, indent=2) + '\n')
    print(f'Native 5 passes / 180 tiers / 360 reward tracks; 762 and {len(homes)} full Home roundtrips: PASS')


if __name__ == '__main__':
    main()

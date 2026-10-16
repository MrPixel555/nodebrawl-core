"""Execute the observed 595 Arena1 boost using fully linked original CSV data.

Context clock and UI/analytics listeners are explicit adapters. The original
reward manager, eligibility, boost creation and serializers execute unchanged.
"""
import hashlib
import json
import struct
from pathlib import Path

from native_csv import NativeCsv
from native_vm import ROOT
from starter_home import make_parts
from verify_home import decode, encode, read_u32
from verify_player_commands import fixture
from verify_schemas import vint


CLAIMED_AT = 1700000000000


def hook(vm, address, callback):
    if address in vm.hooks:
        vm.hooks[address] = callback
    else:
        vm.register_hook(address, callback)


def context(model, home, avatar):
    vm = model.vm
    obj = vm.alloc(0x300)
    vm.uc.mem_write(obj + 0x48, struct.pack('<QQ', home, avatar))
    vm.uc.mem_write(obj + 0x1bc, struct.pack('<i', CLAIMED_AT // 1000))
    vm.uc.mem_write(home + 0x10, struct.pack('<Q', obj))
    observer, vtable = vm.alloc(8), vm.alloc(0x650)
    vm.uc.mem_write(observer, struct.pack('<Q', vtable))
    callback = 0x20004500
    hook(vm, callback, lambda machine: machine.ret(0))
    # UI refresh and analytics do not supply rewards or replace eligibility.
    for offset in (0x398, 0x5c0):
        vm.uc.mem_write(vtable + offset, struct.pack('<Q', callback))
    clock_callback = 0x20004504
    hook(vm, clock_callback, lambda machine: machine.ret(CLAIMED_AT // 1000))
    vm.uc.mem_write(vtable + 0xf0, struct.pack('<Q', clock_callback))
    for address in (0x12adb0, 0x5f9674):
        hook(vm, address, lambda machine: machine.ret(observer))
    return obj


def capture(model, message, buffer):
    vm = model.vm
    stream = message + 0x10
    home = model.qword(message + 0x80)
    bounds, opened, timer_bindings = {}, {}, []
    def start(machine, field, offset):
        if machine.reg(0) == model.qword(home + offset) and machine.reg(1) == stream:
            opened[field] = read_u32(vm, stream + 0x14)
    def end(machine, field):
        if field in opened:
            bounds[field] = (opened.pop(field), read_u32(vm, stream + 0x14))
    for entry, exit_, field, offset in [(0x29e1d4, 0x34cfa8, 'arenaBoostTimers', 0x5d0),
                                        (0x543f70, 0x34d26c, 'arenaBoostClaim', 0x650)]:
        hook(vm, entry, lambda machine, field=field, offset=offset: start(machine, field, offset))
        hook(vm, exit_, lambda machine, field=field: end(machine, field))
    from unicorn.arm64_const import UC_ARM64_REG_LR
    def integer(machine):
        # Remaining ticks uses a tail branch, preserving the caller's LR.
        field = {0x21db48: 'claimedAtSeconds', 0x29e220: 'remainingTicks'}.get(machine.uc.reg_read(UC_ARM64_REG_LR))
        if field and machine.reg(0) == stream:
            timer_bindings.append({'field': field, 'type': 'int', 'offset': read_u32(vm, stream + 0x14), 'bytes': 4})
    hook(vm, model.qword(model.qword(stream) + 0x48), integer)
    payload = encode(vm, message, buffer)
    fragments = {name: payload[start:end] for name, (start, end) in bounds.items()}
    if timer_bindings:
        begin, _ = bounds['arenaBoostTimers']
        timer_bindings = [{**binding, 'offset': binding['offset'] - begin} for binding in timer_bindings]
    return payload, fragments, timer_bindings


def main():
    model = NativeCsv()
    model.restore(ROOT / 'native-csv-linked-state')
    vm = model.vm
    arena_table = model.qword(0xd5dc68 + 54 * 8)
    arena = model.qword(model.qword(arena_table + 8) + 8)
    assert model.read_string(model.qword(arena + 8)) == 'Arena1'
    assert model.read_string(arena + 0x1c0) == 'ChestSpeedUp'
    assert model.integer(arena + 0x1d8) == 24
    fixtures, results = [], []
    runtime = None
    sources = json.loads(Path('test/fixtures/native-unlocked-home.json').read_text())
    for source in sources:
        message, buffer, consumed, _ = decode(vm, bytes.fromhex(source['payloadHex']))
        before, empty, _ = capture(model, message, buffer)
        assert consumed == len(before) and before.hex() == source['payloadHex']
        home, avatar = model.qword(message + 0x80), model.qword(message + 0x88)
        ctx = context(model, home, avatar)
        manager = model.qword(home + 0x650)
        # The original lobby initializes the empty manager. Do not manufacture
        # a fake slot or replace native reward lookup with a success adapter.
        slot = vm.call(0x621370, manager, count=10000000)
        assert slot == vm.call(0x5d624c, manager) and slot
        assert model.integer(model.qword(slot + 0x18) + 0x10) == -1
        fields = {'field_0x10': 0, 'field_0xc': 0, 'field_0x14': [0, 0],
                  'field_0x1c': -1, 'field_0x20': -1, 'field_0x28': [54, 1], 'field_0x30': False}
        wire = vint(595) + bytes(4) + vint(-1) * 2 + vint(54) + vint(1) + b'\0'
        row, command = fixture(model, 595, fields, wire, 'observed-arena1-boost')
        avatar_before = bytes(vm.uc.mem_read(avatar, 0x200))
        assert vm.call(0x59b664, command, ctx, 0, count=10000000) == 0
        assert model.integer(model.qword(home + 0x5d0) + 0xc) == 0
        assert vm.call(0x59b664, command, ctx, 2, count=10000000) == 0
        assert bytes(vm.uc.mem_read(avatar, 0x200)) == avatar_before
        assert model.integer(model.qword(slot + 0x18) + 0x10) == model.integer(arena + 0x30) == 0
        boost = model.qword(home + 0x5d0)
        assert model.integer(boost + 0xc) == 1
        timer = model.qword(model.qword(boost))
        data = model.qword(timer + 0x10)
        assert model.integer(data) == 3
        assert model.integer(timer + 4) == CLAIMED_AT // 1000
        assert model.integer(timer + 0x1c) == 24 * 3600 * 20
        assert vm.call(0x13d2c0, boost, timer) == 86400
        # The original branch rejects repeat claims without extending time.
        duplicate = vm.call(0x59b664, command, ctx, 2, count=10000000)
        assert duplicate == 41 and model.integer(timer + 0x1c) == 1728000
        assert bytes(vm.uc.mem_read(avatar, 0x200)) == avatar_before
        results.append({'validation': 0, 'execution': 0, 'duplicate': duplicate,
                        'boostType': 3, 'seconds': 86400, 'ticks': 1728000,
                        'claimedArenaTrophyThreshold': 0, 'avatarUnchanged': True})
        for elapsed in (0, 3600000, 86400000, 90000000):
            ticks = max(0, (86400000 - elapsed) // 50)
            vm.uc.mem_write(timer + 0x1c, struct.pack('<i', ticks))
            assert vm.call(0x13d2c0, boost, timer) == ticks // 20
            payload, fragments, bindings = capture(model, message, buffer)
            restored, restored_buffer, used, _ = decode(vm, payload)
            assert used == len(payload) and encode(vm, restored, restored_buffer) == payload
            restored_home = model.qword(restored + 0x80)
            restored_manager = model.qword(restored_home + 0x650)
            restored_slot = vm.call(0x5d624c, restored_manager)
            assert restored_slot and model.integer(model.qword(restored_slot + 0x18) + 0x10) == 0
            assert vm.call(0x758354, model.qword(restored_home + 0x2f8), arena) == 1
            restored_boost = model.qword(restored_home + 0x5d0)
            restored_timer = model.qword(model.qword(restored_boost))
            assert model.integer(restored_timer + 0x1c) == ticks
            state = {**source.get('starter', {}), 'selectedDeck': source.get('starter', {}).get('selectedDeck', 0),
                     'arena1Boost': {'claimedAtMs': CLAIMED_AT, 'expiresAtMs': CLAIMED_AT + 86400000}}
            fixtures.append({'accountId': source['accountId'], 'name': source['name'], 'starter': state,
                             'nowMs': CLAIMED_AT + elapsed, 'payloadHex': payload.hex(),
                             'nativeDecodeConsumed': used, 'nativeReencodeEqual': True})
            if runtime is None:
                assert len(bindings) == 2
                runtime = {'schema': 1, 'librarySha256': hashlib.sha256((ROOT / 'libg.so').read_bytes()).hexdigest(),
                           'reference': [54, 1], 'seconds': 86400, 'ticksPerSecond': 20,
                           'arenaBoostTimers': {'emptyHex': empty['arenaBoostTimers'].hex(),
                                                'parts': make_parts(fragments['arenaBoostTimers'], bindings)},
                           'arenaBoostClaim': {'emptyHex': empty['arenaBoostClaim'].hex(),
                                               'claimedHex': fragments['arenaBoostClaim'].hex()}}
        # An expired timer must not unlock the already consumed arena boost.
        assert vm.call(0x59b664, command, ctx, 2, count=10000000) == 41
    report = {'librarySha256': runtime['librarySha256'], 'command': 595,
              'reference': [54, 1], 'arena': 'Arena1', 'boost': 'ChestSpeedUp', 'hours': 24,
              'executor': '0x59b664', 'boostCreator': '0x1e9c38', 'managerInitializer': '0x621370',
              'claimCheck': '0x594f28', 'lobbyClaimCheck': '0x758354', 'results': results,
              'homeFixtures': len(fixtures), 'elapsedHours': [0, 1, 24, 25],
              'gameCodeAdapters': ['context Home/Avatar/time', 'UI refresh and analytics listeners'],
              'scope': 'Original observed Arena1 branch, full linked CSV, real managers and full native Home roundtrips. Tick advancement is modeled from elapsed wall time. No Android UI, other arena rewards, chests or gameplay verified.'}
    (ROOT / 'arena-boost.json').write_text(json.dumps(runtime, indent=2) + '\n')
    (ROOT / 'native-arena-boost.json').write_text(json.dumps(report, indent=2) + '\n')
    (ROOT / 'native-arena-boost-home.json').write_text(json.dumps(fixtures, indent=2) + '\n')
    (ROOT / 'native-arena-boost-command.json').write_text(json.dumps(row, indent=2) + '\n')
    print('Native 595 Arena1 boost: execution, no currency/name changes, duplicate rejection, persisted claim and 8 Home time-boundary roundtrips PASS')


if __name__ == '__main__':
    main()

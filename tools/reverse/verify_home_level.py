"""Exercise the device's native level synchronization path on actual Node Home.

CSV table lookups are adapters. The negative case supplies the device's invalid
pointer for index -1, then runs the original crashing load; it does not reproduce
the Android allocator's out-of-bounds array contents. No game code is patched.
"""
import csv
import hashlib
import json
from pathlib import Path
import struct
import subprocess

from unicorn import UC_HOOK_MEM_INVALID
from unicorn.arm64_const import UC_ARM64_REG_PC
from native_vm import ROOT
from starter_home import StarterHome, qword, word
from verify_home import decode, encode, read_u32

DEVICE_POINTER = 0x2c2c2c2273


def install_levels(model):
    vm = model.vm
    path = ROOT / 'game-data-verified/csv_logic/exp_levels.csv'
    reader = csv.DictReader(path.open(encoding='utf-8-sig', newline=''))
    column_index = reader.fieldnames.index('QuestSlots')
    rows = [row for row in list(reader)[1:] if row['Name']]
    pointers = []
    for row in rows:
        data, record = vm.alloc(0x100), vm.alloc(0x18)
        wrapper, columns = vm.alloc(0x18), vm.alloc(len(reader.fieldnames) * 8)
        column, value = vm.alloc(0x20), vm.alloc(4)
        word(vm, value, int(row['QuestSlots']))
        vm.uc.mem_write(column + 0x18, struct.pack('<Q', value))
        vm.uc.mem_write(columns + column_index * 8, struct.pack('<Q', column))
        vm.uc.mem_write(wrapper + 0x10, struct.pack('<Q', columns))
        vm.uc.mem_write(record, struct.pack('<Q', wrapper))
        vm.uc.mem_write(data + 0x10, struct.pack('<Q', record))
        pointers.append(data)
    source_vtable = qword(vm, next(iter(model.tables)))
    vtable = vm.alloc(0x70)
    vm.uc.mem_write(vtable, bytes(vm.uc.mem_read(source_vtable, 0x70)))
    table = vm.alloc(8)
    vm.uc.mem_write(table, struct.pack('<Q', vtable))
    model.tables[table] = pointers
    vm.uc.mem_write(0xd5ddd8, struct.pack('<Q', table))
    # The native CSV initializer resolves the QuestSlots column at 0x603d64.
    word(vm, 0xcfe450, column_index)
    vm.uc.mem_write(vtable + 0x28, struct.pack('<Q', 0x20006000))
    lookups = []

    def lookup(machine):
        index = struct.unpack('<i', struct.pack('<I', machine.reg(1) & 0xffffffff))[0]
        lookups.append(index)
        assert index == -1 or 0 <= index < len(pointers), index
        machine.ret(DEVICE_POINTER if index == -1 else pointers[index])

    vm.register_hook(0x20006000, lookup)
    return lookups


def context_for(model, home, avatar):
    vm = model.vm
    context = vm.alloc(0xb0)
    vm.uc.mem_write(context + 0x48, struct.pack('<QQ', home, avatar))
    vm.uc.mem_write(home + 0x10, struct.pack('<Q', context))
    return context


def main():
    repo = Path(__file__).resolve().parents[2]
    payload = subprocess.check_output([
        'node', '-e', "require('./server/home').createStarterHomeProvider()({id:[0,37],name:'Player'}).then(h=>process.stdout.write(h.payload)).catch(e=>{console.error(e.message);process.exitCode=1})",
    ], cwd=repo)
    negative = StarterHome()
    vm = negative.vm
    message, buffer, consumed, _ = decode(vm, payload)
    assert consumed == len(payload)
    home, avatar = qword(vm, message + 0x80), qword(vm, message + 0x88)
    word(vm, home + 0x3c8, 0)
    old_payload = encode(vm, message, buffer)
    assert len(old_payload) == len(payload)
    assert sum(a != b for a, b in zip(old_payload, payload)) == 1
    bad, _, old_consumed, _ = decode(vm, old_payload)
    bad_home, bad_avatar = qword(vm, bad + 0x80), qword(vm, bad + 0x88)
    assert old_consumed == len(old_payload)
    assert read_u32(vm, bad_home + 0x3c8) == 0 and read_u32(vm, bad_avatar + 0xd8) == 1
    context = context_for(negative, bad_home, bad_avatar)
    lookups = install_levels(negative)
    faults = []

    def fault(uc, access, address, size, value, _):
        faults.append({'address': hex(address), 'bytes': size})
        return False

    vm.uc.hook_add(UC_HOOK_MEM_INVALID, fault)
    vm.uc.mem_protect(0, 4096, 0)
    try:
        vm.call(0x474628, 0, context, 3, count=100000)
    except RuntimeError:
        assert lookups == [-1, 1], lookups
        assert vm.uc.reg_read(UC_ARM64_REG_PC) == 0x549830
        assert faults == [{'address': hex(DEVICE_POINTER + 0x10), 'bytes': 8}]
        assert vm.reg(0) == DEVICE_POINTER
        assert read_u32(vm, bad_home + 0x3c8) == 2
    else:
        raise AssertionError('Zero Home level did not reproduce the native failure')

    positive = StarterHome()
    machine = positive.vm
    fixed, buf, fixed_consumed, _ = decode(machine, payload)
    assert fixed_consumed == len(payload) and encode(machine, fixed, buf) == payload
    fixed_home, fixed_avatar = qword(machine, fixed + 0x80), qword(machine, fixed + 0x88)
    assert read_u32(machine, fixed_home + 0x3c8) == read_u32(machine, fixed_avatar + 0xd8) == 1
    fixed_context = context_for(positive, fixed_home, fixed_avatar)
    fixed_lookups = install_levels(positive)
    machine.uc.mem_protect(0, 4096, 0)
    for flags in (1, 2, 3):
        assert machine.call(0x474628, 0, fixed_context, flags, count=100000) == 0
        assert read_u32(machine, fixed_home + 0x3c8) == 1
    assert fixed_lookups == []
    # Also execute the original QuestSlots lookup for valid native CSV rows.
    for level, expected in [(1, 1), (2, 2), (3, 3)]:
        row = machine.call(0x15b324, level, 0, count=100000)
        assert machine.call(0x54982c, row, count=100000) == expected
    observation = {
        'librarySha256': hashlib.sha256((ROOT / 'libg.so').read_bytes()).hexdigest(),
        'homeBytes': len(payload), 'changedWireBytes': 1, 'nativeExecute': '0x474628', 'commandId': 805,
        'negative': {'decodeConsumed': old_consumed, 'homeLevel': 0, 'avatarLevel': 1,
                     'requestedLevel': 2, 'levelRowIndices': lookups, 'nativeCrashPC': '0x549830',
                     'faultAddress': hex(DEVICE_POINTER + 0x10), 'x0': hex(DEVICE_POINTER),
                     'invalidPointerSource': 'Device register supplied by the CSV lookup adapter for index -1'},
        'positive': {'decodeConsumed': fixed_consumed, 'nativeReencodeEqual': True,
                     'homeLevel': 1, 'avatarLevel': 1, 'executionFlags': [1, 2, 3],
                     'nativeResults': [0, 0, 0], 'levelRowIndicesDuringSynchronization': [],
                     'nativeQuestSlotsForLevels1To3': [1, 2, 3]},
        'scope': 'Original native command and level/QuestSlots helpers with CSV adapters. Negative adapter supplies the observed invalid pointer, not Android allocator contents. No full Android UI or gameplay verification.',
    }
    (ROOT / 'native-home-level-regression.json').write_text(json.dumps(observation, indent=2) + '\n')
    print('Zero Home level: native command 805 requests 0 -> 2 and reads level row -1; observed fault reproduced with explicit invalid-pointer adapter: PASS')
    print('Node fixed Home: native level synchronization flags 1/2/3 and QuestSlots helpers PASS')


if __name__ == '__main__':
    main()

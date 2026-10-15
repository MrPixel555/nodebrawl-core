"""Reproduce the device's missing-events crash and run its fixed native queries.

This executes the identified native logic call chain, not the full Android UI.
The negative case retains the native decoder's accepted null catalogue.
"""
import hashlib
import json
from pathlib import Path
import struct
import subprocess

from unicorn import UC_HOOK_MEM_INVALID
from unicorn.arm64_const import UC_ARM64_REG_PC
from native_vm import ROOT
from starter_home import StarterHome, qword
from verify_home import decode, encode, read_u32


def main():
    # Use the actual Node provider, including variable account bindings.
    repo = Path(__file__).resolve().parents[2]
    payload = subprocess.check_output([
        'node', '-e', "require('./server/home').createStarterHomeProvider()({id:[0,37],name:'Player'}).then(h=>process.stdout.write(h.payload)).catch(e=>{console.error(e.message);process.exitCode=1})",
    ], cwd=repo)
    negative = StarterHome()
    vm = negative.vm
    message, buffer, consumed, _ = decode(vm, payload)
    assert consumed == len(payload)
    home = qword(vm, message + 0x80)
    manager = qword(vm, home + 0x4f8)
    vm.uc.mem_write(manager + 0x10, bytes(8))
    old_payload = encode(vm, message, buffer)
    assert len(old_payload) == len(payload) - 2
    bad, _, old_consumed, _ = decode(vm, old_payload)
    bad_home = qword(vm, bad + 0x80)
    assert old_consumed == len(old_payload)
    assert qword(vm, qword(vm, bad_home + 0x4f8) + 0x10) == 0
    # NativeVM maps an ELF snapshot from zero. Android does not map its null
    # page; protect that page here so the same dereference faults at 0x14.
    vm.uc.mem_protect(0, 4096, 0)
    faults = []

    def fault(uc, access, address, size, value, _):
        faults.append({'address': hex(address), 'bytes': size})
        return False

    vm.uc.hook_add(UC_HOOK_MEM_INVALID, fault)
    try:
        vm.call(0x4c29a0, bad_home, count=100000)
    except RuntimeError:
        assert vm.uc.reg_read(UC_ARM64_REG_PC) == 0x243198
        assert faults == [{'address': '0x14', 'bytes': 4}]
        assert vm.reg(0) == 8
    else:
        raise AssertionError('Missing-events regression did not fault')

    positive = StarterHome()
    machine = positive.vm
    fixed, fixed_buffer, fixed_consumed, _ = decode(machine, payload)
    assert fixed_consumed == len(payload) and encode(machine, fixed, fixed_buffer) == payload
    fixed_home = qword(machine, fixed + 0x80)
    events = qword(machine, qword(machine, fixed_home + 0x4f8) + 0x10)
    assert events and read_u32(machine, events + 0x14) == 0
    assert read_u32(machine, events) == 0xffffffff  # Native catalogue constructor default.
    machine.uc.mem_protect(0, 4096, 0)
    assert machine.call(0x551634, fixed_home, count=100000) == 0
    assert machine.call(0x4c29a0, fixed_home, count=100000) == 0
    observation = {
        'librarySha256': hashlib.sha256((ROOT / 'libg.so').read_bytes()).hexdigest(),
        'oldHomeBytes': len(old_payload), 'fixedHomeBytes': len(payload),
        'negative': {'decodeConsumed': old_consumed, 'cataloguePresent': False,
                     'nativeCrashPC': '0x243198', 'faultAddress': '0x14', 'x0': 8},
        'positive': {'decodeConsumed': fixed_consumed, 'nativeReencodeEqual': True,
                     'cataloguePresent': True, 'catalogueRevision': -1, 'eventCount': 0,
                     'nativeEventQuery': 0, 'nativeLobbyOfferQuery': 0},
        'scope': 'Exact observed native null dereference reproduced with a guarded null page, then original query chain accepts Node Home with native empty event catalogue. CSV lookups are adapters; full Android UI still needs a device run.',
    }
    (ROOT / 'native-lobby-regression.json').write_text(json.dumps(observation, indent=2) + '\n')
    print('Old Home decodes but reproduces libg+0x243198 fault at 0x14: PASS')
    print('Node fixed Home: native decode/reencode and both lobby event queries PASS')


if __name__ == '__main__':
    main()

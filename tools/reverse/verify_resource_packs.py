"""Verify command 687 and original gold-pack execution against linked CSV data.

Only context observers and analytics are adapted. Resource prices, eligibility,
gold-credit notification and gem/free-gem debiting execute in the library.
"""
import argparse
import hashlib
import json
import struct
from pathlib import Path

from native_csv import NativeCsv
from native_vm import ROOT
from verify_home import decode, read_u32
from verify_player_commands import fixture
from verify_schemas import vint


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--checkpoint', type=str, default=str(ROOT / 'native-csv-linked-state'))
    args = parser.parse_args()
    model = NativeCsv()
    model.restore(Path(args.checkpoint))
    vm = model.vm
    assert vm.uc.mem_read(0xd6c128, 1)[0] == 1
    seed = bytearray(8192)
    seed[331] = 9
    message, _, _, _ = decode(vm, bytes(seed))
    home, avatar = model.qword(message + 0x80), model.qword(message + 0x88)
    context = vm.alloc(0x100)
    vm.uc.mem_write(context + 0x48, struct.pack('<QQ', home, avatar))
    observer = vm.alloc(8)
    vtable = vm.alloc(0x600)
    vm.uc.mem_write(observer, struct.pack('<Q', vtable))
    callback = 0x20004500
    vm.register_hook(callback, lambda machine: machine.ret(0))
    for offset in (0x18, 0x30, 0x2b8):
        vm.uc.mem_write(vtable + offset, struct.pack('<Q', callback))
    for address in (0x12adb0, 0x5f9674):
        vm.register_hook(address, lambda machine: machine.ret(observer))
    credits = []
    credit_callback = 0x20004504
    def credit(machine):
        credits.append([machine.reg(n) for n in range(1, 5)])
        machine.ret(0)
    vm.register_hook(credit_callback, credit)
    vm.uc.mem_write(vtable + 0x18, struct.pack('<Q', credit_callback))
    # Resource-change analytics has no effect on the authoritative balances.
    vm.register_hook(0x2d7b10, lambda machine: machine.ret(0))
    packs = model.qword(0xd5dc68 + 55 * 8)
    resources = model.qword(0xd5dc68 + 5 * 8)
    gold = vm.call(model.qword(model.qword(resources) + 0x38), resources, model.string('Gold'))
    commodity = vm.alloc(16)
    vm.call(0x1c4a60, commodity, gold, 100)
    array = vm.alloc(8)
    vm.uc.mem_write(array, struct.pack('<Q', commodity))
    collection = model.qword(avatar + 0x90)
    vm.uc.mem_write(collection, struct.pack('<Qii', array, 1, 1))
    fixtures, results = [], []
    for index in range(model.integer(packs + 0x14)):
        pack = model.qword(model.qword(packs + 8) + index * 8)
        name = model.read_string(model.qword(pack + 8))
        fields = {'field_0x10': 0, 'field_0xc': 0, 'field_0x14': [0, 0], 'field_0x20': [55, index]}
        wire = vint(687) + bytes(4) + vint(55) + vint(index)
        row, command = fixture(model, 687, fields, wire, index)
        fixtures.append(row)
        amount = model.integer(pack + 0x38)
        assert model.qword(pack + 0x30) == gold
        cost = vm.call(0x6dbd14, command, context)
        vm.uc.mem_write(avatar + 0xe0, struct.pack('<ii', cost + 100, cost + 21))
        vm.uc.mem_write(commodity + 8, struct.pack('<i', 100))
        result = vm.call(0x1be468, command, context, 2, 0, count=10000000)
        assert result == 0, (name, result)
        assert credits[-1] == [4, model.integer(gold + 0x20), amount, cost], credits[-1]
        # This executor delegates the credit through the listener. A no-op
        # observer must not be represented as native gold mutation evidence.
        assert model.integer(commodity + 8) == 100
        assert model.integer(avatar + 0xe0) == 100
        # Native spend keeps free gems <= remaining total gems.
        assert model.integer(avatar + 0xe4) == min(cost + 21, 100)
        vm.uc.mem_write(avatar + 0xe0, struct.pack('<ii', cost - 1, cost - 1))
        before = bytes(vm.uc.mem_read(commodity + 8, 4))
        rejected = vm.call(0x1be468, command, context, 2, 0, count=10000000)
        assert rejected != 0 and bytes(vm.uc.mem_read(commodity + 8, 4)) == before
        limit = vm.call(0x377e0c, gold)
        vm.uc.mem_write(commodity + 8, struct.pack('<i', limit - amount + 1))
        vm.uc.mem_write(avatar + 0xe0, struct.pack('<ii', cost + 100, cost + 21))
        capped = vm.call(0x1be468, command, context, 2, 0, count=10000000)
        assert capped != 0 and model.integer(avatar + 0xe0) == cost + 100
        results.append({'reference': [55, index], 'name': name, 'gold': amount, 'gems': cost,
                        'nativeExecutor': result, 'insufficientGemsRejected': rejected,
                        'goldLimit': limit, 'goldLimitRejected': capped,
                        'goldCreditListenerArguments': credits[-1]})
    report = {'schema': 1, 'librarySha256': hashlib.sha256((ROOT / 'libg.so').read_bytes()).hexdigest(),
              'command': 687, 'executor': '0x1be468', 'packs': results,
              'scope': 'Native codec and executor with fully linked original CSV data; context observers/analytics adapted, Android shop unverified.'}
    (ROOT / 'native-resource-packs.json').write_text(json.dumps(report, indent=2) + '\n')
    (ROOT / 'native-resource-pack-commands.json').write_text(json.dumps(fixtures, indent=2) + '\n')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()

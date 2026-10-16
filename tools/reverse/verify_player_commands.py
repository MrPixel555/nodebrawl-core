"""Verify branched player command codecs and original initial-name execution.

CSV table lookups and context/UI callbacks are explicit emulation adapters.
This probe checks 595's codec only; verify_arena_boost.py verifies its Arena1
boost execution. Other 595 reward branches remain unimplemented.
"""
import hashlib
import json
import struct

from native_vm import ROOT
from starter_home import StarterHome, qword, word
from verify_home import read_u32
from verify_schemas import vint


def fixture(model, kind, fields, wire, variant):
    vm = model.vm
    stream, _ = vm.stream(wire)
    obj = vm.call(0x36714c, stream, 1, 1, count=2000000)
    assert obj and read_u32(vm, stream + 0x14) == len(wire)
    out, buf = vm.stream()
    vm.call(0x2c0a60, out, obj, count=2000000)
    size = read_u32(vm, out + 0x14)
    assert bytes(vm.uc.mem_read(buf, size)) == wire
    return {'id': kind, 'variant': variant, 'fields': fields, 'payloadHex': wire.hex(),
            'nativeDecodeConsumed': len(wire), 'nativeReencodeEqual': True}, obj


def main():
    model = StarterHome()
    vm = model.vm
    rows = []
    for variant in range(3):
        base = {'field_0x10': 8192 if variant else 0, 'field_0xc': -37 if variant else 0,
                'field_0x14': [0, 37]}
        prefix = vint(base['field_0x10']) + vint(base['field_0xc']) + vint(0) + vint(37)
        cards = model.deck_ids[::-1] if variant else None
        foreign = [7, 999] if variant == 2 else None
        fields = {**base, 'field_0x1c': variant, 'field_0x20': cards,
                  'field_0x28': [0, 37], 'field_0x30': bool(variant), 'field_0x38': foreign}
        wire = vint(563) + prefix + vint(variant) + vint(8 if cards else 0)
        wire += b''.join(vint(card) for card in cards or [])
        wire += struct.pack('>ii', 0, 37) + bytes([int(bool(variant)) | (2 if foreign else 0)])
        if foreign:
            wire += struct.pack('>ii', *foreign)
        row, _ = fixture(model, 563, fields, wire, variant)
        rows.append(row)
        ref = [26, 0] if variant else [0, 0]
        fields = {**base, 'field_0x1c': variant, 'field_0x20': 8192,
                  'field_0x28': ref, 'field_0x30': bool(variant)}
        wire = vint(595) + prefix + vint(variant) + vint(8192) + vint(ref[0])
        if ref[0]:
            wire += vint(ref[1])
        wire += bytes([bool(variant)])
        row, _ = fixture(model, 595, fields, wire, variant)
        rows.append(row)

    # Preserve actual executor/getter/setter/string code. Adapt only context
    # ownership, UI/analytics observers and the unneeded global config pointer.
    context = vm.alloc(0x100)
    vm.uc.mem_write(context + 0x48, struct.pack('<QQ', model.home, model.avatar))
    observer = vm.alloc(8)
    vtable = vm.alloc(0x600)
    vm.uc.mem_write(observer, struct.pack('<Q', vtable))
    callback = 0x20004500
    vm.register_hook(callback, lambda machine: machine.ret(0))
    for offset in (0xf8, 0x100, 0x160, 0x208, 0x2a8, 0x368, 0x558):
        vm.uc.mem_write(vtable + offset, struct.pack('<Q', callback))
    for address, value in [(0x5f9674, observer), (0x12adb0, observer),
                           (0x2a3c24, 123), (0x15d334, 0)]:
        vm.register_hook(address, lambda machine, value=value: machine.ret(value))
    model.make(name_set=False, name_change_count=-1)
    name = 'بازیکن'
    wire = vint(948) + struct.pack('>i', len(name.encode())) + name.encode() + bytes(4)
    fields = {'field_0x20': name, 'field_0x10': 0, 'field_0xc': 0, 'field_0x14': [0, 0]}
    row, command = fixture(model, 948, fields, wire, 'initial-name')
    rows.append(row)
    assert vm.call(0x2160d4, model.avatar, context) == 0
    assert vm.call(0x67956c, 0, 0xffffffff, 0) == 0
    assert vm.call(0x19b0a0, command, context, 2, count=2000000) == 0
    assert bytes(vm.uc.mem_read(model.avatar + 0x14d, 1)) == b'\1'
    assert read_u32(vm, model.avatar + 0x150) == 0
    assert read_u32(vm, model.home + 0x6d8) == 123
    string = model.avatar + 0x60
    size = read_u32(vm, string + 4)
    pointer = string + 8 if size < 8 else qword(vm, string + 8)
    assert bytes(vm.uc.mem_read(pointer, size)).decode() == name
    assert read_u32(vm, model.avatar + 0xe0) == 100
    # Generic CSV adapters also need a data-type object for the original spell
    # availability check. The eight starter spells are enabled, non-Hero rows.
    for data in model.deck:
        data_type = vm.alloc(0x20)
        word(vm, data_type + 0x18, read_u32(vm, data + 0x20) // 1000000)
        vm.uc.mem_write(data + 0x18, struct.pack('<Q', data_type))
    config = vm.alloc(0x600)
    vm.uc.mem_write(config + 0x301, b'\1')  # MULTIPLE_DECKS_ENABLED in original globals.csv.
    vm.register_hook(0x15d334, lambda machine: machine.ret(config))
    vm.uc.mem_write(model.home + 0x10, struct.pack('<Q', context))
    deck_row = next(row for row in rows if row['id'] == 563 and row['variant'] == 1)
    inp, _ = vm.stream(bytes.fromhex(deck_row['payloadHex']))
    deck_command = vm.call(0x36714c, inp, 1, 1)
    assert vm.call(0x6750b0, deck_command, context, 2, count=2000000) == 0
    assert read_u32(vm, model.home + 0x2a0) == 1
    deck_pointer = qword(vm, qword(vm, model.home + 0x150) + 8)
    assert bytes(vm.uc.mem_read(deck_pointer, 32)) == struct.pack('<8i', *model.deck_ids[::-1])
    assert [read_u32(vm, qword(vm, qword(vm, model.home + 0x20 + n * 8) + 8) + 0x20) for n in range(8)] == model.deck_ids[::-1]
    (ROOT / 'native-player-commands.json').write_text(json.dumps(rows, indent=2) + '\n')
    report = {'librarySha256': hashlib.sha256((ROOT / 'libg.so').read_bytes()).hexdigest(),
              'command': 948, 'executor': '0x19b0a0', 'validation': '0x2160d4',
              'initialNameChangeCount': -1, 'finalNameChangeCount': 0,
              'nameSet': True, 'gemsUnchanged': True, 'homeNameChangeTick': 123,
              'deckCommand': 563, 'deckExecutor': '0x6750b0', 'selectedDeck': 1,
              'reorderedDeck': model.deck_ids[::-1],
              'activeCardOrderMatched': True,
              'scope': 'Original initial-name and deck-content executors with CSV/context/observer adapters; not Android UI, later paid renaming, card purchases or upgrades.'}
    (ROOT / 'native-player-state.json').write_text(json.dumps(report, indent=2) + '\n')
    print('563/595 native branched codecs and 948 native initial-name executor PASS')


if __name__ == '__main__':
    main()

"""Verify native clan command 477 and Home/Profile membership branches.

Offline analysis only. CSV lookup adapters resolve badges; the original wire
codecs execute. This does not emulate the Android clan UI or clan chat.
"""
import json
import struct
import csv
from pathlib import Path

from native_vm import ROOT
from starter_home import StarterHome, qword, word
from verify_home import decode, encode, read_u32
from verify_alliances import install_csv, wire_fields, HEADER
from verify_schemas import vint


def main():
    repository = Path(__file__).resolve().parents[2]
    catalogue = json.loads((repository / 'server/data/alliance-catalogue.json').read_text())
    for name in ('alliance_badges', 'regions'):
        rows = list(csv.DictReader((ROOT / 'game-data-verified/csv_logic' / (name + '.csv')).open(encoding='utf-8-sig')))[1:]
        assert catalogue[name] == [row['Name'] for row in rows if row['Name']]
    globals_ = list(csv.DictReader((ROOT / 'game-data-verified/csv_logic/globals.csv').open(encoding='utf-8-sig')))[1:]
    assert catalogue['createCost'] == int(next(row['NumberValue'] for row in globals_ if row['Name'] == 'ALLIANCE_CREATE_COST')) == 1000
    model = StarterHome()
    install_csv(model, 16, 'alliance_badges')
    vm = model.vm
    fixtures = []
    schema = [('field_0x20', 'long'), ('field_0x30', 'string'),
              ('field_0x28', 'ref'), ('field_0x38', 'bool'),
              ('field_0x1c', 'vint'), ('field_0x10', 'vint'),
              ('field_0xc', 'vint')]
    for created in (False, True):
        fields = dict(field_0x20=[0, 37], field_0x30='قبیله',
                      field_0x28=[16, 0], field_0x38=created,
                      field_0x1c=0, field_0x10=100, field_0xc=101,
                      field_0x14=[0, 123])
        payload = wire_fields(schema, fields) + b''.join(vint(n) for n in fields['field_0x14'])
        command = vm.call(0x41a1dc, 477)
        assert read_u32(vm, command + 0x3c) == 0
        stream, _ = vm.stream(payload)
        vm.call(0x55e580, command, stream)
        assert read_u32(vm, stream + 0x14) == len(payload)
        out, buffer = vm.stream()
        vm.call(0x3f19a0, command, out)
        assert read_u32(vm, out + 0x14) == len(payload)
        assert bytes(vm.uc.mem_read(buffer, len(payload))) == payload
        fixtures.append(dict(id=477, fields=fields, payloadHex=(vint(477) + payload).hex(),
                             nativeDecodeConsumed=len(payload), nativeReencodeEqual=True))

    # The Avatar clan presence bit follows nameSet and two other boolean flags.
    # Its optional data resets packing; the following two false flags then
    # occupy a new byte. Compare whole original Home and Profile encodings.
    observations = []
    for profile in (False, True):
        vm.uc.mem_write(model.avatar + 0xf8, bytes(8))
        baseline = model.make_profile() if profile else model.make()
        name_binding = next(b for b in model.bindings if b['field'] == 'avatarMembership')
        at = name_binding['offset']
        identity = vm.alloc(8)
        vm.uc.mem_write(identity, struct.pack('<ii', 0, 37))
        vm.uc.mem_write(model.avatar + 0xf8, struct.pack('<Q', identity))
        vm.uc.mem_write(model.avatar + 0x100, struct.pack('<Q', model.data[16000000]))
        word(vm, model.avatar + 0x108, 2)
        word(vm, model.avatar + 0x128, 0)
        raw = 'قبیله'.encode() + b'\0'
        chars = vm.alloc(len(raw))
        vm.uc.mem_write(chars, raw)
        vm.call(0x65612c, model.avatar + 0x110, chars)
        # make()/make_profile() leave clan fields intact, unlike their ordinary
        # account/name/deck bindings. Both run full native decode/re-encode.
        actual = model.make_profile() if profile else model.make()
        branch = bytes([baseline[at] | 8]) + vint(0) + vint(37)
        branch += struct.pack('>i', len(raw) - 1) + raw[:-1]
        # Avatar already supplies table 16 to 0x6d5a08: ordinal+1 only.
        branch += vint(1) + vint(2) + vint(0) + b'\0'
        expected = baseline[:at] + branch + baseline[at + 1:]
        assert actual == expected, (profile, len(actual), len(expected))
        observations.append(dict(messageId=22757 if profile else 21217,
                                 membershipOffset=at, bytes=len(actual), nativeReencodeEqual=True))
    (ROOT / 'native-clan-membership-fixtures.json').write_text(json.dumps(fixtures, indent=2) + '\n')
    (ROOT / 'native-clan-membership.json').write_text(json.dumps(observations, indent=2) + '\n')
    header = {name: {'long': [0, 37], 'string': 'قبیله', 'ref': [0, 0], 'vint': 0, 'bool': False}[typ] for name, typ in HEADER}
    header.update(field_0x10=[16, 0], field_0x18=1, field_0x1c=1)
    member_schema = [('field_0x10', 'long'), ('field_0x20', 'string'), ('field_0x48', 'ref')]
    member_schema += [('field_' + off, 'vint') for off in ('0x28', '0x2c', '0x30', '0x34', '0x38', '0x3c', '0x40', '0x50', '0x5c')]
    member_schema += [('field_0x54', 'bool'), ('field_0x55', 'bool'), ('field_0x58', 'int'), ('optional', 'bool'), ('field_0x8', 'long')]
    member = {name: {'long': [0, 123], 'string': 'Player', 'ref': [54, 1], 'vint': 0, 'int': 0, 'bool': False}[typ] for name, typ in member_schema}
    member.update(field_0x28=2, field_0x30=1, field_0x8=[0, 0])
    description = 'توضیح'
    wire = wire_fields(HEADER, header) + wire_fields([('description', 'string')], {'description': description})
    wire += vint(1) + wire_fields(member_schema, member) + vint(0) + b'\0'
    msg = vm.alloc(0x1000)
    stream, buffer = vm.stream(wire)
    vm.uc.mem_write(msg + 0x10, bytes(vm.uc.mem_read(stream, 0x70)))
    vm.call(0x694730, msg, count=3000000)
    assert read_u32(vm, msg + 0x24) == len(wire)
    word(vm, msg + 0x24, 0)
    word(vm, msg + 0x2c, 0)
    vm.call(0x583b9c, msg, count=3000000)
    assert read_u32(vm, msg + 0x24) == len(wire)
    assert bytes(vm.uc.mem_read(buffer, len(wire))) == wire
    member.pop('optional')
    member['field_0x18'] = None
    full = dict(id=28165, fields={'field_0x80': dict(header=header, description=description, members=[member], field_0x28=0, field_0x30=None)},
                payloadHex=wire.hex(), nativeDecodeConsumed=len(wire), nativeReencodeEqual=True)
    (ROOT / 'native-full-clan-fixtures.json').write_text(json.dumps([full], indent=2) + '\n')
    # Execute the acknowledgement against linked source data. The original
    # executor debits creation gold and assigns ID/name/badge/role. UI and
    # analytics/achievement notifications are separate observer adapters.
    from native_csv import NativeCsv
    from verify_arena_boost import context, hook
    linked = NativeCsv()
    linked.restore(ROOT / 'native-csv-linked-state')
    lv = linked.vm
    source = json.loads((ROOT / 'starter-home-fixture.json').read_text())[0]
    obj, _, _, _ = decode(lv, bytes.fromhex(source['payloadHex']))
    home, avatar = linked.qword(obj + 0x80), linked.qword(obj + 0x88)
    ctx = context(linked, home, avatar)
    listener = lv.call(0x5f9674, ctx)
    table = linked.qword(listener)
    for off in range(0, 0x600, 8):
        lv.uc.mem_write(table + off, struct.pack('<Q', 0x20004500))
    hook(lv, 0x11e04c, lambda v: v.ret(0))
    hook(lv, 0x2d7b10, lambda v: v.ret(0))
    gold = linked.qword(linked.qword(linked.qword(avatar + 0x90)))
    word(lv, gold + 8, 1100)
    free_gold = lv.alloc(16)
    lv.call(0x1c4a60, free_gold, lv.call(0x5c9218), 500)
    array = lv.alloc(16)
    lv.uc.mem_write(array, struct.pack('<QQ', gold, free_gold))
    lv.uc.mem_write(linked.qword(avatar + 0x90), struct.pack('<Qii', array, 2, 2))
    command = lv.call(0x41a1dc, 477)
    payload = bytes.fromhex(fixtures[1]['payloadHex'])[len(vint(477)):]
    stream, _ = lv.stream(payload)
    lv.call(0x55e580, command, stream)
    assert lv.call(0x6dbf30, command, ctx, 2, count=3000000) == 0
    assert linked.integer(gold + 8) == 100
    assert linked.integer(free_gold + 8) == 100
    assert linked.integer(avatar + 0x108) == 2
    assert bytes(lv.uc.mem_read(linked.qword(avatar + 0xf8), 8)) == struct.pack('<ii', 0, 37)
    lv.uc.mem_write(command + 0x38, b'\0')
    assert lv.call(0x6dbf30, command, ctx, 2, count=3000000) == 0
    assert linked.integer(gold + 8) == 100 and linked.integer(avatar + 0x108) == 1
    print('Native clan command and full Home/Profile membership round trips PASS')


if __name__ == '__main__':
    main()

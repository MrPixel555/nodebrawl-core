"""Verify native clan search headers and create/edit request wire formats.

UI request/response identification is documented separately. This harness runs
the native codecs with explicit CSV data lookup adapters, not clan gameplay.
"""
import csv
import json
import struct

from native_vm import ROOT
from starter_home import StarterHome, qword, word
from verify_home import read_u32
from verify_schemas import vint

HEADER = [('field_0x0', 'long'), ('field_0x8', 'string'), ('field_0x10', 'ref')]
HEADER += [('field_' + off, 'vint') for off in ('0x18', '0x1c', '0x20', '0x24', '0x28', '0x2c', '0x30', '0x40', '0x44', '0x48')]
HEADER += [('field_0x58', 'ref'), ('field_0x50', 'ref'), ('field_0x60', 'bool')]
HEADER += [('field_' + off, 'vint') for off in ('0x34', '0x38', '0x3c')]
HEADER += [('field_' + off, 'bool') for off in ('0x61', '0x62', '0x63', '0x64')]
CREATE = [('field_0x80', 'string'), ('field_0x88', 'string'), ('field_0x90', 'ref'), ('field_0xa0', 'vint'), ('field_0xa4', 'vint'), ('field_0x98', 'ref')]
EDIT = [('field_0x80', 'string'), ('field_0x88', 'ref'), ('field_0x98', 'vint'), ('field_0x9c', 'vint'), ('field_0x90', 'ref')]


def wire_fields(schema, fields):
    output = bytearray()
    bits, index = 0, None
    for name, typ in schema:
        value = fields[name]
        if typ == 'bool':
            if bits == 0:
                index = len(output)
                output.append(0)
            output[index] |= int(value) << bits
            bits = (bits + 1) % 8
            continue
        bits = 0
        if typ == 'vint':
            output += vint(value)
        elif typ == 'long':
            output += struct.pack('>ii', *value)
        elif typ == 'ref':
            output += vint(value[0]) + (vint(value[1]) if value[0] else b'')
        elif typ == 'string':
            output += struct.pack('>i', -1) if value is None else struct.pack('>i', len(value.encode())) + value.encode()
        else:
            raise AssertionError(typ)
    return bytes(output)


def install_csv(model, kind, name):
    vm = model.vm
    vtable = qword(vm, next(iter(model.tables)))
    rows = list(csv.DictReader((ROOT / 'game-data-verified/csv_logic' / (name + '.csv')).open(encoding='utf-8-sig', newline='')))[1:]
    pointers = []
    for row in rows:
        if not row['Name']:
            continue
        pointer = vm.alloc(0x100)
        identity = kind * 1000000 + len(pointers)
        word(vm, pointer + 0x20, identity)
        model.data[identity] = pointer
        pointers.append(pointer)
    model.install_table(kind, pointers, vtable)


def roundtrip(vm, kind, encoder, decoder, fields, payload, variant):
    for _ in range(2):
        message = vm.alloc(0x1000)
        stream, buffer = vm.stream(payload)
        vm.uc.mem_write(message + 0x10, bytes(vm.uc.mem_read(stream, 0x70)))
        vm.call(decoder, message, count=2000000)
        consumed = read_u32(vm, message + 0x24)
        assert consumed == len(payload), (kind, consumed, len(payload))
        if kind == 25074 and fields['field_0x88'] is not None:
            collection = qword(vm, message + 0x88)
            assert collection and read_u32(vm, collection + 0xc) == len(fields['field_0x88'])
        word(vm, message + 0x24, 0)
        word(vm, message + 0x2c, 0)
        vm.call(encoder, message, count=2000000)
        size = read_u32(vm, message + 0x24)
        assert size == len(payload) and bytes(vm.uc.mem_read(buffer, size)) == payload, kind
    return {'id': kind, 'variant': variant, 'fields': fields, 'payload': payload.hex(),
            'native_decode_consumed': consumed, 'native_reencode_equal': True}


def main():
    model = StarterHome()
    install_csv(model, 16, 'alliance_badges')
    install_csv(model, 57, 'locations')
    vm = model.vm
    fixtures, headers = [], []
    for variant in (0, 1):
        create = {'field_0x80': 'Clan' if not variant else 'قبیله', 'field_0x88': 'Description' if not variant else 'توضیح',
                  'field_0x90': [16, variant], 'field_0xa0': variant + 1, 'field_0xa4': 8192 if variant else 0,
                  'field_0x98': [57, variant]}
        fixtures.append(roundtrip(vm, 10453, 0x6c12fc, 0x74935c, create, wire_fields(CREATE, create), variant))
        edit = {'field_0x80': create['field_0x88'], 'field_0x88': create['field_0x90'],
                'field_0x98': create['field_0xa0'], 'field_0x9c': create['field_0xa4'], 'field_0x90': create['field_0x98']}
        if variant:
            # Edit's native wire limit is 900000, unlike Create's 140*4.
            edit['field_0x80'] = 'ا' * 300
        fixtures.append(roundtrip(vm, 13882, 0x4a1128, 0x3ccde4, edit, wire_fields(EDIT, edit), variant))
        header = {}
        for index, (name, typ) in enumerate(HEADER):
            header[name] = {'vint': -8192 if variant else 12345, 'bool': bool((index + variant) % 2),
                            'long': [7, 8192] if variant else [0, 37], 'string': 'قبیله' if variant else 'Clan', 'ref': [0, 0]}[typ]
        header['field_0x10'] = [16, variant]
        header['field_0x50'] = [57, variant]
        headers.append(header)
    for variant, (query, entries) in enumerate([('empty', []), ('قبیله', headers), (None, None)]):
        fields = {'field_0x80': query, 'field_0x88': entries}
        payload = wire_fields([('field_0x80', 'string')], fields) + vint(-1 if entries is None else len(entries))
        if entries:
            payload += b''.join(wire_fields(HEADER, entry) for entry in entries)
        fixtures.append(roundtrip(vm, 25074, 0x5c51b0, 0x2c6bb0, fields, payload, variant))
    (ROOT / 'native-alliances.json').write_text(json.dumps(fixtures, indent=2) + '\n')
    print('Native clan create/edit wire formats and search headers: 7 fixtures PASS')


if __name__ == '__main__':
    main()

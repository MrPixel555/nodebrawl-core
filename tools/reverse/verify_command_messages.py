"""Verify nested command envelopes and native server/client classification."""
import hashlib
import json
import struct
from pathlib import Path

from native_csv import NativeCsv
from native_vm import ROOT
from verify_home import read_u32
from verify_player_commands import fixture
from verify_schemas import vint


def main():
    model = NativeCsv()
    model.restore(ROOT / 'native-csv-linked-state')
    vm = model.vm
    commands = json.loads(Path('lib/protocol/command-profile.json').read_text())['commands']
    server_ids = []
    for command in commands:
        obj = vm.call(0x41a1dc, command['id'])
        assert obj
        if vm.call(model.qword(model.qword(obj) + 0x38), obj) & 1:
            server_ids.append(command['id'])
    fixtures = []
    base = {'field_0x10': 0, 'field_0xc': 0, 'field_0x14': [0, 0]}
    server = {**base, 'field_0x20': 0, 'field_0x1c': 17}
    server_row, _ = fixture(model, 203, server, vint(203) + struct.pack('>i', 0) + vint(17) + bytes(4), 'server-command')
    client = {**base, 'field_0x1c': 5}
    client_row, _ = fixture(model, 628, client, vint(628) + bytes(4) + vint(5), 'pending-reward-index')
    def verify(kind, encode_at, decode_at, fields, payload):
        obj = vm.alloc(0x200)
        stream, buffer = vm.stream(payload)
        vm.uc.mem_write(obj + 0x10, bytes(vm.uc.mem_read(stream, 0x70)))
        vm.call(decode_at, obj, count=4000000)
        assert read_u32(vm, obj + 0x24) == len(payload)
        if kind in (16194, 22192):
            assert bool(model.qword(obj + 0x80)) == (fields['field_0x80'] is not None)
        vm.uc.mem_write(obj + 0x24, bytes(4))
        vm.uc.mem_write(obj + 0x2c, bytes(4))
        vm.call(encode_at, obj, count=4000000)
        assert read_u32(vm, obj + 0x24) == len(payload)
        assert bytes(vm.uc.mem_read(buffer, len(payload))) == payload
        fixtures.append({'id': kind, 'fields': fields, 'payloadHex': payload.hex(),
                         'nativeDecodeConsumed': len(payload), 'nativeReencodeEqual': True})
    verify(22192, 0x167b88, 0x6129d8, {'field_0x80': {'id': 203, 'fields': server}}, bytes.fromhex(server_row['payloadHex']))
    for cmd in (None, client_row):
        wire = vint(8192) + vint(-7) + bytes([int(cmd is not None)])
        if cmd:
            wire += bytes.fromhex(cmd['payloadHex'])
        fields = {'field_0x88': 8192, 'field_0x8c': -7,
                  'field_0x80': None if cmd is None else {'id': cmd['id'], 'fields': cmd['fields']}}
        verify(16194, 0x4b1fb4, 0x47f938, fields, wire)
    for rows, tail in [([], None), ([server_row, client_row], None), ([client_row], bytes.fromhex('00ff01807f'))]:
        wire = vint(8192) + vint(-8192) + vint(len(rows)) + b''.join(bytes.fromhex(r['payloadHex']) for r in rows)
        wire += bytes([int(tail is not None)])
        if tail is not None:
            wire += struct.pack('>i', len(tail)) + tail
        fields = {'field_0x80': 8192, 'field_0x7c': -8192,
                  'commands': [{'id': r['id'], 'fields': r['fields']} for r in rows],
                  'field_0x98': None if tail is None else {'hex': tail.hex()}}
        verify(26980, 0x24f744, 0x217b98, fields, wire)
    digest = hashlib.sha256((ROOT / 'libg.so').read_bytes()).hexdigest()
    (ROOT / 'command-origin.json').write_text(json.dumps({'librarySha256': digest, 'serverCommandIds': server_ids}, indent=2) + '\n')
    (ROOT / 'native-command-messages.json').write_text(json.dumps(fixtures, indent=2) + '\n')
    print(f'Native command classification ({len(server_ids)} server types) and {len(fixtures)} nested message roundtrips: PASS')


if __name__ == '__main__':
    main()

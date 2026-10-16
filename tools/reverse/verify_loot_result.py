"""Verify ordinary (type-zero) chest-result command 235 against native codecs.

No loot-generation or account-credit rules are replaced by these fixtures.
Distinct payload values exercise the wire fields, not valid economy prices.
"""
import hashlib
import json
import struct
from pathlib import Path

from native_csv import NativeCsv
from native_vm import ROOT
from verify_player_commands import fixture
from verify_schemas import vint


def main():
    model = NativeCsv()
    model.restore(ROOT / 'native-csv-linked-state')
    vm = model.vm
    table = model.qword(0xd5dc68 + 7 * 8)
    count = vm.call(model.qword(model.qword(table) + 0x20), table)
    special = []
    for index in range(count):
        spell = vm.call(model.qword(model.qword(table) + 0x28), table, index)
        if vm.call(0x1e6e98, spell) & 1:
            special.append(index + 1)
    digest = hashlib.sha256((ROOT / 'libg.so').read_bytes()).hexdigest()
    metadata = {'librarySha256': digest, 'table': 7, 'count': count, 'extendedFieldIndexes': special}
    (ROOT / 'spell-wire.json').write_text(json.dumps(metadata, indent=2) + '\n')
    base = {'field_0x1c': 17, 'field_0x10': 37, 'field_0xc': -7, 'field_0x14': [0, 8192]}
    rows = []

    def card(index, variant):
        fields = {'spellIndex': index}
        wire = vint(index)
        for off, value in zip((0x10, 0x14, 0x18, 0x1c, 0x2c, 0x30), (1, 8192, -7, 37, 128, -8192)):
            fields['field_' + hex(off)] = value
            wire += vint(value)
        if index in special:
            fields['field_0x34'], fields['field_0x38'] = -1, 12345
            wire += vint(-1) + vint(12345)
        fields['field_0x28'], fields['field_0x29'] = bool(variant & 1), bool(variant & 2)
        wire += bytes([variant & 3])
        return fields, wire

    for variant in range(6):
        result = None
        wire = b'\0'
        if variant:
            result = {'type': 0}
            body = vint(0)
            for key in ('field_0x8', 'field_0x10'):
                entries = None if variant == 1 else [] if variant == 2 else [card(1, variant), card(count, variant ^ 3)]
                if variant == 5 and special:
                    entries.append(card(special[0], variant))
                result[key] = None if entries is None else [entry[0] for entry in entries]
                body += vint(-1 if entries is None else len(entries))
                body += b''.join(entry[1] for entry in entries or [])
            for off, value in zip((0x18, 0x1c, 0x20, 0x24), (123, -7, 8192, 37)):
                result['field_' + hex(off)] = value
                body += vint(value)
            result['field_0x28'] = None if variant < 4 else [{'reference': [70, 0], 'amount': 5}, {'reference': [70, 3], 'amount': 7}]
            body += vint(-1 if result['field_0x28'] is None else 2)
            for item in result['field_0x28'] or []:
                body += vint(item['reference'][0]) + vint(item['reference'][1]) + vint(item['amount'])
            wire = b'\1' + body
        fields = {'field_0x20': result, 'field_0x28': 5, **base}
        wire = vint(235) + wire + vint(5) + vint(17) + vint(37) + vint(-7) + vint(0) + vint(8192)
        row, command = fixture(model, 235, fields, wire, variant)
        # Enclosing server message 22192 is exactly the command's bytes.
        message = vm.alloc(0x200)
        stream, buffer = vm.stream(wire)
        vm.uc.mem_write(message + 0x10, bytes(vm.uc.mem_read(stream, 0x70)))
        vm.call(0x6129d8, message, count=4000000)
        assert model.qword(message + 0x80)
        rows.append(row)
    (ROOT / 'native-loot-result-commands.json').write_text(json.dumps(rows, indent=2) + '\n')
    report = {'librarySha256': digest, 'command': 235, 'serverMessage': 22192,
              'resultFactory': '0x4d7594', 'resultType': 0, 'resultEncode': '0x3f0ad0', 'resultDecode': '0x5417bc',
              'cardEncode': '0x5c40d8', 'cardDecode': '0x45886c', 'spellMetadata': metadata,
              'fixtures': len(rows), 'scope': 'Original ordinary loot-result wire codec, null/empty/nonempty card vectors, conditional spell fields, resource integers and tokens. Synthetic payload values. Draft result type 2, loot-generation probabilities and actual rewards are not implemented by these fixtures.'}
    (ROOT / 'native-loot-result.json').write_text(json.dumps(report, indent=2) + '\n')
    print(f'Native 235 ordinary loot-result codec: {len(rows)} fixtures; {count} spell indexes / {len(special)} extended variants PASS')


if __name__ == '__main__':
    main()

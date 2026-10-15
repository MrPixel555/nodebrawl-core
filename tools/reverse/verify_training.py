"""Recover training request/stop wire formats; no battle simulation is emulated."""
import json

from native_vm import ROOT
from starter_home import StarterHome, qword, word
from verify_alliances import install_csv, wire_fields, roundtrip
from verify_schemas import vint


def main():
    model = StarterHome()
    install_csv(model, 18, 'npcs')
    # Type 79's business table is unresolved. These two explicit synthetic data
    # objects test reference coding only; they are not claimed valid game modes.
    vm = model.vm
    pointers = []
    for index in range(2):
        pointer = vm.alloc(0x100)
        word(vm, pointer + 0x20, 79000000 + index)
        model.data[79000000 + index] = pointer
        pointers.append(pointer)
    model.install_table(79, pointers, qword(vm, next(iter(model.tables))))
    fixtures = []
    for variant in range(2):
        fields = {'field_0x80': [18, variant]}
        wire = wire_fields([('field_0x80', 'ref')], fields)
        fixtures.append(roundtrip(vm, 17967, 0x6ed88c, 0x7499d4, fields, wire, variant))
        fields = {'field_0x80': [79, variant] if variant else [0, 0], 'field_0x88': [18, variant]}
        wire = wire_fields([('field_0x80', 'ref'), ('field_0x88', 'ref')], fields)
        fixtures.append(roundtrip(vm, 10953, 0x1cfe5c, 0x2c68c0, fields, wire, variant))
    commands = json.loads((ROOT / 'native-commands.json').read_text())
    for variant, kinds in enumerate([[], [703, 805]]):
        selected = [next(c for c in commands if c['id'] == kind and c['variant'] == variant) for kind in kinds]
        fields = {'field_0x88': 8192 if variant else 0, 'field_0x8c': -37 if variant else 1,
                  'commands': [{'id': c['id'], 'fields': c['fields']} for c in selected]}
        wire = vint(fields['field_0x88']) + vint(fields['field_0x8c']) + vint(len(selected))
        wire += b''.join(bytes.fromhex(c['payloadHex']) for c in selected)
        fixtures.append(roundtrip(vm, 12405, 0x480d04, 0x410668, fields, wire, variant))
    (ROOT / 'native-training.json').write_text(json.dumps(fixtures, indent=2) + '\n')
    print('Training request refs 10953/17967 and HomeLogicStopped 12405: 6 native codec fixtures PASS (type 79 adapter is synthetic; no battle engine claimed)')


if __name__ == '__main__':
    main()

"""Verify event catalogue wire data and native CASUAL mode-name resolution.

Does not advertise an event, match players or create a battle snapshot.
"""
import argparse
import csv
import hashlib
import json
import struct
from pathlib import Path

from native_csv import NativeCsv
from native_strings import initialize_strings
from native_vm import ROOT
from unicorn.arm64_const import UC_ARM64_REG_X8

REPOSITORY = Path(__file__).resolve().parents[2]
INTEGER_FIELDS = {'id': 0, 'versionId': 4, 'variantId': 8, 'category': 0x28,
                  'startTime': 0x2c, 'endTime': 0x30, 'visibleTime': 0x34, 'visibleEndTime': 0x38,
                  'targetingId': 0x98, 'schedulingType': 0xa0, 'eventGroupId': 0xa4,
                  'eventTopGroupId': 0xa8, 'impressionId': 0xac}
TEXT_FIELDS = {'name': 0x10, 'startNotificationTid': 0x40,
               'endNotificationTid': 0x58, 'eventName': 0x70}
JSON_KEYS = {'versionId': 'version_id', 'variantId': 'variant_id', 'startTime': 'start_time',
             'endTime': 'end_time', 'visibleTime': 'visible_time', 'visibleEndTime': 'visible_end_time',
             'targetingId': 'targeting_id', 'personallyTargeted': 'personally_targeted',
             'schedulingType': 'scheduling_type', 'eventGroupId': 'event_group_id',
             'eventTopGroupId': 'event_top_group_id', 'impressionId': 'impression_id',
             'startNotificationTid': 'start_notif_tid', 'endNotificationTid': 'end_notif_tid',
             'eventName': 'event_name'}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--checkpoint', type=Path)
    args = parser.parse_args()
    model = NativeCsv()
    if args.checkpoint:
        model.restore(args.checkpoint)
    vm = model.vm
    initializers = initialize_strings(vm)
    path = 'csv_logic/game_modes.csv'
    source = ROOT / 'game-data-verified' / path
    digest = hashlib.sha256(source.read_bytes()).hexdigest()
    evidence = json.loads((REPOSITORY / 'docs/apk-evidence.json').read_text())['tables']
    assert digest == next(row['decodedSha256'] for row in evidence if row['path'] == path)
    model.load(path, 72)
    with source.open(newline='') as handle:
        rows = [row for row in list(csv.DictReader(handle))[1:] if row['Name']]
    modes = {row['Name']: (index, row) for index, row in enumerate(rows)}
    text = vm.alloc(24)
    vm.uc.reg_write(UC_ARM64_REG_X8, text)
    vm.call(0x23a400, 20)
    assert model.read_string(text) == 'CASUAL'

    def event(identity, mode=None, variant=False):
        fields = {name: 0 for name in INTEGER_FIELDS}
        fields.update({name: '' for name in TEXT_FIELDS})
        fields.update(id=identity, versionId=8192 if variant else 1, variantId=-37 if variant else 0,
                      category=20, startTime=1600000000, endTime=2000000000,
                      visibleTime=1599990000, visibleEndTime=2000000000,
                      name='نبرد' if variant else mode or 'Wire probe', eventName=mode or '',
                      targetingId=37 if variant else 0, personallyTargeted=variant,
                      schedulingType=2 if variant else 0, eventGroupId=3 if variant else 0,
                      eventTopGroupId=4 if variant else 0, impressionId=8192 if variant else 0,
                      json=json.dumps({'GameMode': mode}) if mode else None)
        native_json = {JSON_KEYS.get(name, name): value for name, value in fields.items() if value is not None}
        obj = vm.alloc(0xb0)
        vm.call(0x15ad14, obj)
        vm.call(0x3ed574, obj, vm.call(0x73b08c, model.string(json.dumps(native_json))))
        if mode is None:
            # JSON decoding supplies an empty String even for a missing key.
            # Explicitly bind the optional pointer to null for this wire-only
            # fixture; it is not an available/configured Party event.
            vm.uc.mem_write(obj + 0x88, bytes(8))
        for name, offset in INTEGER_FIELDS.items():
            assert model.integer(obj + offset) == fields[name], name
        for name, offset in TEXT_FIELDS.items():
            assert model.read_string(obj + offset) == fields[name], name
        assert bool(vm.uc.mem_read(obj + 0x9c, 1)[0]) == fields['personallyTargeted']
        pointer = model.qword(obj + 0x88)
        assert (model.read_string(pointer) if pointer else None) == fields['json']
        if mode:
            index, row = modes[mode]
            assert row['ValidPartyMode'].lower() == 'true'
            handler = vm.call(0x71d0c8, obj)
            assert handler and model.qword(handler) == 0xa53cb0
            data = model.qword(handler + 0x18)
            assert data and model.integer(data + 0x20) == 72000000 + index
        return fields, obj

    party = [event(1001, 'DoubleElixir'), event(1002, 'TeamVsTeamLadder', True)]
    cases = [(-1, []), (1, party), (8192, [event(8192, variant=True)])]
    fixtures = []
    for revision, entries in cases:
        catalogue = vm.alloc(0x18)
        vm.call(0x6a22ec, catalogue)
        vm.uc.mem_write(catalogue, struct.pack('<i', revision))
        pointers = vm.alloc(max(8, len(entries) * 8))
        for index, (_, pointer) in enumerate(entries):
            vm.uc.mem_write(pointers + index * 8, struct.pack('<Q', pointer))
        vm.uc.mem_write(catalogue + 8, struct.pack('<Qii', pointers, len(entries), len(entries)))
        stream, buffer = vm.stream()
        vm.call(0x524ba0, catalogue, stream)
        size = model.integer(stream + 0x14)
        wire = bytes(vm.uc.mem_read(buffer, size))
        decoded = vm.alloc(0x18)
        vm.call(0x6a22ec, decoded)
        source_stream, _ = vm.stream(wire)
        vm.call(0x23da1c, decoded, source_stream)
        assert model.integer(source_stream + 0x14) == size
        assert model.integer(decoded) == revision and model.integer(decoded + 0x14) == len(entries)
        output, destination = vm.stream()
        vm.call(0x524ba0, decoded, output)
        assert model.integer(output + 0x14) == size and bytes(vm.uc.mem_read(destination, size)) == wire
        fixtures.append({'fields': {'revision': revision, 'events': [fields for fields, _ in entries]},
                         'payloadHex': wire.hex(), 'nativeDecodeConsumed': size, 'nativeReencodeEqual': True})
    (ROOT / 'native-party-catalogue-fixtures.json').write_text(json.dumps(fixtures, indent=2, ensure_ascii=False) + '\n')
    report = {'librarySha256': hashlib.sha256((ROOT / 'libg.so').read_bytes()).hexdigest(),
              'category': 20, 'nativeCategoryName': 'CASUAL', 'categoryNameFunction': '0x23a400',
              'eventConstructor': '0x15ad14', 'eventJsonDecoder': '0x3ed574',
              'eventEncoder': '0x412a70', 'eventDecoder': '0x35c298',
              'catalogueEncoder': '0x524ba0', 'catalogueDecoder': '0x23da1c',
              'handlerFactory': '0x71d0c8', 'handlerVtable': '0xa53cb0',
              'modeKey': 'GameMode', 'modeSourceSha256': digest,
              'modes': [{'name': name, 'globalId': 72000000 + modes[name][0]} for name in ('DoubleElixir', 'TeamVsTeamLadder')],
              'fixtures': len(fixtures), 'selectedStringInitializers': len(initializers), 'gameCodeAdapters': [],
              'explicitFieldBindings': ['Wire-only null-JSON fixture clears event+0x88 after JSON decoding'],
              'scope': 'Original event/catalogue codecs and CASUAL JSON mode-name resolution using raw native CSV records. Does not verify targeting/time filters, Home UI, event availability, matchmaking or battles; no event is advertised by this tool.'}
    (ROOT / 'native-party-catalogue.json').write_text(json.dumps(report, indent=2) + '\n')
    print('Native CASUAL category, two Party mode names and 3 catalogue codec fixtures PASS; gameplay NOT verified')


if __name__ == '__main__':
    main()

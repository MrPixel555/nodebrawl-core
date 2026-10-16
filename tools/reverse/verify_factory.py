"""Execute the original MessageFactory, optionally over every 16-bit ID."""
import argparse
import hashlib
import json
import struct

from native_vm import NativeVM, ROOT
from unicorn.arm64_const import UC_ARM64_REG_SP


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--all', action='store_true', help='Check every unsigned 16-bit ID and both factory flags')
    args = parser.parse_args()
    registry = {}
    for row in json.loads((ROOT / 'registry.json').read_text()):
        # Some IDs, including Login, have multiple catalogued class variants.
        registry.setdefault(row['id'], []).append(row)
    identities = range(65536) if args.all else sorted(registry)
    vm = NativeVM(trace_instructions=False)
    records, failures = [], []
    for identity in identities:
        for flag in (0, 1):
            vm.heap = 0x10000000
            vm.uc.reg_write(UC_ARM64_REG_SP, 0x201f0000)
            factory = vm.alloc(16)
            vm.uc.mem_write(factory + 8, bytes([flag]))
            record = {'id': identity, 'factory_flag': flag}
            pointer = 0
            try:
                pointer = vm.call(0x622544, factory, identity, count=200000, timeout=1000000)
                if pointer:
                    vtable, version = struct.unpack('<QI', vm.uc.mem_read(pointer, 12))
                    record.update(vtable=hex(vtable), version=version)
                    for name, offset in [('encode', 0x10), ('decode', 0x18), ('type', 0x28)]:
                        record[name] = hex(struct.unpack('<Q', vm.uc.mem_read(vtable + offset, 8))[0])
                    assert vm.call(int(record['type'], 16), pointer, count=200000) == identity
                    assert identity in registry, ('Uncatalogued factory message', identity)
                    assert any(all(record[name] == variant[name] for name in ('vtable', 'encode', 'decode', 'type'))
                               for variant in registry[identity]), (identity, 'class variant')
                else:
                    record['status'] = 'not-created'
            except Exception as error:
                record.update(status='unresolved', error=str(error))
                failures.append(record)
            if not args.all or pointer or record.get('status') == 'unresolved':
                records.append(record)
    if args.all:
        created = {row['id'] for row in records if 'vtable' in row}
        report = {
            'librarySha256': hashlib.sha256((ROOT / 'libg.so').read_bytes()).hexdigest(),
            'factoryFunction': '0x622544', 'range': [0, 65535], 'factoryFlags': [0, 1],
            'calls': 131072, 'createdTypes': len(created),
            'createdObservations': sum('vtable' in row for row in records),
            'cataloguedClassesWithoutFactoryCreation': sorted(registry.keys() - created),
            'observations': records, 'errors': failures,
            'scope': 'Message construction, type getters, vtables and versions only. Factory flags are not assumed to identify wire direction. Does not verify every payload codec or gameplay handler.'}
        output = ROOT / 'factory-complete-sweep.json'
    else:
        report, output = records, ROOT / 'factory-observations.json'
    output.write_text(json.dumps(report, indent=2) + '\n')
    assert not failures, f'{len(failures)} native factory checks failed; see {output}'
    print(f"Native factory PASS: {len(identities) * 2} calls, {sum('vtable' in row for row in records)} created observations")


if __name__ == '__main__':
    main()

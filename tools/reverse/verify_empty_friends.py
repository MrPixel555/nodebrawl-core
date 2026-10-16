"""Native server-friend list prefetch used when opening the Party popup.

An empty server registry is real; this is not a Party schedule or matchmaking.
"""
import json
import struct

from native_vm import NativeVM, ROOT
from verify_alliances import roundtrip
from verify_home import read_u32


def main():
    vm = NativeVM(trace_instructions=False)
    # Type zero selects 0x720b48 in the original dispatcher jump table.
    offset = struct.unpack_from('<H', vm.memory, 0x898ec4)[0]
    assert 0x720b48 + offset * 4 == 0x720b48
    rows = []
    for kind in (0, 1, 2, 3):
        wire = struct.pack('>ii', kind, 0)
        rows.append(roundtrip(vm, 21047, 0x5e5f88, 0x204f78,
                              {'kind': kind, 'count': 0}, wire, kind))
    controller = vm.alloc(0xb0)
    collection = vm.alloc(0x10)
    vm.call(0x6e4584, controller, collection, count=1000000)
    vm.call(0x1d5274, controller, count=1000000)
    assert read_u32(vm, controller + 0x70) == 0
    (ROOT / 'native-empty-friends.json').write_text(json.dumps(rows, indent=2) + '\n')
    print('Native empty server-friend list codec + type-zero list consumer/listener refresh PASS')


if __name__ == '__main__':
    main()

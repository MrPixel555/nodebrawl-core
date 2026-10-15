"""Verify message 28991's deferred stream and original zlib consumer.

Uses synthetic bytes as an opaque snapshot. Only the downstream GameMode loader
is adapted; this does NOT construct or validate an initial world or battle.
"""
import hashlib
import json
import struct
import zlib

from native_vm import NativeVM, ROOT


def u32(vm, address):
    return struct.unpack('<I', vm.uc.mem_read(address, 4))[0]


def u64(vm, address):
    return struct.unpack('<Q', vm.uc.mem_read(address, 8))[0]


def main():
    vm = NativeVM(trace_instructions=False)
    observed = []

    def capture(machine):
        stream = machine.reg(1)
        offset = u32(machine, stream + 0x14)
        length = u32(machine, stream + 0x18)
        observed.append(bytes(machine.uc.mem_read(u64(machine, stream + 0x20) + offset, length - offset)))
        machine.ret(1)

    vm.register_hook(0x2e66ac, capture)
    snapshot = b'synthetic-envelope-probe\0\x2a\x2b' * 3
    rows = []
    for compressed in (False, True):
        wire = bytes([compressed])
        wire += struct.pack('<i', len(snapshot)) + zlib.compress(snapshot) if compressed else snapshot
        obj = vm.alloc(0x1000)
        stream, buf = vm.stream(wire)
        vm.uc.mem_write(obj, struct.pack('<Q', 0xa4d488))
        vm.uc.mem_write(obj + 0x10, bytes(vm.uc.mem_read(stream, 0x70)))
        assert vm.call(0x1c9004, obj) == obj + 0x10
        # The type-specific methods do not consume, clear or serialize the body.
        vm.call(0x200810, obj)
        vm.call(0xfb52c, obj)
        assert u32(vm, obj + 0x24) == 0
        assert bytes(vm.uc.mem_read(buf, len(wire))) == wire
        # The later consumer resets offset, reads the flag and, if necessary,
        # runs the original native zlib decompressor before our capture hook.
        vm.uc.mem_write(obj + 0x24, struct.pack('<I', 2))
        before = len(observed)
        assert vm.call(0x540850, vm.alloc(0x100), obj, count=5000000) == 1
        assert observed[before:] == [snapshot]
        rows.append({'compressed': compressed, 'payloadHex': wire.hex(),
                     'opaqueSnapshotHex': snapshot.hex(), 'syntheticSnapshot': True,
                     'nativeVirtualDecodeConsumed': 0, 'nativeDeferredSnapshotMatched': True})
    # The constructor used immediately after snapshot loading makes ack 15263.
    ack = vm.alloc(0x100)
    vm.call(0x145f08, ack)
    assert u64(vm, ack) == 0xa2e478
    assert vm.call(0x1498a8, ack) == 15263
    (ROOT / 'native-sector-envelope-fixtures.json').write_text(json.dumps(rows, indent=2) + '\n')
    report = {
        'librarySha256': hashlib.sha256((ROOT / 'libg.so').read_bytes()).hexdigest(),
        'message': 28991, 'vtable': '0xa4d488', 'streamGetter': '0x1c9004',
        'consumer': '0x540850', 'compressedConsumer': '0x23fc3c',
        'decompressor': '0x6a21bc', 'rawGameModeLoader': '0x2e66ac',
        'snapshotDecoder': '0x431508', 'optionalInitializationDecoder': '0x6123b8',
        'ack': {'message': 15263, 'constructor': '0x145f08', 'vtable': '0xa2e478'},
        'envelope': 'byte flag (1=zlib, other=native raw); compressed remainder: int32LE size + zlib bytes',
        'nodeCanonicalFlags': [0, 1], 'nativeRawAndCompressedMatched': True,
        'adapters': ['0x2e66ac captures decompressed bytes instead of loading an actual world'],
        'scope': 'Synthetic compression-envelope fixtures only. Initial GameMode/world state and playable Training/Party/PvP remain unresolved.'
    }
    (ROOT / 'native-sector-envelope.json').write_text(json.dumps(report, indent=2) + '\n')
    print('28991 native deferred raw/zlib envelope and 15263 ack type PASS; world/gameplay NOT verified')


if __name__ == '__main__':
    main()

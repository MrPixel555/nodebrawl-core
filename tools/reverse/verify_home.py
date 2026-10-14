"""Reproduce a canonical empty Home through unmodified native serializers.

This probes the wire structure only. It does not initialize game data or prove
that an Android client accepts an empty collection, empty decks or avatar.
"""
import json
import struct

from native_vm import NativeVM, ROOT


def read_u32(vm, address):
    return struct.unpack('<I', vm.uc.mem_read(address, 4))[0]


def decode(vm, payload):
    obj = vm.alloc(0x1000)
    stream, buffer = vm.stream(payload)
    vm.uc.mem_write(obj + 0x10, bytes(vm.uc.mem_read(stream, 0x70)))
    vm.input_stream = obj + 0x10
    vm.reads.clear()
    vm.call(0x154440, obj, count=10000000)
    return obj, buffer, read_u32(vm, obj + 0x24), list(vm.reads)


def encode(vm, obj, buffer):
    vm.uc.mem_write(obj + 0x24, bytes(4))
    vm.uc.mem_write(obj + 0x2c, bytes(4))
    vm.call(0x4bce90, obj, count=10000000)
    size = read_u32(vm, obj + 0x24)
    return bytes(vm.uc.mem_read(buffer, size))


def main():
    vm = NativeVM(trace_instructions=False)
    seed = bytearray(8192)
    # Native avatar decoder 0x43bda4 requires exactly nine commodity groups.
    # This is a literal check, not a count inferred from the resource CSV.
    seed[331] = 9
    obj, buffer, consumed, _ = decode(vm, bytes(seed))
    assert consumed == 374, f'Seed consumed {consumed}, expected 374'
    canonical = encode(vm, obj, buffer)
    second, second_buffer, consumed, reads = decode(vm, canonical)
    assert consumed == len(canonical), 'Native canonical decoder did not consume all bytes'
    assert encode(vm, second, second_buffer) == canonical, 'Native canonical Home is unstable'
    observation = {'id': 21217, 'payloadHex': canonical.hex(), 'bytes': len(canonical),
                   'nativeDecodeConsumed': consumed, 'nativeReencodeEqual': True,
                   'runtimeState': 'Protocol VM, zero-initialized game globals; no Android client validation',
                   'emptyHomeIsPlayable': False, 'reads': reads}
    (ROOT / 'native-home.json').write_text(json.dumps(observation, indent=2) + '\n')
    print(f'Native canonical Home encode/decode/re-encode: PASS ({consumed} bytes)')


if __name__ == '__main__':
    main()

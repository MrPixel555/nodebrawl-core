"""Exercise libc/heap adapters and bounded continuation used by native CSV work."""
import struct

from native_vm import NativeVM
from unicorn.arm64_const import UC_ARM64_REG_X0, UC_ARM64_REG_X8, UC_ARM64_REG_X16, UC_ARM64_REG_Q8, UC_ARM64_REG_NZCV


def main():
    for size in (0, 4095, 0x10001000):
        try:
            NativeVM(heap_size=size)
        except ValueError:
            pass
        else:
            raise AssertionError('Invalid heap size accepted')
    vm = NativeVM(trace_instructions=False, heap_size=4096)
    pointer = vm.alloc(4096)
    assert bytes(vm.uc.mem_read(pointer, 4096)) == bytes(4096)
    end = vm.heap
    try:
        vm.alloc(1)
    except AssertionError:
        pass
    else:
        raise AssertionError('Heap overflow accepted')
    assert vm.heap == end
    vm = NativeVM(trace_instructions=False)
    imports = {name: address for address, name in vm.imports.items()}

    def text(value):
        pointer = vm.alloc(len(value) + 1)
        vm.uc.mem_write(pointer, value + b'\0')
        return pointer

    assert vm.call(imports['strcasecmp'], text(b'String'), text(b'string')) == 0
    assert vm.call(imports['strcasecmp'], text(b'a'), text(b'b')) & 0xffffffff == 0xffffffff
    assert vm.call(imports['atoi'], text(b' \t-37rest')) & 0xffffffff == 0xffffffdb
    assert vm.call(imports['atoi'], text(b'no digits')) == 0
    block = vm.call(imports['calloc'], 16, 4)
    assert bytes(vm.uc.mem_read(block, 64)) == bytes(64)
    timestamp = vm.alloc(8)
    assert vm.call(imports['time'], timestamp) == 1
    assert struct.unpack('<q', vm.uc.mem_read(timestamp, 8))[0] == 1
    assert vm.call(imports['time'], 0) == 1
    # Both direct and indirect/GOT calls must reach the same libc adapter,
    # including an existing PLT suffix reached after its ADRP instruction.
    malloc_slot = next(slot for slot, entry in vm.import_slots.items() if entry == imports['malloc'])
    entry = struct.unpack('<Q', vm.uc.mem_read(malloc_slot, 8))[0]
    before = vm.heap
    assert vm.call(entry, 26) == before
    before = vm.heap
    vm.uc.reg_write(UC_ARM64_REG_X16, malloc_slot & ~4095)
    assert vm.call(entry + 4, 26) == before
    # String reads cross page boundaries and stop at NUL before the next,
    # unmapped page; chunking must retain the original bound and semantics.
    vm.uc.mem_map(0x30000000, 8192)
    vm.uc.mem_write(0x30000ffe, b'abcd\0')
    assert vm.string(0x30000ffe) == b'abcd'
    vm.uc.mem_write(0x30001ffc, b'end\0')
    assert vm.string(0x30001ffc) == b'end'
    unterminated = vm.alloc(100000)
    vm.uc.mem_write(unterminated, b'x' * 100000)
    try:
        vm.string(unterminated)
    except ValueError:
        pass
    else:
        raise AssertionError('Unterminated string bound ignored')
    # Original C++ variadic String formatter constructs its own AArch64
    # va_list. This checks the ABI boundary, not just a Python format helper.
    formatted = vm.alloc(24)
    vm.uc.reg_write(UC_ARM64_REG_X8, formatted)
    vm.call(0x229c74, text(b'Combined Table %d'), 49)
    size = struct.unpack('<I', vm.uc.mem_read(formatted + 4, 4))[0]
    data = struct.unpack('<Q', vm.uc.mem_read(formatted + 8, 8))[0]
    assert size == 17 and bytes(vm.uc.mem_read(data, size)) == b'Combined Table 49'

    def printf(fmt, values, capacity=256):
        # Two register-save slots, then stack arguments exercise both paths.
        registers = vm.alloc(16)
        stack = vm.alloc(max(16, 8 * len(values)))
        for index, value in enumerate(values):
            location = registers + index * 8 if index < 2 else stack + (index - 2) * 8
            vm.uc.mem_write(location, struct.pack('<Q', value & 0xffffffffffffffff))
        arguments = vm.alloc(32)
        vm.uc.mem_write(arguments, struct.pack('<QQQii', stack, registers + 16, 0, -16, 0))
        destination = vm.alloc(max(capacity, 16))
        vm.uc.mem_write(destination, b'!' * max(capacity, 16))
        result = vm.call(imports['vsnprintf'], destination if capacity else 0, capacity, text(fmt), arguments)
        return result, bytes(vm.uc.mem_read(destination, max(capacity, 16)))

    result, data = printf(b'%s:%+05d:%#llx:%hhu:%%', [text(b'key'), -7, 0x123456789, 257])
    assert result == len(b'key:-0007:0x123456789:1:%')
    assert data.startswith(b'key:-0007:0x123456789:1:%\0')
    assert printf(b'%*.*s', [-6, 3, text(b'abcdef')])[1].startswith(b'abc   \0')
    assert printf(b'%.0u/%#.0o', [0, 0])[1].startswith(b'/0\0')
    assert printf(b'123456', [], capacity=4) == (6, b'123\0' + b'!' * 12)
    assert printf(b'123456', [], capacity=0) == (6, b'!' * 16)
    for unsupported in (b'%n', b'%f', b'%1048577d'):
        try:
            printf(unsupported, [0])
        except RuntimeError:
            pass
        else:
            raise AssertionError('Unsupported/bounded format accepted')
    # mov w0,0; add w0,w0,1; cmp w0,100; b.lt add; ret.
    code = 0x20005000
    vm.uc.mem_write(code, struct.pack('<5I', 0x52800000, 0x11000400, 0x7101901f, 0x54ffffcb, 0xd65f03c0))
    try:
        vm.call(code, count=3)
    except RuntimeError as error:
        assert 'budget exhausted' in str(error)
    else:
        raise AssertionError('Single-slice instruction budget ignored')
    assert vm.call(code, count=64, max_slices=5) == 100
    # Save at a conditional branch: resumption needs PC, flags and live integer
    # registers. Preserve the SIMD bank as well, rather than guessing its values.
    marker = 0x112233445566778899aabbccddeeff00
    vm.uc.reg_write(UC_ARM64_REG_Q8, marker)
    try:
        vm.call(code, count=3)
    except RuntimeError as error:
        assert 'budget exhausted' in str(error)
    else:
        raise AssertionError('Expected a suspended native loop')
    state = vm.cpu_state()
    vm.uc.reg_write(UC_ARM64_REG_X0, 999)
    vm.uc.reg_write(UC_ARM64_REG_Q8, 0)
    vm.uc.reg_write(UC_ARM64_REG_X8, 0)
    vm.uc.reg_write(UC_ARM64_REG_NZCV, 0)
    vm.restore_cpu(state)
    assert vm.cpu_state() == state and vm.uc.reg_read(UC_ARM64_REG_Q8) == marker
    vm.uc.emu_start(state['pc'], vm.stop, count=10000, timeout=60000000)
    assert vm.reg(0) == 100
    for invalid in ({}, {**state, 'q8': 1 << 128}, {**state, 'pc': -1}):
        try:
            vm.restore_cpu(invalid)
        except ValueError:
            pass
        else:
            raise AssertionError('Invalid CPU snapshot accepted')
    # Continuation also preserves an imported libc call and its native frame.
    vm.uc.mem_write(code, struct.pack('<5I', 0xa9bf7bfd, 0x910003fd, 0xd63f0200, 0xa8c17bfd, 0xd65f03c0))
    vm.uc.ctl_remove_cache(code, code + 20)
    number = text(b'37')
    for budget in range(1, 10):
        vm.uc.reg_write(UC_ARM64_REG_X16, imports['atoi'])
        assert vm.call(code, number, count=budget, max_slices=10) == 37
    print('VM libc/GOT adapters, heap bounds and CPU/SIMD continuation PASS')


if __name__ == '__main__':
    main()

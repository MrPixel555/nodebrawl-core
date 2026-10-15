"""Exercise libc/heap adapters and bounded continuation used by native CSV work."""
import struct

from native_vm import NativeVM
from unicorn.arm64_const import UC_ARM64_REG_X16


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
    # Continuation also preserves an imported libc call and its native frame.
    vm.uc.mem_write(code, struct.pack('<5I', 0xa9bf7bfd, 0x910003fd, 0xd63f0200, 0xa8c17bfd, 0xd65f03c0))
    vm.uc.ctl_remove_cache(code, code + 20)
    number = text(b'37')
    for budget in range(1, 10):
        vm.uc.reg_write(UC_ARM64_REG_X16, imports['atoi'])
        assert vm.call(code, number, count=budget, max_slices=10) == 37
    print('VM libc adapters, heap bounds and exact-state execution continuation PASS')


if __name__ == '__main__':
    main()

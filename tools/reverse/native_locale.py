"""Minimal C/POSIX locale libc boundary for the single-thread AArch64 VM.

locale_t remains opaque to native callers. Its bookkeeping lives in VM memory
so locally generated memory/CPU continuations retain the selected locale.
Other locales are explicitly unsupported, rather than silently substituted.
"""
import struct

IMPORTS = {'newlocale', 'freelocale', 'uselocale', 'setlocale', 'localeconv', '__ctype_get_mb_cur_max',
           '__errno', 'strtoll_l', 'strtoull_l', 'mbtowc'}
STATE = 0x20001800
GLOBAL = 0xffffffffffffffff
TAG = b'VMLOC-C\0'


def call(vm, name):
    def read(pointer):
        return struct.unpack('<Q', vm.uc.mem_read(pointer, 8))[0]

    def write(pointer, value):
        vm.uc.mem_write(pointer, struct.pack('<Q', value))

    def check(locale):
        if locale == GLOBAL:
            return
        if not 0x10000000 <= locale < vm.heap or bytes(vm.uc.mem_read(locale, 8)) != TAG:
            raise RuntimeError('Invalid VM C locale handle')

    def c_string(value):
        pointer = vm.alloc(len(value) + 1)
        vm.uc.mem_write(pointer, value + b'\0')
        return pointer

    active = read(STATE) or GLOBAL
    a, b, c = vm.reg(0), vm.reg(1), vm.reg(2)
    if name == '__errno':
        return vm.ret(STATE + 8)
    if name == 'mbtowc':
        check(active)
        if not b:
            return vm.ret(0)  # C locale has no shift state.
        if not c:
            vm.uc.mem_write(STATE + 8, struct.pack('<i', 84))  # EILSEQ
            return vm.ret(-1)
        value = vm.uc.mem_read(b, 1)[0]
        if value >= 128:
            vm.uc.mem_write(STATE + 8, struct.pack('<i', 84))
            return vm.ret(-1)
        if a:
            vm.uc.mem_write(a, struct.pack('<I', value))
        return vm.ret(1 if value else 0)
    if name in ('strtoll_l', 'strtoull_l'):
        check(vm.reg(3))
        if c != 0 and not 2 <= c <= 36:
            raise RuntimeError('Unsupported VM integer conversion base')
        text = vm.string(a)
        position = 0
        while position < len(text) and text[position] in b'\t\n\v\f\r ':
            position += 1
        negative = position < len(text) and text[position] == 45
        if position < len(text) and text[position] in (43, 45):
            position += 1

        def digit(value):
            if 48 <= value <= 57:
                return value - 48
            if 65 <= value <= 90:
                return value - 65 + 10
            if 97 <= value <= 122:
                return value - 97 + 10
            return 36

        hexadecimal = (text[position:position + 2].lower() == b'0x'
                       and position + 2 < len(text) and digit(text[position + 2]) < 16)
        base = c or (16 if hexadecimal else 8 if text[position:position + 1] == b'0' else 10)
        if base == 16 and hexadecimal:
            position += 2
        start, value, overflow = position, 0, False
        unsigned = name == 'strtoull_l'
        limit = (1 << 64) - 1 if unsigned else (1 << 63) if negative else (1 << 63) - 1
        while position < len(text) and digit(text[position]) < base:
            number = digit(text[position])
            if value > (limit - number) // base:
                overflow = True
                value = limit
            elif not overflow:
                value = value * base + number
            position += 1
        if position == start:
            position, value = 0, 0
        if b:
            write(b, a + position)
        if overflow:
            vm.uc.mem_write(STATE + 8, struct.pack('<i', 34))  # ERANGE
        if negative and not (unsigned and overflow):
            value = -value
        return vm.ret(value)
    if name == 'newlocale':
        if vm.string(b) not in (b'C', b'POSIX'):
            raise RuntimeError('Only C/POSIX locales are supported by this VM')
        if c:
            check(c)
            if c == GLOBAL:
                raise RuntimeError('newlocale cannot modify LC_GLOBAL_LOCALE')
            return vm.ret(c)
        pointer = vm.alloc(16)
        vm.uc.mem_write(pointer, TAG)
        return vm.ret(pointer)
    if name == 'uselocale':
        if a:
            check(a)
            write(STATE, a)
        return vm.ret(active)
    if name == 'freelocale':
        check(a)
        if a in (GLOBAL, active):
            raise RuntimeError('Cannot free the global or active VM locale')
        vm.uc.mem_write(a, bytes(8))
        return vm.ret()
    if name == 'setlocale':
        if a > 6:
            raise RuntimeError('Unsupported VM locale category')
        if b and vm.string(b) not in (b'C', b'POSIX'):
            raise RuntimeError('Only C/POSIX locales are supported by this VM')
        pointer = read(STATE + 24)
        if not pointer:
            pointer = c_string(b'C')
            write(STATE + 24, pointer)
        return vm.ret(pointer)
    if name == '__ctype_get_mb_cur_max':
        check(active)
        return vm.ret(1)
    if name == 'localeconv':
        check(active)
        pointer = read(STATE + 16)
        if not pointer:
            empty, decimal = c_string(b''), c_string(b'.')
            pointer = vm.alloc(96)
            # Android LP64 lconv: ten char pointers, then fourteen char flags.
            vm.uc.mem_write(pointer, struct.pack('<10Q', decimal, *([empty] * 9)) + bytes([127]) * 14)
            write(STATE + 16, pointer)
        return vm.ret(pointer)
    raise RuntimeError('Unknown locale import')

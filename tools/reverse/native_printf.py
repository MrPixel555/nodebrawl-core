"""Bounded integer/string vsnprintf adapter for the Android AArch64 ABI.

This is a libc boundary, not a game diagnostic bypass. Unsupported conversions
raise; callers must still execute the original game's formatting/assert code.
"""
import re
import struct

LIMIT = 1048576
CONVERSION = re.compile(rb'%([-+ #0]*)(\*|[0-9]*)(?:\.(\*|[0-9]*))?(hh|ll|[hljzt])?([diuoxXcs%])')


def vsnprintf(vm, destination, capacity, format_pointer, arguments):
    fmt = vm.string(format_pointer)
    stack, gr_top, _, gr_offset, _ = struct.unpack('<QQQii', vm.uc.mem_read(arguments, 32))
    if gr_offset < -64 or gr_offset > 0 or gr_offset % 8:
        raise RuntimeError('Invalid AArch64 general-register va_list')

    def argument():
        nonlocal stack, gr_offset
        if gr_offset < 0:
            pointer = gr_top + gr_offset
            gr_offset += 8
        else:
            pointer = stack
            stack += 8
        return struct.unpack('<Q', vm.uc.mem_read(pointer, 8))[0]

    def signed(value, bits):
        value &= (1 << bits) - 1
        return value - (1 << bits) if value >> (bits - 1) else value

    output = bytearray()
    position = 0
    while position < len(fmt):
        if fmt[position] != 37:
            output.append(fmt[position])
            position += 1
            continue
        match = CONVERSION.match(fmt, position)
        if match is None:
            raise RuntimeError('Unsupported VM printf conversion')
        flags, width, precision, length, conversion = match.groups()
        position = match.end()
        width = signed(argument(), 32) if width == b'*' else int(width or b'0')
        if width < 0:
            flags += b'-'
            width = -width
        if precision is not None:
            precision = signed(argument(), 32) if precision == b'*' else int(precision or b'0')
            if precision < 0:
                precision = None
        if width > LIMIT or (precision is not None and precision > LIMIT):
            raise RuntimeError('VM printf width/precision exceeds bound')
        if conversion == b'%':
            if flags or width or precision is not None or length:
                raise RuntimeError('Unsupported VM printf percent modifiers')
            value = b'%'
        elif conversion in (b'c', b's'):
            if length:
                raise RuntimeError('VM wide character formatting is unsupported')
            raw = argument()
            value = bytes([raw & 255]) if conversion == b'c' else vm.string(raw) if raw else b'(null)'
            if conversion == b's' and precision is not None:
                value = value[:precision]
            padding = b' ' * max(0, width - len(value))
            value = value + padding if b'-' in flags else padding + value
        else:
            bits = {b'hh': 8, b'h': 16, None: 32}.get(length, 64)
            raw = argument()
            number = signed(raw, bits) if conversion in (b'd', b'i') else raw & ((1 << bits) - 1)
            sign = b''
            if conversion in (b'd', b'i'):
                sign = b'-' if number < 0 else b'+' if b'+' in flags else b' ' if b' ' in flags else b''
            magnitude = abs(number)
            digits = format(magnitude, {b'o': 'o', b'x': 'x', b'X': 'X'}.get(conversion, 'd')).encode()
            if precision == 0 and number == 0:
                digits = b''
            if precision is not None:
                digits = digits.rjust(precision, b'0')
            prefix = b''
            if b'#' in flags:
                if conversion == b'o' and not digits.startswith(b'0'):
                    prefix = b'0'
                elif conversion in (b'x', b'X') and number:
                    prefix = b'0x' if conversion == b'x' else b'0X'
            padding = max(0, width - len(sign) - len(prefix) - len(digits))
            if b'-' in flags:
                value = sign + prefix + digits + b' ' * padding
            elif b'0' in flags and precision is None:
                value = sign + prefix + b'0' * padding + digits
            else:
                value = b' ' * padding + sign + prefix + digits
        output.extend(value)
        if len(output) > LIMIT:
            raise RuntimeError('VM printf output exceeds bound')
    vm.uc.mem_write(arguments, struct.pack('<Q', stack))
    vm.uc.mem_write(arguments + 24, struct.pack('<i', gr_offset))
    if capacity:
        vm.uc.mem_write(destination, bytes(output[:capacity - 1]) + b'\0')
    return len(output)

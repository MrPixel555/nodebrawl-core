"""Install a non-UI Application initializer; preserve the game launcher."""
import struct

ANDROID = 'http://schemas.android.com/apk/res/android'
APPLICATION = 'org.nodebrawl.client.ServerApplication'
GAME = 'com.supercell.clashroyale.GameApp'
NONE = 0xffffffff


def chunks(data):
    at = 8
    while at < len(data):
        kind, header, size = struct.unpack_from('<HHI', data, at)
        if size < header or size < 8 or at + size > len(data):
            raise ValueError('Invalid binary manifest chunk')
        yield kind, bytes(data[at:at + size])
        at += size
    if at != len(data):
        raise ValueError('Invalid binary manifest size')


def read_length(data, at, utf8):
    size = 1 if utf8 else 2
    value = int.from_bytes(data[at:at + size], 'little')
    flag = 0x80 if utf8 else 0x8000
    if value & flag:
        return ((value & (flag - 1)) << (8 * size)) | int.from_bytes(data[at + size:at + 2 * size], 'little'), at + 2 * size
    return value, at + size


def length(value, utf8):
    if utf8:
        return bytes([value]) if value < 128 else bytes([(value >> 8) | 0x80, value & 255])
    return struct.pack('<H', value) if value < 32768 else struct.pack('<HH', (value >> 16) | 0x8000, value & 65535)


class Pool:
    def __init__(self, data):
        self.original = data
        _, self.header, _, self.count, self.styles, self.flags, self.start, self.style_start = struct.unpack_from('<HH6I', data)
        self.utf8 = bool(self.flags & 256)
        self.offsets = list(struct.unpack_from('<' + 'I' * self.count, data, self.header))
        self.values = []
        for offset in self.offsets:
            units, at = read_length(data, self.start + offset, self.utf8)
            if self.utf8:
                units, at = read_length(data, at, True)
            self.values.append(data[at:at + units * (1 if self.utf8 else 2)].decode('utf-8' if self.utf8 else 'utf-16le'))
        self.additions = bytearray()

    def index(self, value):
        if value in self.values:
            return self.values.index(value)
        old_data_size = (self.style_start or len(self.original)) - self.start
        self.offsets.append(old_data_size + len(self.additions))
        units = len(value.encode('utf-16le')) // 2
        encoded = value.encode('utf-8' if self.utf8 else 'utf-16le')
        self.additions.extend(length(units, self.utf8))
        if self.utf8:
            self.additions.extend(length(len(encoded), True))
        self.additions.extend(encoded + (b'\0' if self.utf8 else b'\0\0'))
        self.values.append(value)
        return len(self.values) - 1

    def build(self):
        style_offsets = self.original[self.header + 4 * self.count:self.header + 4 * (self.count + self.styles)]
        strings = self.original[self.start:self.style_start or len(self.original)] + self.additions
        strings += bytes(-len(strings) % 4)
        styles = self.original[self.style_start:] if self.style_start else b''
        start = self.header + 4 * (len(self.values) + self.styles)
        style_start = start + len(strings) if self.style_start else 0
        # Appending strings breaks the original sorted flag, if set.
        header = struct.pack('<HH6I', 1, self.header, start + len(strings) + len(styles), len(self.values), self.styles, self.flags & ~1, start, style_start)
        return header + self.original[28:self.header] + struct.pack('<' + 'I' * len(self.offsets), *self.offsets) + style_offsets + strings + styles


def attributes(chunk, pool):
    start, size, count = struct.unpack_from('<HHH', chunk, 24)
    result = {}
    for n in range(count):
        _, name, raw, _, _, kind, value = struct.unpack_from('<IIIHBBI', chunk, 16 + start + n * size)
        result[pool.values[name]] = pool.values[value] if kind == 3 else value
    return result


def patch_manifest(data):
    if struct.unpack_from('<HHI', data) != (3, 8, len(data)):
        raise ValueError('Unsupported binary manifest')
    items = list(chunks(data))
    pool = Pool(next(chunk for kind, chunk in items if kind == 1))
    application = pool.index('org.nodebrawl.client.ServerApplication')
    found = False
    for n, (kind, chunk) in enumerate(items):
        if kind != 0x102 or pool.values[struct.unpack_from('<I', chunk, 20)[0]] != 'application':
            continue
        chunk = bytearray(chunk)
        start, size, count = struct.unpack_from('<HHH', chunk, 24)
        for attribute in range(count):
            at = 16 + start + attribute * size
            namespace, name = struct.unpack_from('<II', chunk, at)
            if pool.values[name] == 'name' and pool.values[namespace] == ANDROID:
                if pool.values[struct.unpack_from('<I', chunk, at + 16)[0]] != 'android.support.multidex.MultiDexApplication':
                    raise ValueError('Unexpected original Application')
                struct.pack_into('<I', chunk, at + 8, application)
                struct.pack_into('<I', chunk, at + 16, application)
                found = True
        items[n] = kind, bytes(chunk)
    if not found:
        raise ValueError('Original Application was not found')
    body = b''.join(pool.build() if kind == 1 else chunk for kind, chunk in items)
    return struct.pack('<HHI', 3, 8, len(body) + 8) + body

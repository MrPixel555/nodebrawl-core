"""Add a launcher without rebuilding resources or changing existing indices."""
import struct

ANDROID = 'http://schemas.android.com/apk/res/android'
ACTIVITY = 'org.nodebrawl.client.ServerActivity'
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
    resource_item = next(n for n, (kind, _) in enumerate(items) if kind == 0x180)
    resources = list(struct.unpack('<' + 'I' * ((len(items[resource_item][1]) - 8) // 4), items[resource_item][1][8:]))
    def idx(value):
        return pool.index(value)
    android = idx(ANDROID)
    activity = idx('activity')
    for name, resource in [('name', 0x01010003), ('label', 0x01010001), ('exported', 0x01010010), ('process', 0x01010011), ('taskAffinity', 0x01010012)]:
        position = idx(name)
        resources.extend([0] * max(0, position + 1 - len(resources)))
        if resources[position] not in [0, resource]:
            raise ValueError('Conflicting Android attribute resource')
        resources[position] = resource
    stack, filter_start, moved, remove, insert = [], None, None, set(), None
    game_activity = False
    for n, (kind, chunk) in enumerate(items):
        if kind == 0x102:
            name = pool.values[struct.unpack_from('<I', chunk, 20)[0]]
            attrs = attributes(chunk, pool)
            stack.append(name)
            if name == 'manifest' and attrs.get('package') != 'com.supercell.clashroyale':
                raise ValueError('Unsupported package')
            if name == 'activity':
                game_activity = attrs.get('name') == GAME
            if game_activity and name == 'intent-filter':
                filter_start = n
                has_main, has_launcher = False, False
            if filter_start is not None:
                has_main |= name == 'action' and attrs.get('name') == 'android.intent.action.MAIN'
                has_launcher |= name == 'category' and attrs.get('name') == 'android.intent.category.LAUNCHER'
        elif kind == 0x103:
            name = pool.values[struct.unpack_from('<I', chunk, 20)[0]]
            if stack.pop() != name:
                raise ValueError('Unbalanced manifest')
            if name == 'intent-filter' and filter_start is not None:
                if has_main and has_launcher:
                    if moved is not None:
                        raise ValueError('Duplicate launcher')
                    moved = [value for _, value in items[filter_start:n + 1]]
                    remove.update(range(filter_start, n + 1))
                filter_start = None
            if name == 'activity':
                game_activity = False
            if name == 'application':
                insert = n
    if moved is None or insert is None:
        raise ValueError('Original launcher was not found')
    attrs = []
    for name, value in [('label', 'Clash Royale Private'), ('name', ACTIVITY), ('exported', True), ('process', ':connection'), ('taskAffinity', 'org.nodebrawl.client.connection')]:
        raw = NONE if value is True else idx(value)
        attrs.append((resources[idx(name)], struct.pack('<IIIHBBI', android, idx(name), raw, 8, 0, 0x12 if value is True else 3, NONE if value is True else raw)))
    attrs.sort()
    new_activity = struct.pack('<HHIII', 0x102, 16, 36 + 20 * len(attrs), 0, NONE) + struct.pack('<IIHHHHHH', NONE, activity, 20, 20, len(attrs), 0, 0, 0) + b''.join(value for _, value in attrs)
    end_activity = struct.pack('<HHIIIII', 0x103, 16, 24, 0, NONE, NONE, activity)
    output = []
    for n, (kind, chunk) in enumerate(items):
        if n in remove:
            continue
        if n == insert:
            output.extend([new_activity, *moved, end_activity])
        if kind == 1:
            chunk = pool.build()
        elif kind == 0x180:
            chunk = struct.pack('<HHI', kind, 8, 8 + len(resources) * 4) + struct.pack('<' + 'I' * len(resources), *resources)
        output.append(chunk)
    body = b''.join(output)
    return struct.pack('<HHI', 3, 8, len(body) + 8) + body

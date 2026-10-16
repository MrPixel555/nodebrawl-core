"""Run the original CSV parser and DataTable constructors, without row adapters.

Requires the retained, decoded game-data-verified assets. This is a reverse
engineering tool, not a Node runtime dependency or a completed battle engine.
"""
import hashlib
import json
import struct
import zlib

from native_vm import NativeVM, ROOT
from unicorn import UC_PROT_NONE


class NativeCsv:
    def __init__(self):
        self.vm = NativeVM(trace_instructions=False, heap_size=0x8000000)
        self.vm.uc.mem_protect(0, 4096, UC_PROT_NONE)
        # Original static initializer: CSV quote delimiter and empty sentinel.
        # Without it, quoted cells get split incorrectly by the native parser.
        self.vm.call(0xe1140)
        self.nodes = {}
        self.tables = {}

    def qword(self, pointer):
        return struct.unpack('<Q', self.vm.uc.mem_read(pointer, 8))[0]

    def integer(self, pointer):
        return struct.unpack('<i', self.vm.uc.mem_read(pointer, 4))[0]

    def read_string(self, pointer):
        size = self.integer(pointer + 4)
        assert 0 <= size <= 900000
        data = pointer + 8 if size < 8 else self.qword(pointer + 8)
        return bytes(self.vm.uc.mem_read(data, size)).decode('utf-8')

    def string(self, value):
        vm = self.vm
        data = value.encode('utf-8') + b'\0'
        pointer = vm.alloc(len(data))
        vm.uc.mem_write(pointer, data)
        obj = vm.alloc(24)
        vm.call(0x65612c, obj, pointer)
        return obj

    def manifest(self):
        pointer = self.vm.call(0x3f8548, count=10000000)
        rows = []
        for index in range(self.integer(pointer + 12)):
            item = self.qword(self.qword(pointer) + index * 8)
            rows.append({'path': self.read_string(item + 8),
                         'kind': self.integer(item + 32),
                         'mode': self.integer(item + 36)})
        return rows

    def parse(self, path):
        if path in self.nodes:
            return self.nodes[path]
        root = (ROOT / 'game-data-verified').resolve()
        source = (root / path).resolve()
        assert source.is_relative_to(root), 'CSV path escaped asset root'
        vm = self.vm
        lines = source.read_text(encoding='utf-8').splitlines()
        array = vm.alloc(24 * len(lines))
        vector = vm.alloc(16)
        vm.uc.mem_write(vector, struct.pack('<Qii', array, len(lines), len(lines)))
        for index, line in enumerate(lines):
            vm.uc.mem_write(array + index * 24, bytes(vm.uc.mem_read(self.string(line), 24)))
        node = vm.alloc(0x80)
        vm.call(0x4a461c, node, vector, self.string(path), count=100000000, max_slices=5)
        self.nodes[path] = node
        return node

    def load(self, path, kind):
        if kind in self.tables:
            return self.tables[kind]
        assert isinstance(kind, int) and 1 <= kind < 108
        node = self.parse(path)
        self.vm.call(0x41c214, node, kind, count=100000000)
        table = self.qword(0xd5dc68 + kind * 8)
        assert table
        self.tables[kind] = table
        return table

    def save(self, destination, scope='Raw parsed CSV/DataTable state; fields/world/gameplay not established.'):
        """Retain locally generated VM state between expensive analysis runs."""
        destination.mkdir(parents=True, exist_ok=True)
        vm = self.vm
        assert not vm.hooks and not vm.mutexes, 'Checkpoint cannot restore custom hooks or held mutexes'
        base_size = (len(vm.memory) + 4095) & ~4095
        # Page zero is intentionally unreadable; its ELF header is not executed.
        regions = [(4096, base_size - 4096), (0x10000000, vm.heap - 0x10000000),
                   (0x20000000, 0x200000)]
        blocks = []
        for index, (address, size) in enumerate(regions):
            data = bytes(vm.uc.mem_read(address, size))
            filename = f'block-{index}.zlib'
            (destination / filename).write_bytes(zlib.compress(data, 1))
            blocks.append({'file': filename, 'address': address, 'size': size,
                           'sha256': hashlib.sha256(data).hexdigest()})
        report = {'librarySha256': hashlib.sha256((ROOT / 'libg.so').read_bytes()).hexdigest(),
                  'heap': vm.heap, 'tables': self.tables, 'nodes': self.nodes,
                  'blocks': blocks, 'scope': scope}
        (destination / 'state.json').write_text(json.dumps(report, indent=2) + '\n')

    def restore(self, source):
        """Load only a checkpoint generated locally by this analysis tool."""
        report = json.loads((source / 'state.json').read_text())
        assert report['librarySha256'] == hashlib.sha256((ROOT / 'libg.so').read_bytes()).hexdigest()
        vm = self.vm
        base_size = (len(vm.memory) + 4095) & ~4095
        heap = report['heap']
        assert 0x10000000 <= heap < vm.heap_limit
        expected = [(4096, base_size - 4096), (0x10000000, heap - 0x10000000), (0x20000000, 0x200000)]
        assert len(report['blocks']) == len(expected)
        for index, (block, region) in enumerate(zip(report['blocks'], expected)):
            address, size = region
            assert (block['address'], block['size']) == region
            decoder = zlib.decompressobj()
            data = decoder.decompress((source / f'block-{index}.zlib').read_bytes(), size + 1)
            assert decoder.eof and not decoder.unused_data and len(data) == size
            assert hashlib.sha256(data).hexdigest() == block['sha256']
            vm.uc.mem_write(address, data)
        vm.heap = heap
        vm.resolve_imports()
        self.tables = {int(kind): pointer for kind, pointer in report['tables'].items()}
        self.nodes = report['nodes']

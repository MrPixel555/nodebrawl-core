"""Recover command codecs from this library and verify native round trips.

Only straight-line encoders with known stream operations are accepted. Unknown
branches/helpers remain unresolved; factory creation does not imply gameplay.
"""
import hashlib
import json
import struct

from capstone import Cs, CS_ARCH_ARM64, CS_MODE_LITTLE_ENDIAN
from native_vm import NativeVM, ROOT
from verify_schemas import vint


BASE = [
    {'field': 'field_0x10', 'offset': 0x10, 'type': 'vint', 'storage': 'value'},
    {'field': 'field_0xc', 'offset': 0xc, 'type': 'vint', 'storage': 'value'},
    {'field': 'field_0x14', 'offset': 0x14, 'type': 'vlong', 'storage': 'address'},
]
PARENTS = {0x25079c: BASE, 0x68d558: [
    {'field': 'field_0x1c', 'offset': 0x1c, 'type': 'vint', 'storage': 'value'},
] + BASE}
VIRTUAL = {0x80: 'vint', 0x48: 'int', 0x40: 'bool', 0x90: 'long', 0x20: 'string', 0x38: 'string'}


def derive(memory, address):
    if address in PARENTS:
        return PARENTS[address], None
    md = Cs(CS_ARCH_ARM64, CS_MODE_LITTLE_ENDIAN)
    md.detail = True
    regs = {'x0': ('object', 0), 'x1': ('stream', 0)}
    fields = []

    def reg(ins, operand):
        return ins.reg_name(operand.reg).replace('w', 'x', 1)

    for ins in md.disasm(memory[address:address + 0x800], address):
        ops, name = ins.operands, ins.mnemonic
        if name == 'ret':
            return fields, None
        if name in ('bl', 'b', 'blr', 'br'):
            target = ops[0].imm if ops[0].type == 2 else regs.get(reg(ins, ops[0]))
            if isinstance(target, int) and target in PARENTS:
                if regs.get('x0') != ('object', 0) or regs.get('x1') != ('stream', 0):
                    return None, 'parent arguments at ' + hex(ins.address)
                fields.extend(PARENTS[target])
            elif target == 0x1032d8 and regs.get('x1') == ('stream', 0) and regs.get('x0', (None,))[0] == 'object':
                off = regs['x0'][1]
                fields.append({'field': 'field_' + hex(off), 'offset': off, 'type': 'long', 'storage': 'address'})
            elif isinstance(target, tuple) and target[0] == 'virtual' and target[1] in VIRTUAL:
                value = regs.get('x1')
                if regs.get('x0') != ('stream', 0) or not value or value[0] not in ('value', 'object'):
                    return None, 'stream arguments at ' + hex(ins.address)
                fields.append({'field': 'field_' + hex(value[1]), 'offset': value[1],
                               'type': VIRTUAL[target[1]], 'storage': 'address' if value[0] == 'object' else 'value'})
            else:
                return None, 'unknown call at ' + hex(ins.address)
            for n in range(19):
                regs.pop('x' + str(n), None)
            if name in ('b', 'br'):
                return fields, None
        elif name == 'mov':
            regs[reg(ins, ops[0])] = regs.get(reg(ins, ops[1])) if ops[1].type == 1 else ('constant', ops[1].imm)
        elif name in ('add', 'sub') and len(ops) == 3:
            base = regs.get(reg(ins, ops[1]))
            if base and base[0] in ('object', 'stream') and ops[2].type == 2:
                regs[reg(ins, ops[0])] = (base[0], base[1] + ops[2].imm * (1 if name == 'add' else -1))
            else:
                regs.pop(reg(ins, ops[0]), None)
        elif name in ('ldr', 'ldrb', 'ldrh', 'ldur', 'ldurb', 'ldrsw'):
            mem = ops[1].mem
            base = regs.get(ins.reg_name(mem.base).replace('w', 'x', 1))
            value = None
            if base and not mem.index:
                if base[0] == 'object':
                    value = ('value', base[1] + mem.disp)
                elif base == ('stream', 0) and mem.disp == 0:
                    value = ('vtable', 0)
                elif base == ('vtable', 0):
                    value = ('virtual', mem.disp)
            regs[reg(ins, ops[0])] = value
        elif name in ('str', 'stp', 'nop'):
            pass
        elif name == 'ldp':
            for op in ops[:2]:
                regs.pop(reg(ins, op), None)
        else:
            return None, 'control flow/transform ' + name + ' at ' + hex(ins.address)
    return None, 'encoder size limit'


def verify(vm, record, variant):
    vm.heap = 0x10000000
    obj = vm.call(0x41a1dc, record['id'], count=100000)
    expected = bytearray(vint(record['id']))
    values, bits, bit_at = {}, 0, None
    for field in record['fields']:
        typ, off = field['type'], field['offset']
        value = {'vint': -8192 if variant else 12345, 'int': -123456 if variant else 345678,
                 'bool': bool(variant), 'long': [7, -234567], 'vlong': [7, -234567],
                 'string': 'بازیکن' if variant else 'protocol-check'}[typ]
        values[field['field']] = value
        if typ in ('vint', 'int'):
            vm.uc.mem_write(obj + off, struct.pack('<i', value))
        elif typ == 'bool':
            vm.uc.mem_write(obj + off, bytes([int(value)]))
        elif typ in ('vlong', 'long', 'string'):
            pointer = obj + off if field['storage'] == 'address' else vm.alloc(24)
            if typ == 'string':
                data = vm.alloc(len(value.encode()) + 1)
                vm.uc.mem_write(data, value.encode() + b'\0')
                vm.call(0x65612c, pointer, data)
            else:
                vm.uc.mem_write(pointer, struct.pack('<ii', *value))
            if field['storage'] != 'address':
                vm.uc.mem_write(obj + off, struct.pack('<Q', pointer))
        if typ == 'bool':
            if bits == 0:
                bit_at = len(expected)
                expected.append(0)
            expected[bit_at] |= int(value) << bits
            bits = (bits + 1) % 8
        else:
            bits = 0
            if typ == 'vint':
                expected += vint(value)
            elif typ == 'int':
                expected += struct.pack('>i', value)
            elif typ == 'vlong':
                expected += b''.join(vint(n) for n in value)
            elif typ == 'long':
                expected += struct.pack('>ii', *value)
            elif typ == 'string':
                expected += struct.pack('>i', len(value.encode())) + value.encode()
    stream, buffer = vm.stream()
    vm.call(0x2c0a60, stream, obj, count=2000000)
    length = struct.unpack('<I', vm.uc.mem_read(stream + 0x14, 4))[0]
    payload = bytes(vm.uc.mem_read(buffer, length))
    assert payload == expected, 'native encoder differs from derived schema'
    inp, _ = vm.stream(payload)
    decoded = vm.call(0x36714c, inp, 1, 1, count=2000000)
    assert decoded, 'native decoder rejected command'
    consumed = struct.unpack('<I', vm.uc.mem_read(inp + 0x14, 4))[0]
    assert consumed == length
    out, buf = vm.stream()
    vm.call(0x2c0a60, out, decoded, count=2000000)
    size = struct.unpack('<I', vm.uc.mem_read(out + 0x14, 4))[0]
    assert bytes(vm.uc.mem_read(buf, size)) == payload
    return {'id': record['id'], 'variant': variant, 'fields': values, 'payloadHex': payload.hex(),
            'nativeDecodeConsumed': consumed, 'nativeReencodeEqual': True}


def main():
    vm = NativeVM(trace_instructions=False)
    # Optional formatted debug logging needs Android's varargs ABI; disabling
    # this diagnostic flag lets unknown IDs return null normally. Code is intact.
    vm.uc.mem_write(0xaa34ec, b'\0')
    records, fixtures = [], []
    for kind in range(1, 1001):
        vm.heap = 0x10000000
        obj = vm.call(0x41a1dc, kind, count=100000)
        if not obj:
            continue
        table = struct.unpack('<Q', vm.uc.mem_read(obj, 8))[0]
        slots = struct.unpack('<8Q', vm.uc.mem_read(table, 64))
        assert vm.call(slots[4], obj, count=10000) == kind
        fields, reason = derive(vm.memory, slots[5])
        record = {'id': kind, 'vtable': hex(table), 'encode': hex(slots[5]), 'decode': hex(slots[6]),
                  'execute': hex(slots[3]), 'fields': fields, 'unresolvedReason': reason}
        if fields is not None:
            # An extraction is accepted only after both native variants pass.
            verified = [verify(vm, record, variant) for variant in (0, 1)]
            fixtures.extend(verified)
        records.append(record)
    output = {'schema': 1, 'librarySha256': hashlib.sha256((ROOT / 'libg.so').read_bytes()).hexdigest(),
              'factory': '0x41a1dc', 'enumeratedRange': [1, 1000], 'commands': records}
    (ROOT / 'command-profile.json').write_text(json.dumps(output, indent=2) + '\n')
    (ROOT / 'native-commands.json').write_text(json.dumps(fixtures, indent=2) + '\n')
    print('Native command factory:', len(records), 'created;', len(fixtures) // 2, 'verified codecs')


if __name__ == '__main__':
    main()

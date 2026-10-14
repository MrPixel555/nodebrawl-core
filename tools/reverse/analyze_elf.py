import struct
from pathlib import Path
import os
from elftools.elf.elffile import ELFFile
from capstone import Cs, CS_ARCH_ARM64, CS_MODE_LITTLE_ENDIAN

ROOT = Path(os.environ['GAME_ANALYSIS_DIR'])
raw = (ROOT / 'libg.so').read_bytes()
elf = ELFFile(open(ROOT / 'libg.so', 'rb'))
memory = bytearray(max(s['p_vaddr'] + s['p_memsz'] for s in elf.iter_segments() if s['p_type'] == 'PT_LOAD'))
for s in elf.iter_segments():
    if s['p_type'] == 'PT_LOAD':
        memory[s['p_vaddr']:s['p_vaddr'] + s['p_filesz']] = s.data()
for name in ['.rela.dyn', '.rela.plt']:
    for r in elf.get_section_by_name(name).iter_relocations():
        if r['r_info_type'] == 1027:
            struct.pack_into('<Q', memory, r['r_offset'], r['r_addend'])
md = Cs(CS_ARCH_ARM64, CS_MODE_LITTLE_ENDIAN)
md.detail = True
init = elf.get_section_by_name('.init_array')
inits = struct.unpack('<' + 'Q' * (init['sh_size'] // 8), memory[init['sh_addr']:init['sh_addr'] + init['sh_size']])
print('Init functions:', [hex(x) for x in inits[:8]])
first = inits[0]
def table_at(address):
    entries = []
    if not 0 <= address < len(memory) - 20: return None
    for p in range(address, len(memory) - 20, 12):
        v1, v2, v3, v4, v5 = struct.unpack_from('<5i', memory, p)
        addr = (v4 - v3 - v2 - v1 + address) & 0xffffffff
        size = (v2 + v4 - v5) & 0xffffffff
        if size == 0:
            return entries if len(entries) >= 5 else None
        if addr + size >= len(memory): return None
        entries.append((addr, size))
    return None

regs = {}
table = None
key_address = None
and_seen = False
potential = None
for i in md.disasm(bytes(memory[first:first+0x10000]), first):
    ops = i.operands
    addr = None
    if i.mnemonic in ['adr', 'adrp']:
        addr = ops[1].imm
        regs[ops[0].reg] = addr
        if and_seen: potential = addr
    elif i.mnemonic in ['add', 'sub'] and len(ops) == 3 and ops[1].reg in regs:
        change = ops[2].imm if ops[2].type == 2 else regs.get(ops[2].reg, 0)
        addr = regs[ops[1].reg] + change * (1 if i.mnemonic == 'add' else -1)
        regs[ops[0].reg] = addr
        if and_seen and potential: potential = addr
    elif potential and not key_address:
        key_address = potential
    if i.mnemonic == 'and' and ops[2].type == 2 and ops[2].imm == 127:
        and_seen = True
    if addr is not None and table is None:
        entries = table_at(addr)
        if entries and len(entries) * 12 + 20 >= 0x10000:
            table = (addr, entries)
    if table and key_address: break
assert table and key_address, 'Could not identify encrypted strings table and key'
print('String table:', hex(table[0]), 'ranges:', len(table[1]), 'key:', hex(key_address))
key = memory[key_address:key_address+128]
for addr, size in table[1]:
    for n in range(size): memory[addr+n] ^= key[n % 128]
out = bytearray(raw)
data = elf.get_section_by_name('.data')
out[data['sh_offset']:data['sh_offset']+data['sh_size']] = memory[data['sh_addr']:data['sh_addr']+data['sh_size']]
(ROOT / 'libg.strings-decrypted.so').write_bytes(out)
(ROOT / 'memory.bin').write_bytes(memory)

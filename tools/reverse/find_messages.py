import struct, json
from pathlib import Path
import os
from elftools.elf.elffile import ELFFile
from capstone import Cs, CS_ARCH_ARM64, CS_MODE_LITTLE_ENDIAN
root = Path(os.environ['GAME_ANALYSIS_DIR'])
elf = ELFFile(open(root/'libg.so','rb'))
memory = (root/'memory.bin').read_bytes()
sec=elf.get_section_by_name('.text')
start,end=sec['sh_addr'],sec['sh_addr']+sec['sh_size']
results=[]
for p in range(start,end-8,4):
    a,b=struct.unpack_from('<II',memory,p)
    if a & 0xffe0001f == 0x52800000 and b == 0xd65f03c0:
        value=(a>>5)&0xffff
        if 10000<=value<30000: results.append({'id':value,'function':hex(p)})
print(json.dumps(results,indent=2))
(root/'message-types.json').write_text(json.dumps(results,indent=2))
ids={int(x['function'],16):x['id'] for x in results}
registry=[]
for p in range(0xa2a160,0xa7ec78,8):
    q=struct.unpack_from('<Q',memory,p)[0]
    if q in ids and struct.unpack_from('<Q',memory,p+8)[0]==0x398ea8:
        registry.append({'id':ids[q], 'vtable':hex(p-40), 'encode':hex(struct.unpack_from('<Q',memory,p-24)[0]), 'decode':hex(struct.unpack_from('<Q',memory,p-16)[0]), 'type':hex(q)})
(root/'registry.json').write_text(json.dumps(registry,indent=2))
print('Message vtables:',len(registry))

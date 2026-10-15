import json
from pathlib import Path
import os
from capstone import Cs, CS_ARCH_ARM64, CS_MODE_LITTLE_ENDIAN
root=Path(os.environ['GAME_ANALYSIS_DIR'])
m=(root/'memory.bin').read_bytes();md=Cs(CS_ARCH_ARM64,CS_MODE_LITTLE_ENDIAN);md.detail=True
primitives={0x47f5e8:'int',0x45d234:'vint',0x399aa0:'string',0x360d18:'string',0x344840:'long',0x487e90:'bool'}
def reg(i,r):return i.reg_name(r).replace('w','x',1)
def derive(address):
    registers={'x0':('pointer',0)};fields=[]
    for ins in md.disasm(m[address:address+0x800],address):
        ops=ins.operands;name=ins.mnemonic
        if name=='ret':return fields,None
        if name in ['bl','b']:
            target=ops[0].imm
            if target==0x240230:pass
            elif target in primitives:
                value=registers.get('x1')
                if value is None or value[0] not in ['field','pointer','constant']:return None,'unresolved source at '+hex(ins.address)
                if registers.get('x0')!=('pointer',0x10):return None,'non-message stream at '+hex(ins.address)
                entry={'type':primitives[target],'instruction':hex(ins.address)}
                if value[0]=='constant':entry['constant']=value[1]
                else:entry['field']='field_'+hex(value[1]);entry['object_offset']=hex(value[1]);entry['storage']=value[0]
                fields.append(entry)
            else:return None,'nested/unknown call '+hex(target)
            for n in range(19):registers.pop('x'+str(n),None)
            if name=='b':return fields,None
        elif name=='mov':
            dest=reg(ins,ops[0].reg)
            if ops[1].type==2:registers[dest]=('constant',ops[1].imm)
            elif reg(ins,ops[1].reg)=='xzr':registers[dest]=('constant',0)
            else:registers[dest]=registers.get(reg(ins,ops[1].reg))
        elif name in ['add','sub'] and len(ops)==3:
            dest=reg(ins,ops[0].reg);base=registers.get(reg(ins,ops[1].reg))
            if base and base[0]=='pointer' and ops[2].type==2:
                registers[dest]=('pointer',base[1]+ops[2].imm*(1 if name=='add' else -1))
            else:registers.pop(dest,None)
        elif name in ['ldr','ldrb','ldrsb','ldrh','ldur','ldurb','ldurh','ldrsw']:
            dest=reg(ins,ops[0].reg);mem=ops[1].mem;base=registers.get(reg(ins,mem.base))
            if base and base[0]=='pointer' and not mem.index:registers[dest]=('field',base[1]+mem.disp)
            else:registers.pop(dest,None)
        elif name in ['stp','str','ldp']:
            # Save/restore of the native frame; field serializers do not depend on restored values.
            if name=='ldp':
                for op in ops[:2]:registers.pop(reg(ins,op.reg),None)
        elif name=='nop':pass
        else:return None,'control flow/transform '+name+' at '+hex(ins.address)
    return None,'function exceeded extraction limit'
registry=json.load(open(root/'registry.json'))
for r in registry:
    r['fields'],r['unsupported_reason']=derive(int(r['encode'],16))
    if r['id'] == 28991:
        r['fields'] = None
        r['unsupported_reason'] = 'Deferred embedded stream: 0x540850 -> 0x2e66ac/0x23fc3c; GameMode snapshot unresolved'
    r['codec_status']='flat' if r['fields'] is not None else 'unresolved'
(root/'schemas.json').write_text(json.dumps(registry,indent=2))
flat=[r for r in registry if r['fields'] is not None]
print('Flat schemas:',len(flat),'nonempty:',len([r for r in flat if r['fields']]))
for r in flat:
    print(r['id'],','.join(f.get('field',str(f.get('constant')))+':'+f['type'] for f in r['fields']))

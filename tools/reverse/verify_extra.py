import struct,json
from native_vm import NativeVM,ROOT
from verify_schemas import prepare
from unicorn.arm64_const import UC_ARM64_REG_SP

extra=json.load(open(ROOT/'extra-schemas.json'));registry=json.load(open(ROOT/'registry.json'));vm=NativeVM(trace_instructions=False);fixtures=[];unexpected=[]
for id,fields in extra.items():
    if id=='20758':
        next(f for f in fields if f['field']=='field_0x140')['invert']=True
    entry=next(r for r in registry if r['id']==int(id) and r['encode']!='0x240230')
    for variant in [0,1]:
        vm.heap=0x10000000;vm.uc.reg_write(UC_ARM64_REG_SP,0x201f0000)
        try:
            o,b,expected,values=prepare(vm,fields,variant)
            version=4 if id in ['10101','20103'] else 1
            vm.uc.mem_write(o+8,struct.pack('<I',version))
            vm.call(int(entry['encode'],16),o,count=1000000)
            size=struct.unpack('<I',vm.uc.mem_read(o+0x24,4))[0];actual=bytes(vm.uc.mem_read(b,size))
            assert actual==expected,f'wire mismatch {actual.hex()} != {expected.hex()}'
            for k,v in values.items():
                if isinstance(v,bytes):values[k]={'hex':v.hex()}
            observation={'id':int(id),'version':version,'variant':variant,'fields':values,'payload':actual.hex()}
            target=vm.alloc(0x1000);s,b2=vm.stream(actual);vm.uc.mem_write(target+0x10,bytes(vm.uc.mem_read(s,0x70)));vm.uc.mem_write(target+8,struct.pack('<I',version))
            vm.call(int(entry['decode'],16),target,count=200000000 if id=='10101' else 2000000)
            consumed=struct.unpack('<I',vm.uc.mem_read(target+0x24,4))[0]
            assert consumed==size,f'consumed {consumed}/{size}'
            vm.uc.mem_write(target+0x24,bytes(4))
            vm.uc.mem_write(target+0x2c,bytes(4))
            vm.call(int(entry['encode'],16),target,count=1000000)
            roundtrip_size=struct.unpack('<I',vm.uc.mem_read(target+0x24,4))[0]
            assert roundtrip_size==size and bytes(vm.uc.mem_read(b2,roundtrip_size))==actual,'native re-encode differs from the decoded input'
            print(id,variant,'PASS',size)
            fixtures.append({**observation,'native_decode_consumed':consumed,'native_reencode_equal':True})
        except Exception as e:
            unexpected.append({'id':id,'variant':variant,'error':str(e)})
            print(id,variant,'FAIL',e)
(ROOT/'native-extra.json').write_text(json.dumps(fixtures,indent=2))
if unexpected:raise SystemExit(1)

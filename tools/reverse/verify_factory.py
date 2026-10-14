import struct,json
from native_vm import NativeVM,ROOT
from unicorn.arm64_const import UC_ARM64_REG_SP
registry=json.load(open(ROOT/'registry.json'));ids=sorted(set(r['id'] for r in registry));records=[]
vm=NativeVM()
for id in ids:
    for variant in [0,1]:
        vm.heap=0x10000000;vm.uc.reg_write(UC_ARM64_REG_SP,0x201f0000)
        factory=vm.alloc(16);vm.uc.mem_write(factory+8,bytes([variant]))
        record={'id':id,'factory_flag':variant}
        try:
            ptr=vm.call(0x622544,factory,id,count=200000)
            if ptr:
                vtable,version=struct.unpack('<QI',vm.uc.mem_read(ptr,12));record.update(vtable=hex(vtable),version=version)
            else:record['status']='not-created'
        except Exception as e:record.update(status='unresolved',error=str(e))
        records.append(record)
(ROOT/'factory-observations.json').write_text(json.dumps(records,indent=2))
print('Created',sum('vtable' in r for r in records),'unresolved',sum(r.get('status')=='unresolved' for r in records))

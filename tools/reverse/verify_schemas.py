import struct,json
from native_vm import NativeVM,ROOT
from unicorn.arm64_const import UC_ARM64_REG_SP

def vint(value):
    magnitude=abs(value)
    length=next((n+1 for n,b in enumerate([6,13,20,27,32]) if magnitude < (1<<b)),5)
    b=bytearray([(value&63)|(64 if value<0 else 0)|(128 if length>1 else 0)])
    for n in range(1,length):
        b.append(((value>>(6+(n-1)*7))&(15 if n==4 else 127))|(128 if n<length-1 else 0))
    return bytes(b)

def prepare(vm,fields,variant):
    o=vm.alloc(0x1000);s,b=vm.stream();vm.uc.mem_write(o+0x10,bytes(vm.uc.mem_read(s,0x70)))
    expected=bytearray();bits=0;bit_pos=None;values={}
    for f in fields:
        off=int(f.get('object_offset','0'),16);typ=f['type'];direct=f.get('storage')=='pointer'
        value=f.get('constant')
        if value is None:
            value={'vint':-8192 if variant else 12345,'int':-123456 if variant else 345678,'long':[7,-234567], 'string':None if variant and not direct else 'protocol-check','bool':bool(variant),'strings':None if variant else ['item1','item2'],'bytes':None if variant else b'blob','dataReference':[0,0]}[typ]
        values[f.get('field','constant')]=value
        if 'constant' not in f:
            if typ in ['vint','int']:vm.uc.mem_write(o+off,struct.pack('<i',value))
            elif typ=='bool':vm.uc.mem_write(o+off,bytes([int(not value if f.get('invert') else value)]))
            elif typ=='long':
                ptr=o+off if direct else vm.alloc(8)
                vm.uc.mem_write(ptr,struct.pack('<ii',*value))
                if not direct:vm.uc.mem_write(o+off,struct.pack('<Q',ptr))
            elif typ=='dataReference':vm.uc.mem_write(o+off,bytes(8))
            elif typ=='bytes':
                ptr=0
                if value is not None:
                    ptr=vm.alloc(16);data=vm.alloc(len(value));vm.uc.mem_write(data,value);vm.uc.mem_write(ptr,struct.pack('<IIQ',len(value),0,data))
                vm.uc.mem_write(o+off,struct.pack('<Q',ptr))
            elif typ=='strings':
                ptr=0
                if value is not None:
                    ptr=vm.alloc(16);data=vm.alloc(8*len(value));vm.uc.mem_write(ptr,struct.pack('<QII',data,len(value),len(value)))
                    for n,item in enumerate(value):
                        text=item.encode()+b'\0';p=vm.alloc(len(text));vm.uc.mem_write(p,text);st=vm.alloc(24);vm.call(0x65612c,st,p);vm.uc.mem_write(data+n*8,struct.pack('<Q',st))
                vm.uc.mem_write(o+off,struct.pack('<Q',ptr))
            elif typ=='string':
                ptr=o+off if direct else (vm.alloc(24) if value is not None else 0)
                if value is not None:
                    text=value.encode()+b'\0';p=vm.alloc(len(text));vm.uc.mem_write(p,text);vm.call(0x65612c,ptr,p)
                if not direct:vm.uc.mem_write(o+off,struct.pack('<Q',ptr))
        if typ=='bool':
            if bits==0:bit_pos=len(expected);expected.append(0)
            expected[bit_pos]|=int(value)<<bits;bits=(bits+1)%8
        else:
            bits=0
            if typ=='vint':expected+=vint(value)
            elif typ=='int':expected+=struct.pack('>i',value)
            elif typ=='long':expected+=struct.pack('>ii',*value)
            elif typ=='string':expected+=struct.pack('>i',-1) if value is None else struct.pack('>i',len(value.encode()))+value.encode()
            elif typ=='dataReference':expected+=vint(value[0])+(vint(value[1]) if value[0] else b'')
            elif typ=='bytes':expected+=struct.pack('>i',-1) if value is None else struct.pack('>i',len(value))+value
            elif typ=='strings':expected+=vint(-1) if value is None else vint(len(value))+b''.join(struct.pack('>i',len(x.encode()))+x.encode() for x in value)
    return o,b,bytes(expected),values

if __name__=='__main__':
    registry=json.load(open(ROOT/'schemas.json'));vm=NativeVM();fixtures=[];failures=[]
    for r in registry:
        if r['fields'] is None:continue
        for variant in [0,1]:
            try:
                vm.heap=0x10000000
                vm.uc.reg_write(UC_ARM64_REG_SP,0x201f0000)
                o,b,expected,values=prepare(vm,r['fields'],variant)
                vm.call(int(r['encode'],16),o,count=100000)
                length=struct.unpack('<I',vm.uc.mem_read(o+0x24,4))[0]
                actual=bytes(vm.uc.mem_read(b,length))
                assert actual==expected,f'wire mismatch {actual.hex()} != {expected.hex()}'
                fixture={'id':r['id'],'vtable':r['vtable'],'variant':variant,'fields':values,'payload':actual.hex()}
                # Run native decoder and check exact consumption. A codec-only observation does not prove game semantics.
                obj=vm.alloc(0x1000);s2,b2=vm.stream(actual);vm.uc.mem_write(obj+0x10,bytes(vm.uc.mem_read(s2,0x70)))
                vm.call(int(r['decode'],16),obj,count=200000)
                consumed=struct.unpack('<I',vm.uc.mem_read(obj+0x24,4))[0]
                assert consumed==length,f'decoder consumed {consumed} of {length}'
                fixture['native_decode_consumed']=consumed
                fixtures.append(fixture)
            except Exception as e:failures.append({'id':r['id'],'vtable':r['vtable'],'variant':variant,'error':str(e)})
    (ROOT/'native-fixtures.json').write_text(json.dumps(fixtures,indent=2))
    (ROOT/'native-failures.json').write_text(json.dumps(failures,indent=2))
    print('Native encode + decode fixtures passed:',len(fixtures),'failed:',len(failures))
    for f in failures:print(f['id'],f['error'][:230])

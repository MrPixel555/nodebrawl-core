import json
from native_vm import NativeVM,ROOT

vm=NativeVM(trace_instructions=False)
vectors=[]
for number,size in enumerate([0,1,15,16,17,31,32,33,63,64,65,257]):
    vm.heap=0x10000000
    key=bytes((n*11+number*3)&255 for n in range(32))
    nonce=bytes((n*7+number)&255 for n in range(24))
    message=bytes((n*13+number)&255 for n in range(size))
    k=vm.alloc(32);vm.uc.mem_write(k,key)
    n=vm.alloc(24);vm.uc.mem_write(n,nonce)
    m=vm.alloc(size+32);vm.uc.mem_write(m,bytes(32)+message)
    output=vm.alloc(size+32)
    result=vm.call(0x36bc7c,output,m,size+32,n,k,count=10000000)
    assert result==0,'native encryption returned an error'
    padded=bytes(vm.uc.mem_read(output,size+32))
    assert padded[:16]==bytes(16)
    plain=vm.alloc(size+32)
    decrypted=vm.call(0x1f8f08,plain,output,size+32,n,k,16,count=10000000)
    assert decrypted==0,'native decryption rejected its own authenticated ciphertext'
    assert bytes(vm.uc.mem_read(plain+32,size))==message,'native decryption changed plaintext'
    corrupted=bytearray(padded);corrupted[16]^=1;vm.uc.mem_write(output,bytes(corrupted))
    rejected=vm.call(0x1f8f08,plain,output,size+32,n,k,16,count=10000000)
    assert rejected!=0,'native decryption accepted a corrupt MAC'
    vectors.append({'key':key.hex(),'nonce':nonce.hex(),'plaintext':message.hex(),'box':padded[16:].hex(),'nativeFunction':'0x36bc7c','nativeOpenFunction':'0x1f8f08','nativeRoundtripEqual':True,'nativeCorruptMacRejected':True})
(ROOT/'native-salsa17-box.json').write_text(json.dumps(vectors,indent=2))
print('Native authenticated cipher vectors:',len(vectors))

# This native wrapper takes a private scalar and uses a fixed peer coordinate.
# The coordinate below was read from its initialized field elements with the
# emulator's BSS globals zero. It is not a claim about a real Android runtime.
peer='d33c93779ee51583730e78e83c2e5f90bc5cfc28319bd69af82226b8bb347c65'
boxes=[]
for number,size in enumerate([0,31,64,257]):
    vm.heap=0x10000000
    secret=bytes((n*5+number*11+7)&255 for n in range(32))
    nonce=bytes((n*13+number)&255 for n in range(24))
    message=bytes((n*3+number)&255 for n in range(size))
    private=vm.alloc(32);vm.uc.mem_write(private,secret)
    n=vm.alloc(24);vm.uc.mem_write(n,nonce)
    padded=vm.alloc(size+32);vm.uc.mem_write(padded,bytes(32)+message)
    output=vm.alloc(size+32)
    result=vm.call(0x6957e8,output,padded,size+32,n,private,count=30000000)
    assert result==0,'native key-agreement box returned an error'
    boxes.append({'privateKey':secret.hex(),'peerPublicKey':peer,'nonce':nonce.hex(),'plaintext':message.hex(),'box':bytes(vm.uc.mem_read(output+16,size+16)).hex(),'nativeFunction':'0x6957e8','runtimeState':'zero-initialized BSS in emulator'})
(ROOT/'native-curve-boxes.json').write_text(json.dumps(boxes,indent=2))
print('Native key-agreement box vectors:',len(boxes))

"""Compare Node text chat/clan mail with original nonempty stream codecs."""
import json, subprocess
from pathlib import Path
from native_csv import NativeCsv
from native_vm import ROOT
from starter_home import qword, word

REPO = Path(__file__).resolve().parents[2]
def main():
    js = """
const {encodeMessage}=require('./lib/protocol/messages');
const chat={id:[0,7],sender:[0,37],name:'بازیکن',role:2,level:1,text:'سلام clan',age:0};
const mail={id:[0,8],sender:[0,37],name:'Leader',role:2,clanId:[0,3],badge:[16,0],subject:'News',text:'Welcome to clan',age:0};
console.log(JSON.stringify([{id:21749,entry:chat},{id:21822,entries:[chat]},{id:28299,entries:[mail]}].map(c=>({...c,payloadHex:encodeMessage(c.id,c).toString('hex')}))));
"""
    cases=json.loads(subprocess.check_output(['node','-e',js],cwd=REPO))
    model=NativeCsv();model.restore(ROOT/'native-csv-linked-state');vm=model.vm
    from native_strings import initialize_strings
    initialize_strings(vm)
    for case in cases:
        encoder,decoder={21749:(0x1f2524,0x653558),21822:(0x675a0c,0x2ef6b8),28299:(0x2ebe8c,0x2326c8)}[case['id']]
        wire=bytes.fromhex(case['payloadHex']);msg=vm.alloc(0x1000)
        inp,buf=vm.stream(wire);vm.uc.mem_write(msg+0x10,bytes(vm.uc.mem_read(inp,0x70)))
        vm.call(decoder,msg,count=1000000)
        assert model.integer(msg+0x24)==len(wire),(case['id'],model.integer(msg+0x24),len(wire))
        if case['id']==21749:entry=qword(vm,msg+0x80)
        else:entry=qword(vm,qword(vm,qword(vm,msg+0x80)))
        if case['id']==28299:
            assert model.read_string(qword(vm,entry+0x18))=='Leader'
            assert model.read_string(qword(vm,entry+0x38))=='Welcome to clan'
            assert model.read_string(qword(vm,entry+0x58))=='News'
        else:
            assert model.read_string(qword(vm,entry+0x20))=='بازیکن'
            assert model.read_string(qword(vm,entry+0x48))=='سلام clan'
        word(vm,msg+0x24,0);word(vm,msg+0x2c,0)
        vm.call(encoder,msg,count=1000000)
        assert model.integer(msg+0x24)==len(wire)
        assert bytes(vm.uc.mem_read(buf,len(wire)))==wire
        case.update(nativeDecodeConsumed=len(wire),nativeReencodeEqual=True)
    (REPO/'test/fixtures/native-social-stream.json').write_text(json.dumps(cases,indent=2,ensure_ascii=False)+'\n')
    print('Three nonempty native social stream codecs PASS')
if __name__=='__main__':main()

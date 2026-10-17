"""Add serializer-observed Home/Profile progression bindings without offset guesses."""
import json, subprocess
from pathlib import Path
from native_csv import NativeCsv
from native_vm import ROOT
from starter_home import qword
from unicorn.arm64_const import UC_ARM64_REG_LR
REPO=Path(__file__).resolve().parents[2]

def main():
    js=r"""
const fs=require('node:fs'),Module=require('node:module');
const filename=require.resolve('./server/home');let source=fs.readFileSync(filename,'utf8');
source=source.replace('for (const part of parts) {','for (const part of parts) { const start=writer.toBuffer().length;');
source=source.replace("else throw new Error('Invalid starter Home binding')", "else throw new Error('Invalid starter Home binding'); global.__parts.push({part:part.buffer?{hex:part.buffer.toString('hex')}:part,start,end:writer.toBuffer().length})");
const m=new Module(filename,module);m.filename=filename;m.paths=module.paths;m._compile(source,filename);
(async()=>{let cases=[];for(const unlocked of [false,true])for(const profile of [false,true]){global.__parts=[];const result=await(profile?m.exports.createStarterProfileProvider({unlocked}):m.exports.createStarterHomeProvider({unlocked}))({id:[0,37],name:'Player'});cases.push({name:(unlocked?'unlocked':'starter')+(profile?'-profile':'-home'),profile,parts:global.__parts,payloadHex:result.payload.toString('hex')})}console.log(JSON.stringify(cases))})().catch(e=>{console.error(e);process.exitCode=1})
"""
    cases=json.loads(subprocess.check_output(['node','-e',js],cwd=REPO))
    model=NativeCsv();model.restore(ROOT/'native-csv-linked-state');vm=model.vm
    observed=[];stream=None;group_start=None
    names={0x71df04:'trophies',0x71e37c:'battles',0x71e3b8:'wins',0x71e3cc:'losses'}
    def vint(machine):
        nonlocal group_start
        if stream is None or machine.reg(0)!=stream:return
        lr=machine.uc.reg_read(UC_ARM64_REG_LR);at=model.integer(stream+0x14)
        if lr in names:observed.append({'start':at,'end':at+1,'part':{'field':names[lr],'type':'vint'}})
        if lr==0x71e128:
            if machine.reg(25)==4:group_start=at
            if machine.reg(25)==5:
                observed.append({'start':group_start,'end':at,'part':{'field':'profileStatistics','type':'nativeStatistics'}})
    vm.register_hook(0x45d234,vint)
    for case in cases:
        wire=bytes.fromhex(case['payloadHex']);msg=vm.alloc(0x1000);inp,buf=vm.stream(wire)
        vm.uc.mem_write(msg+0x10,bytes(vm.uc.mem_read(inp,0x70)))
        vm.call(0x11c3bc if case['profile'] else 0x154440,msg,count=10000000)
        assert model.integer(msg+0x24)==len(wire)
        observed.clear();stream=msg+0x10
        if not case['profile']:
            def emote_start(machine):
                if machine.reg(1)==stream and not (observed and observed[-1]['end'] is None):observed.append({'start':model.integer(stream+0x14),'end':None,'part':{'field':'emotes','type':'nativeEmotes'}})
            def emote_end(machine):
                if observed and observed[-1]['part']['field']=='emotes' and observed[-1]['end'] is None:observed[-1]['end']=model.integer(stream+0x14)
            vm.register_hook(0x197c34,emote_start);vm.register_hook(0x34d248,emote_end)
        vm.uc.mem_write(msg+0x24,bytes(4));vm.uc.mem_write(msg+0x2c,bytes(4))
        vm.call(0x37e848 if case['profile'] else 0x4bce90,msg,count=10000000)
        stream=None
        assert bytes(vm.uc.mem_read(buf,len(wire)))==wire
        assert len(observed)==(5 if case['profile'] else 6),observed
        parts=[]
        for original in case['parts']:
            start,end=original['start'],original['end'];part=original['part']
            cuts=sorted([cut for cut in observed if start<=cut['start'] and cut['end']<=end],key=lambda c:c['start'])
            if cuts:
                assert 'hex'in part or (len(cuts)==1 and part==cuts[0]['part'])
                cursor=start
                for cut in cuts:
                    if cursor<cut['start']:parts.append({'hex':wire[cursor:cut['start']].hex()})
                    parts.append(cut['part']);cursor=cut['end']
                if cursor<end:parts.append({'hex':wire[cursor:end].hex()})
            else:parts.append(part)
        assert sum(1 for p in parts if p.get('field') in ['trophies','battles','wins','losses','profileStatistics','emotes'])==len(observed)
        path=REPO/'server/data'/f"{case['name']}.json";data=json.loads(path.read_text());data['parts']=parts;path.write_text(json.dumps(data,indent=2)+'\n')
        print(case['name'],[(o['part']['field'],o['start'],o['end']) for o in observed])
if __name__=='__main__':main()

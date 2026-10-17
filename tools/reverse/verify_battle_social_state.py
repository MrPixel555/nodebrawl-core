"""Verify progression fields, Party availability and actual emote exports natively."""
import hashlib,json,lzma,struct,subprocess
from pathlib import Path
from native_csv import NativeCsv
from native_strings import initialize_strings
from native_vm import ROOT
from starter_home import qword,word
from verify_home import decode,encode
REPO=Path(__file__).resolve().parents[2]
def main():
    js="""
const {createStarterHomeProvider,createStarterProfileProvider}=require('./server/home');
const {definitions,encodeEmotes}=require('./server/emotes');const {encodeCommand}=require('./lib/protocol/commands');
(async()=>{const account={id:[0,37],name:'Player',starter:{selectedDeck:0,trophies:137,bestTrophies:199,battles:13,wins:7,losses:4,threeCrownWins:3,passCrowns:17}};
const home=await createStarterHomeProvider({party:true})(account),profile=await createStarterProfileProvider()(account);
console.log(JSON.stringify({account,home:home.payload.toString('hex'),profile:profile.payload.toString('hex'),emotes:encodeEmotes().toString('hex'),definitions,command:encodeCommand({id:912,fields:{field_0x20:definitions[0],field_0x28:3}}).toString('hex')}))})().catch(e=>{console.error(e);process.exitCode=1});
"""
    case=json.loads(subprocess.check_output(['node','-e',js],cwd=REPO))
    m=NativeCsv();m.restore(ROOT/'native-csv-linked-state');v=m.vm;initialize_strings(v)
    for public in (False,True):
        payload=bytes.fromhex(case['profile' if public else 'home'])
        if public:
            msg=v.alloc(0x1000);inp,buf=v.stream(payload);v.uc.mem_write(msg+0x10,bytes(v.uc.mem_read(inp,0x70)));v.call(0x11c3bc,msg,count=10000000)
            assert m.integer(msg+0x24)==len(payload);avatar=qword(v,msg+0x90)
            word(v,msg+0x24,0);word(v,msg+0x2c,0);v.call(0x37e848,msg,count=10000000)
            assert bytes(v.uc.mem_read(buf,len(payload)))==payload
        else:
            msg,buf,consumed,_=decode(v,payload);assert consumed==len(payload) and encode(v,msg,buf)==payload
            avatar=qword(v,msg+0x88);home=qword(v,msg+0x80)
        assert [m.integer(avatar+a) for a in (0x78,0x12c,0x138,0x13c)]==[137,13,7,4]
        assert v.call(0x2c220c,avatar)==199
        # These are the exact original Profile getters for wins/losses/total.
        assert [v.call(fn,avatar) for fn in (0x3dfacc,0x5fc250,0x3bfff4)]==[7,4,13]
    manager=qword(v,home+0x4f8);catalogue=qword(v,manager+0x10);events=qword(v,catalogue+8)
    # Bind the original HomeLogic environment, with its initial zero clock.
    env=v.alloc(0x30);logic=v.alloc(0x300);v.uc.mem_write(manager+8,struct.pack('<Q',env));v.uc.mem_write(env+0x10,struct.pack('<Q',logic))
    availability=[]
    for i in range(2):
        event=qword(v,events+8*i)
        assert v.call(0x6de484,manager,event,1)==1
        word(v,event+0x2c,1600000000)
        assert v.call(0x6de484,manager,event,1)==0
        word(v,event+0x2c,0)
        availability.append(True)
    assert v.call(0x551634,home)!=0
    em=qword(v,home+0x640)
    assert m.integer(em+0x14)==2 and m.integer(em+0x44)==2
    for i,entry in enumerate(case['definitions']):
        desc=qword(v,qword(v,em+8)+8*i)
        assert list(struct.unpack('<ii',v.uc.mem_read(desc,8)))==entry['id']
        assert v.call(0x6295c8,em,desc)==1
        assert qword(v,qword(v,em+0x48+8*i))!=0
        asset=(REPO/'content/assets/sc'/entry['file']).read_bytes()
        header=10+int.from_bytes(asset[6:10],'big');raw=lzma.decompress(asset[header:header+9]+bytes(4)+asset[header+9:])
        assert hashlib.md5(raw).hexdigest()==entry['checksum']==asset[10:26].hex()
        count=struct.unpack_from('<H',raw,17)[0];at=19+count*2;names=[]
        for _ in range(count):n=raw[at];at+=1;names.append(raw[at:at+n].decode());at+=n
        assert 'emote1'in names
        assert m.read_string(desc+0x50)==entry['file']
    wire=bytes.fromhex(case['command']);cmd=v.call(0x41a1dc,912);inp,_=v.stream(wire[2:])
    # Command 912 has two VInt identifier bytes; original codec excludes ID.
    assert wire[:2]==bytes([0x90,0x0e])
    v.call(0x57bc98,cmd,inp);assert m.integer(inp+0x14)==len(wire)-2
    out,buf=v.stream();v.call(0x379e24,cmd,out)
    assert bytes(v.uc.mem_read(buf,m.integer(out+0x14)))==wire[2:]
    (REPO/'test/fixtures/native-emote-command.json').write_text(json.dumps({'id':912,'fields':{'field_0x10':0,'field_0xc':0,'field_0x14':[0,0],'field_0x20':case['definitions'][0],'field_0x28':3},'payloadHex':case['command'],'nativeDecodeConsumed':len(wire),'nativeReencodeEqual':True},indent=2)+'\n')
    report={'librarySha256':hashlib.sha256((ROOT/'libg.so').read_bytes()).hexdigest(),'profileGetters':{'score':137,'best':199,'battles':13,'wins':7,'losses':4},'partyAvailableAtInitialHomeClock':availability,'oldEventStartExcluded':True,'emoteDefinitions':case['definitions'],'emoteDefinitionsOwnedAndSelected':True,'emoteExportsVerified':True,'emoteSelectionCommandNativeRoundTrip':True,'androidUiVerified':False}
    (REPO/'docs/native-battle-social-state.json').write_text(json.dumps(report,indent=2)+'\n')
    print('Native Home/Profile stats, Party time filter, two owned SC exports and emote selection codec PASS')
if __name__=='__main__':main()

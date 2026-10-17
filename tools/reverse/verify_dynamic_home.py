"""Verify current Node Party/clan Home and Profile outputs in native codecs."""
import hashlib
import json
import subprocess
from pathlib import Path

from native_vm import ROOT
from starter_home import qword, word
from native_csv import NativeCsv
from verify_home import decode, encode, read_u32

REPOSITORY = Path(__file__).resolve().parents[2]


def main():
    script = """
const {createStarterHomeProvider,createStarterProfileProvider}=require('./server/home');
(async()=>{const out=[];for(const unlocked of [false,true])for(const clan of [false,true]){
 const account={id:[0,37],name:'بازیکن'};
 if(clan)account.alliance={id:[0,37],name:'قبیله',badge:[16,0],role:2,level:0};
 for(const id of [21217,22757]){
 const result=await(id===21217?createStarterHomeProvider({unlocked,party:true,emotes:false}):createStarterProfileProvider({unlocked}))(account);
 out.push({id,unlocked,account,payloadHex:result.payload.toString('hex')});
 }}process.stdout.write(JSON.stringify(out));})().catch(e=>{console.error(e);process.exitCode=1});
"""
    cases = json.loads(subprocess.check_output(['node', '-e', script], cwd=REPOSITORY))
    model = NativeCsv()
    model.restore(ROOT / 'native-csv-linked-state')
    vm = model.vm
    for case in cases:
        payload = bytes.fromhex(case['payloadHex'])
        if case['id'] == 21217:
            msg, buffer, consumed, _ = decode(vm, payload)
            assert consumed == len(payload) and encode(vm, msg, buffer) == payload
            avatar, home = qword(vm, msg + 0x88), qword(vm, msg + 0x80)
            catalogue = qword(vm, qword(vm, home + 0x4f8) + 0x10)
            assert read_u32(vm, catalogue) == 1 and read_u32(vm, catalogue + 0x14) == 2
        else:
            msg = vm.alloc(0x1000)
            source, buffer = vm.stream(payload)
            vm.uc.mem_write(msg + 0x10, bytes(vm.uc.mem_read(source, 0x70)))
            vm.call(0x11c3bc, msg, count=10000000)
            assert read_u32(vm, msg + 0x24) == len(payload)
            avatar = qword(vm, msg + 0x90)
            word(vm, msg + 0x24, 0)
            word(vm, msg + 0x2c, 0)
            vm.call(0x37e848, msg, count=10000000)
            assert read_u32(vm, msg + 0x24) == len(payload)
            assert bytes(vm.uc.mem_read(buffer, len(payload))) == payload
        clan = case['account'].get('alliance')
        assert bool(qword(vm, avatar + 0xf8)) == bool(clan)
        if clan:
            assert read_u32(vm, avatar + 0x108) == 2
            assert read_u32(vm, avatar + 0x128) == 0
            assert read_u32(vm, qword(vm, avatar + 0x100) + 0x20) == 16000000
        case.update(nativeDecodeConsumed=len(payload), nativeReencodeEqual=True)
    (ROOT / 'native-dynamic-home-fixtures.json').write_text(json.dumps(cases, indent=2) + '\n')
    for name in ['alliance_badges', 'regions']:
        print(name, hashlib.sha256((ROOT / 'game-data-verified/csv_logic' / (name + '.csv')).read_bytes()).hexdigest())
    print('8 current Node Home/Profile outputs: native Party/clan decode and re-encode PASS')


if __name__ == '__main__':
    main()

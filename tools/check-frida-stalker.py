#!/usr/bin/env python3
"""Optional Linux x86-64 Frida test of the JNI-style native-frame bridge.

Requires Python frida and cc. Exercises table cloning, NativeCallback,
NativeFunction(traps='all'), runtime exclusion and scope exit; not Android/ARM64.
"""
from pathlib import Path
import platform
import subprocess
import tempfile
import time

import frida

assert platform.system() == 'Linux' and platform.machine() == 'x86_64', 'Linux x86-64 probe only'
foreign_source = '''
#include <stdint.h>
typedef unsigned char (*Frame)(void*,void*);
typedef struct {const char* name; const char* signature; Frame function;} Method;
static Frame registered;
__attribute__((noinline)) int RegisterNatives(void* env,void* type,const Method* methods,int count) {
  if(count!=1) return -1; registered=methods[0].function; return 0;
}
__attribute__((noinline)) unsigned char call_registered(void* env,void* object) {return registered(env,object);}
'''
source = '''
#include <stdio.h>
#include <string.h>
#include <unistd.h>
#include <stdint.h>
typedef unsigned char (*Frame)(void*,void*);
typedef struct {const char* name; const char* signature; Frame function;} Method;
extern int RegisterNatives(void*,void*,const Method*,int);
extern unsigned char call_registered(void*,void*);
__attribute__((noinline)) void interpreter_step(void) {__asm__ volatile("nop");}
__attribute__((noinline)) int compute(int value) { return value + 5; }
__attribute__((noinline)) unsigned char invoke(void* env,void* object) {
  if(env!=(void*)17 || object!=(void*)34) return 0;
  interpreter_step(); return compute(7);
}
int main(void) {
  puts("ready"); fflush(stdout); char c; if(read(0,&c,1)!=1) return 1;
  Method table={"update","()Z",invoke}, before=table;
  if(RegisterNatives(0,0,&table,1)) return 2;
  int first=call_registered((void*)17,(void*)34), outside=invoke((void*)17,(void*)34);
  int second=call_registered((void*)17,(void*)34), again=invoke((void*)17,(void*)34);
  printf("%d %d %d %d tableUnchanged=%d\\n",first,outside,second,again,memcmp(&table,&before,sizeof(table))==0);
  fflush(stdout); return 0;
}
'''
helper = (Path(__file__).parent / 'frida/stalker-probes.js').read_text()
frame = (Path(__file__).parent / 'frida/native-frame.js').read_text()
with tempfile.TemporaryDirectory(prefix='stalker-scope-') as directory:
    root = Path(directory)
    (root / 'foreign.c').write_text(foreign_source)
    (root / 'probe.c').write_text(source)
    subprocess.run(['cc', '-O0', '-shared', '-fPIC', '-o', str(root / 'libscope-art.so'), str(root / 'foreign.c')], check=True)
    subprocess.run(['cc', '-O0', '-rdynamic', '-o', str(root / 'probe'), str(root / 'probe.c'), '-L' + str(root), '-lscope-art', '-Wl,-rpath,' + str(root)], check=True)
    device = frida.get_local_device()
    output, events = [], []
    device.on('output', lambda pid, fd, data: output.append(data))
    pid = device.spawn([str(root / 'probe')], stdio='pipe')
    session = device.attach(pid)
    bundle = 'const probesModule=(()=>{const module={exports:{}};\n' + helper + ';return module.exports})();\n'
    bundle += 'const frameModule=(()=>{const module={exports:{}};\n' + frame + ';return module.exports})();\n'
    script = None
    try:
        device.resume(pid)
        deadline = time.monotonic() + 10
        while b'ready' not in b''.join(output) and time.monotonic() < deadline:
            time.sleep(.02)
        assert b'ready' in b''.join(output), 'Test startup failed'
        script = session.create_script(bundle + '''
const target=Process.getModuleByName('probe');
const foreign=Process.getModuleByName('libscope-art.so');
const symbol=(module,name)=>module.enumerateSymbols().find(symbol=>symbol.name===name).address;
const entry=symbol(target,'invoke');
let instruction=Instruction.parse(entry), call=null;
const compute=symbol(target,'compute');
for(let n=0;n<64;n++) {
  if(instruction.mnemonic==='call' && instruction.operands[0].type==='imm' && ptr(instruction.operands[0].value).equals(compute)) {call=instruction.address;break}
  instruction=Instruction.parse(instruction.next);
}
if(!call) throw new Error('Native call site not found');
const before=Array.from(new Uint8Array(entry.readByteArray(64)));
const probes=probesModule.createStalkerProbes([
  {address:call,callback(context) {context.rdi=ptr(100);send({probe:true})}},
  {address:symbol(target,'interpreter_step'),callback() {send({interpreterTraced:true})}},
]);
for(const module of Process.enumerateModules()) if(module.name!=='probe') Stalker.exclude({base:module.base,size:module.size});
// x86 exclusions apply to direct calls; ARM64 additionally handles JNI's BLR.
Stalker.exclude({base:symbol(target,'interpreter_step'),size:8});
const roots=[];
Interceptor.attach(symbol(foreign,'RegisterNatives'),{
  onEnter(args) {
    const callback=frameModule.createNativeFrame(entry,'uint8',['pointer','pointer'],{
      probes,shouldTrace:()=>true,onEnter(){send({scopeEnter:true})},onLeave(){send({scopeLeave:true,codeUnchanged:JSON.stringify(before)===JSON.stringify(Array.from(new Uint8Array(entry.readByteArray(64))))})},onError(error){throw error},
    });
    const copy=Memory.alloc(24);copy.writeByteArray(args[2].readByteArray(24));copy.add(16).writePointer(callback);
    roots.push({copy,callback});args[2]=copy;
  },
});
send({installed:true});
''')
        script.on('message', lambda message, data: events.append(message))
        script.load()
        device.input(pid, b'x')
        expected = b'105 12 105 12 tableUnchanged=1'
        deadline = time.monotonic() + 15
        while (expected not in b''.join(output) or sum(event.get('payload', {}).get('scopeLeave', False) for event in events) < 2) and time.monotonic() < deadline:
            time.sleep(.02)
        assert expected in b''.join(output), f'Native frame scope failed: {events}; output={output}'
        assert sum(event.get('payload', {}).get('probe', False) for event in events) == 2, events
        assert sum(event.get('payload', {}).get('scopeEnter', False) for event in events) == 2, events
        assert sum(event.get('payload', {}).get('scopeLeave', False) for event in events) == 2, events
        assert sum(event.get('payload', {}).get('codeUnchanged', False) for event in events) >= 2, events
        assert not any(event.get('payload', {}).get('interpreterTraced') for event in events), events
        assert not any(event['type'] == 'error' for event in events), events
        print(f'Frida {frida.__version__} Linux x86-64: JNI-style clone, two native scopes, argument override and excluded interpreter PASS')
    finally:
        try:
            device.kill(pid)
        except frida.ProcessNotFoundError:
            pass

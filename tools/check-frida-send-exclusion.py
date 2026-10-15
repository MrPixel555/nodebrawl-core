#!/usr/bin/env python3
"""Linux x86-64 check of an excluded socket writer inside a traced native frame.

Requires Python frida and cc. Not an Android/ARM64 send-stall reproduction.
"""
from pathlib import Path
import platform
import subprocess
import tempfile
import time
import frida

assert platform.system() == 'Linux' and platform.machine() == 'x86_64'
source = r'''
#include <stdio.h>
#include <unistd.h>
#include <pthread.h>
#include <sys/socket.h>
static pthread_mutex_t lock=PTHREAD_MUTEX_INITIALIZER;
__attribute__((noinline)) int marker(int value) {return value+5;}
__attribute__((noinline)) void before_send(void) {__asm__ volatile("nop");}
__attribute__((noinline)) void after_send(void) {__asm__ volatile("nop");}
__attribute__((noinline,aligned(4096))) int native_send(int fd) {
  pthread_mutex_lock(&lock); int n=marker(3); char ack=0;
  if(write(fd,"hello",5)!=5 || read(fd,&ack,1)!=1 || ack!='A') n=-100;
  pthread_mutex_unlock(&lock); return n;
}
__attribute__((noinline,aligned(4096))) int entry(int fd) {
  before_send(); int n=native_send(fd); after_send(); return n+marker(7);
}
typedef int(*Frame)(int);
extern int register_frame(Frame*);
extern int invoke_frame(int);
static void* receiver(void* argument) {
  int fd=*(int*)argument; char data[5]; int total=0;
  while(total<5) {int n=read(fd,data+total,5-total);if(n<=0)return 0;total+=n;}
  write(fd,"A",1); return 0;
}
int main(void) {
  puts("ready"); fflush(stdout); char c; if(read(0,&c,1)!=1)return 1;
  int pair[2]; if(socketpair(AF_UNIX,SOCK_STREAM,0,pair))return 2;
  pthread_t reader; pthread_create(&reader,0,receiver,&pair[1]);
  Frame table=entry,original=table; register_frame(&table);
  int result=invoke_frame(pair[0]); pthread_join(reader,0);
  printf("result=%d tableUnchanged=%d\n",result,table==original);fflush(stdout);
  read(0,&c,1);close(pair[0]);close(pair[1]);return 0;
}
'''
shim = '''typedef int(*Frame)(int);static Frame frame;
__attribute__((noinline)) int register_frame(Frame* table){frame=*table;return 0;}
__attribute__((noinline)) int invoke_frame(int fd){return frame(fd);}
'''
directory = Path(__file__).parent
bundle = ''
for name, file in [('probesModule', 'stalker-probes.js'), ('frameModule', 'native-frame.js')]:
    bundle += 'const ' + name + '=(()=>{const module={exports:{}};\n' + (directory / 'frida' / file).read_text() + ';return module.exports})();\n'
with tempfile.TemporaryDirectory(prefix='frida-send-exclusion-') as temporary:
    root = Path(temporary)
    (root / 'probe.c').write_text(source)
    (root / 'shim.c').write_text(shim)
    subprocess.run(['cc', '-O0', '-shared', '-fPIC', '-o', str(root / 'libscope.so'), str(root / 'shim.c')], check=True)
    subprocess.run(['cc', '-O0', '-rdynamic', '-pthread', '-o', str(root / 'probe'), str(root / 'probe.c'), '-L' + str(root), '-lscope', '-Wl,-rpath,' + str(root)], check=True)
    device = frida.get_local_device()
    output, events = [], []
    device.on('output', lambda pid, fd, data: output.append(data))
    pid = device.spawn([str(root / 'probe')], stdio='pipe')
    session = device.attach(pid)
    try:
        device.resume(pid)
        deadline = time.monotonic() + 10
        while b'ready' not in b''.join(output) and time.monotonic() < deadline:
            time.sleep(.02)
        assert b'ready' in b''.join(output)
        script = session.create_script(bundle + '''
const target=Process.getModuleByName('probe');
const shim=Process.getModuleByName('libscope.so');
const symbol=(module,name)=>module.enumerateSymbols().find(s=>s.name===name);
const entry=symbol(target,'entry'), writer=symbol(target,'native_send');
const before=Array.from(new Uint8Array(writer.address.readByteArray(writer.size)));
for(const module of Process.enumerateModules()) if(module.name!=='probe')Stalker.exclude({base:module.base,size:module.size});
Stalker.exclude({base:writer.address,size:writer.size});
let markers=0,entered=0,left=0;
const probes=probesModule.createStalkerProbes([
  {address:symbol(target,'marker').address,callback(context){markers++;context.rdi=ptr(100);}},
  {address:symbol(target,'before_send').address,callback(){entered++;}},
  {address:symbol(target,'after_send').address,callback(){left++;}},
]);
const roots=[];
Interceptor.attach(symbol(shim,'register_frame').address,{
  onEnter(args){
    const replacement=frameModule.createNativeFrame(entry.address,'int',['int'],{
      probes,shouldTrace:()=>true,onEnter(){},onLeave(){
        send({markers,entered,left,writerUnchanged:JSON.stringify(before)===JSON.stringify(Array.from(new Uint8Array(writer.address.readByteArray(writer.size))))});
      },onError(error){throw error;},
    });
    const copy=Memory.alloc(Process.pointerSize);copy.writePointer(replacement);roots.push({copy,replacement});args[0]=copy;
  },
});
send({installed:true});
''')
        script.on('message', lambda message, data: events.append(message))
        script.load()
        device.input(pid, b'x')
        deadline = time.monotonic() + 10
        while b'result=113 tableUnchanged=1' not in b''.join(output) and time.monotonic() < deadline:
            time.sleep(.02)
        assert b'result=113 tableUnchanged=1' in b''.join(output), (output, events)
        assert not any(e['type'] == 'error' for e in events), events
        assert any(e.get('payload') == {'markers': 1, 'entered': 1, 'left': 1, 'writerUnchanged': True} for e in events), events
        print(f'Frida {frida.__version__} Linux x86-64: excluded mutex/socket writer completed, nested probe omitted, caller tracing resumed, bytes/table unchanged PASS')
    finally:
        try:
            device.kill(pid)
        except frida.ProcessNotFoundError:
            pass

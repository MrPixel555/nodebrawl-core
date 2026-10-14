#!/usr/bin/env python3
"""Optional Linux x86-64 check of real pthread scopes, not Android/ARM64."""
from pathlib import Path
import platform
import subprocess
import tempfile
import time

import frida

assert platform.system() == 'Linux' and platform.machine() == 'x86_64'
source = r'''
#include <pthread.h>
#include <stdatomic.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
typedef struct Object { int role,result,after; } Object;
typedef struct Tuple {void* tls; void* (*member)(Object*); intptr_t adjustment; Object* instance;} Tuple;
static pthread_barrier_t barrier;
static atomic_int stopped;
__attribute__((noinline)) int compute(int value) {return value+5;}
__attribute__((noinline)) void finish_point(void) {__asm__ volatile("nop");}
__attribute__((noinline)) void* event_worker(Object* object) {
  object->result=compute(7);
  pthread_barrier_wait(&barrier);
  finish_point(); atomic_store(&stopped,1);
  object->after=compute(7); return (void*)111;
}
__attribute__((noinline)) void* send_worker(Object* object) {
  object->result=compute(7);
  pthread_barrier_wait(&barrier);
  while(!atomic_load(&stopped)) sched_yield();
  object->after=compute(7); return (void*)222;
}
__attribute__((noinline)) void* unrelated_worker(Object* object) {
  object->result=compute(7); return (void*)444;
}
__attribute__((noinline)) void* socket_worker(Object* object) {
  object->result=compute(7);
  pthread_barrier_wait(&barrier);
  while(!atomic_load(&stopped)) sched_yield();
  object->after=compute(7); return (void*)333;
}
__attribute__((noinline)) void* thread_start(void* argument) {
  Tuple* tuple=argument; Tuple before=*tuple;
  void* result=tuple->member(tuple->instance);
  if(memcmp(&before,tuple,sizeof(before))) _exit(9);
  free(tuple); return result;
}
__attribute__((noinline)) void* socket_start(void* argument) {return thread_start(argument);}
extern int start_thread(pthread_t*,const pthread_attr_t*,void*(*)(void*),void*);
int main(void) {
  puts("ready");fflush(stdout);char c;if(read(0,&c,1)!=1)return 1;
  pthread_barrier_init(&barrier,0,3);pthread_t threads[4];Object objects[4]={{0},{1},{2},{3}};
  void*(*members[4])(Object*)={event_worker,send_worker,socket_worker,unrelated_worker};
  for(int n=0;n<4;n++) {
    Tuple* tuple=calloc(1,sizeof(Tuple));tuple->member=members[n];tuple->instance=&objects[n];
    if(start_thread(&threads[n],0,n==2?socket_start:thread_start,tuple))return 2;
  }
  void* result[4];for(int n=0;n<4;n++)pthread_join(threads[n],&result[n]);
  printf("%d %d %d %d after=%d,%d,%d returns=%ld,%ld,%ld,%ld\n",objects[0].result,objects[1].result,objects[2].result,objects[3].result,
    objects[0].after,objects[1].after,objects[2].after,(long)result[0],(long)result[1],(long)result[2],(long)result[3]);fflush(stdout);
  return 0;
}
'''
shim = '#include <pthread.h>\nint start_thread(pthread_t* t,const pthread_attr_t* a,void*(*f)(void*),void* x){return pthread_create(t,a,f,x);}\n'
directory = Path(__file__).parent
bundle = ''
for name, file in [('probesModule', 'stalker-probes.js'), ('frameModule', 'native-frame.js')]:
    bundle += 'const ' + name + '=(()=>{const module={exports:{}};\n' + (directory / 'frida' / file).read_text() + ';return module.exports})();\n'
with tempfile.TemporaryDirectory(prefix='frida-workers-') as temporary:
    root = Path(temporary)
    (root / 'probe.c').write_text(source)
    (root / 'shim.c').write_text(shim)
    subprocess.run(['cc', '-O0', '-shared', '-fPIC', '-pthread', '-o', str(root / 'libthreadscope.so'), str(root / 'shim.c')], check=True)
    subprocess.run(['cc', '-O0', '-rdynamic', '-pthread', '-o', str(root / 'probe'), str(root / 'probe.c'), '-L' + str(root), '-lthreadscope', '-Wl,-rpath,' + str(root)], check=True)
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
        assert b'ready' in b''.join(output), output
        script = session.create_script(bundle + '''
const target=Process.getModuleByName('probe');
const shim=Process.getModuleByName('libthreadscope.so');
const symbol=(module,name)=>module.enumerateSymbols().find(symbol=>symbol.name===name).address;
const compute=symbol(target,'compute'), finish=symbol(target,'finish_point'), start=symbol(target,'thread_start');
const socketStart=symbol(target,'socket_start');
const members=['event_worker','send_worker','socket_worker'].map(name=>symbol(target,name));
const before=Array.from(new Uint8Array(start.readByteArray(64)));
let stopped=false;
const probes=probesModule.createStalkerProbes([
  {address:compute,callback(context){context.rdi=ptr(100);send({probe:Process.getCurrentThreadId()})}},
  {address:finish,callback(){probes.stop();stopped=true;send({stopped:true})}},
]);
for(const module of Process.enumerateModules()) if(module.name!=='probe') Stalker.exclude({base:module.base,size:module.size});
const roots=[];
Interceptor.attach(symbol(shim,'start_thread'),{
  onEnter(args){
    if((!args[2].equals(start)&&!args[2].equals(socketStart))||!members.some(member=>member.equals(args[3].add(8).readPointer())))return;
    const callback=frameModule.createNativeFrame(args[2],'pointer',['pointer'],{
      probes,shouldTrace:()=>true,
      onEnter(thread){send({scopeEnter:thread})},
      onLeave(thread){send({scopeLeave:thread,stopped,codeUnchanged:JSON.stringify(before)===JSON.stringify(Array.from(new Uint8Array(start.readByteArray(64))))})},
      onError(error){throw error},
    });
    roots.push(callback);args[2]=callback;
  },
});
send({installed:true});
''')
        script.on('message', lambda message, data: events.append(message))
        script.load()
        device.input(pid, b'x')
        expected = b'105 105 105 12 after=12,12,12 returns=111,222,333,444'
        deadline = time.monotonic() + 15
        while (expected not in b''.join(output) or sum(bool(event.get('payload', {}).get('scopeLeave')) for event in events) < 3) and time.monotonic() < deadline:
            time.sleep(.02)
        assert expected in b''.join(output), (events, output)
        payloads = [event.get('payload', {}) for event in events]
        for key in ['probe', 'scopeEnter', 'scopeLeave', 'codeUnchanged']:
            assert sum(bool(event.get(key)) for event in payloads) == 3, events
        assert len({event['probe'] for event in payloads if 'probe' in event}) == 3
        assert sum(bool(event.get('stopped')) for event in payloads) == 4, events
        assert not any(event['type'] == 'error' for event in events), events
        print(f'Frida {frida.__version__} Linux x86-64: three real pthread scopes, two start trampolines, argument overrides, cross-thread stop, unchanged tuples/code PASS')
    finally:
        try:
            device.kill(pid)
        except frida.ProcessNotFoundError:
            pass

#!/usr/bin/env python3
"""Optional Linux x86-64 smoke test for the actual Frida Stalker helper.

Requires the Python frida package and cc. This does not validate Android/ARM64.
"""
from pathlib import Path
import platform
import subprocess
import tempfile
import time

import frida

assert platform.system() == 'Linux' and platform.machine() == 'x86_64', 'Linux x86-64 probe only'
source = '''
#include <stdio.h>
#include <unistd.h>
__attribute__((noinline)) int compute(int value) { return value + 5; }
__attribute__((noinline)) int invoke(void) { return compute(7); }
int main(void) {
  puts("ready"); fflush(stdout); char c; if (read(0,&c,1)!=1) return 1;
  printf("%d\\n",invoke()); fflush(stdout); return 0;
}
'''
helper = (Path(__file__).parent / 'frida/stalker-probes.js').read_text()
with tempfile.TemporaryDirectory(prefix='stalker-test-') as directory:
    root = Path(directory)
    (root / 'probe.c').write_text(source)
    subprocess.run(['cc', '-O0', '-rdynamic', '-o', str(root / 'probe'), str(root / 'probe.c')], check=True)
    device = frida.get_local_device()
    output, events = [], []
    device.on('output', lambda pid, fd, data: output.append(data))
    pid = device.spawn([str(root / 'probe')], stdio='pipe')
    session = device.attach(pid)
    script = session.create_script('const module = {exports:{}};\n' + helper + '''
const target = Process.getModuleByName('probe');
const entry = target.enumerateSymbols().find(symbol => symbol.name === 'invoke').address;
let instruction = Instruction.parse(entry), call = null;
for (let n=0; n<32; n++) {
  if (instruction.mnemonic === 'call') {call=instruction.address; break}
  instruction = Instruction.parse(instruction.next);
}
if (!call) throw new Error('Call site not found');
const before = Array.from(new Uint8Array(entry.readByteArray(32)));
const probes = module.exports.createStalkerProbes([{address:call, callback(context) {
  context.rdi=ptr(100);
  send({argumentChanged:true, originalCodeUnchanged:JSON.stringify(before)===JSON.stringify(Array.from(new Uint8Array(entry.readByteArray(32))))});
}}]);
// Hook only the test process's input, never Frida's IPC or global output writes.
Interceptor.attach(Module.getGlobalExportByName('read'), {
  onEnter(args) {this.target=args[0].toInt32()===0},
  onLeave() {if(this.target) probes.follow(Process.getCurrentThreadId())},
});
''')
    script.on('message', lambda message, data: events.append(message))
    try:
        script.load()
        device.resume(pid)
        deadline = time.monotonic() + 10
        while b'ready' not in b''.join(output) and time.monotonic() < deadline:
            time.sleep(.02)
        assert b'ready' in b''.join(output), f'Test startup failed: {events}'
        device.input(pid, b'x')
        deadline = time.monotonic() + 10
        while b'105' not in b''.join(output) and time.monotonic() < deadline:
            time.sleep(.02)
        assert b'105' in b''.join(output), f'Argument override failed: {events}'
        assert any(event.get('payload') == {'argumentChanged': True, 'originalCodeUnchanged': True} for event in events)
        assert not any(event['type'] == 'error' for event in events), events
        print(f'Frida {frida.__version__} Linux x86-64: call-site argument override and unchanged original code PASS')
    finally:
        try:
            device.kill(pid)
        except frida.ProcessNotFoundError:
            pass

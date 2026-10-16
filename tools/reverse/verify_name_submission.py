"""Verify what the native final name submission callback actually queues.

The text widget and connected GameClient are explicit adapters. This does not
emulate dialog navigation, native name validation or Android button presses.
"""
import hashlib
import json
import struct

from native_vm import NativeVM, ROOT
from verify_home import read_u32


def main():
    vm = NativeVM(trace_instructions=False)
    vm.uc.mem_protect(0, 4096, 0)
    name = 'بازیکن'
    text = vm.alloc(len(name.encode()) + 1)
    vm.uc.mem_write(text, name.encode() + b'\0')
    string = vm.alloc(24)
    vm.call(0x65612c, string, text)
    widget, dialog, client = vm.alloc(8), vm.alloc(0x108), vm.alloc(8)
    vm.uc.mem_write(dialog + 0x100, struct.pack('<Q', widget))
    observed = []
    def widget_text(machine):
        assert machine.reg(0) == widget
        machine.ret(string)
    def enqueue(machine):
        assert machine.reg(0) == client and machine.reg(2) == 1
        observed.append(machine.reg(1))
        machine.ret(0)
    vm.register_hook(0x301ce8, widget_text)
    vm.register_hook(0x698448, lambda machine: machine.ret(client))
    vm.register_hook(0x6037ec, enqueue)
    vm.call(0x2b7f38, dialog)
    assert len(observed) == 1
    command = observed[0]
    assert struct.unpack('<Q', vm.uc.mem_read(command, 8))[0] == 0xa2f168
    stream, output = vm.stream()
    vm.call(0x2c0a60, stream, command)
    payload = bytes(vm.uc.mem_read(output, read_u32(vm, stream + 0x14)))
    # The constructor initializes the two tick fields to -1, Long to zero.
    # Queueing normally fills them later; the UTF-8 submission is already owned.
    assert payload == b'\xb4\x0e' + struct.pack('>i', len(name.encode())) + name.encode() + b'\x7f\x7f\0\0'
    report = {'librarySha256': hashlib.sha256((ROOT / 'libg.so').read_bytes()).hexdigest(),
              'submissionCallback': '0x2b7f38', 'commandConstructor': '0x2d457c',
              'nameSetter': '0x3cfe68', 'enqueue': '0x6037ec',
              'command': 948, 'commandCount': len(observed), 'utf8SubmissionVerified': True,
              'gameCodeAdapters': ['0x301ce8 text widget getter', '0x698448 GameClient getter',
                                   '0x6037ec queue capture'],
              'scope': 'Original submission callback/command construction/serialization; no Android dialog navigation, validation or network delivery verified.'}
    (ROOT / 'native-name-submission.json').write_text(json.dumps(report, indent=2) + '\n')
    print('Native final name callback queues one UTF-8 command 948, not 595 or request 11712: PASS')


if __name__ == '__main__':
    main()

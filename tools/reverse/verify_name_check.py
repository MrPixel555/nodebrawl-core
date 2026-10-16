"""Run the native naming preflight, codecs, dispatcher and success listener.

UI asset construction/window lookup and network enqueue are explicit adapters.
The original message routing and virtual listener call are not replaced.
"""
import hashlib
import json
import struct
from pathlib import Path

from native_vm import NativeVM, ROOT
from starter_home import qword, word
from verify_alliances import roundtrip
from verify_home import read_u32


def main():
    vm = NativeVM(trace_instructions=False)
    vm.uc.mem_protect(0, 4096, 0)
    name = 'بازیکن'
    text = vm.alloc(len(name.encode()) + 1)
    vm.uc.mem_write(text, name.encode() + b'\0')
    string = vm.alloc(24)
    vm.call(0x65612c, string, text)
    root, window, dialog = vm.alloc(0x200), vm.alloc(0x200), vm.alloc(0x148)
    widget, error_widget = vm.alloc(8), vm.alloc(8)
    manager, state = vm.alloc(0x200), vm.alloc(0x100)
    vm.uc.mem_write(0xd69a48, struct.pack('<Q', root))
    vm.uc.mem_write(0xd50650, struct.pack('<Q', manager))
    vm.uc.mem_write(0xd5d7a0, struct.pack('<Q', state))
    word(vm, state, 6)
    vm.uc.mem_write(dialog, struct.pack('<Q', 0xa2c1b0))
    vm.uc.mem_write(dialog + 0xf0, struct.pack('<Q', 0xa2c370))
    vm.uc.mem_write(dialog + 0xf8, struct.pack('<Q', widget))
    vm.uc.mem_write(dialog + 0x138, struct.pack('<Q', error_widget))
    stack = vm.alloc(8)
    vm.uc.mem_write(stack, struct.pack('<Q', dialog))
    vm.uc.mem_write(window + 0x100, struct.pack('<QQ', stack, stack + 8))
    queued, stages, pushes, errors = [], [], [], []

    def lookup_window(machine):
        assert machine.reg(0) == root
        machine.ret(window)

    def widget_text(machine):
        assert machine.reg(0) == widget
        machine.ret(string)

    def enqueue(machine):
        assert machine.reg(0) == manager
        queued.append(machine.reg(1))
        machine.ret(0)

    def construct_screen(machine):
        assert machine.reg(1) == 1 and machine.reg(2) == string
        stages.append(machine.reg(1))
        machine.ret(machine.reg(0))

    def push_screen(machine):
        assert machine.reg(0) == window
        pushes.append(machine.reg(1))
        machine.ret(0)

    def display_error(machine):
        assert machine.reg(0) == error_widget
        errors.append(machine.reg(1))
        machine.ret(0)

    vm.register_hook(0x5f5ae8, lookup_window)
    vm.register_hook(0x301ce8, widget_text)
    vm.register_hook(0x7158ec, enqueue)
    vm.register_hook(0x1a0728, construct_screen)
    vm.register_hook(0x2c3a64, push_screen)
    vm.register_hook(0x6aee80, lambda machine: machine.ret(machine.reg(0)))
    vm.register_hook(0x617184, display_error)

    # Original first-screen button submission builds the request, including
    # its real vtable/type, and owns a copy of the UTF-8 name.
    vm.call(0x4b4e44, dialog)
    assert len(queued) == 1
    request = queued[0]
    assert qword(vm, request) == 0xa3b5a8
    vm.call(qword(vm, 0xa3b5a8 + 0x28), request)
    assert vm.reg(0) == 16592
    stream, output = vm.stream()
    vm.uc.mem_write(request + 0x10, bytes(vm.uc.mem_read(stream, 0x70)))
    vm.call(0x5ac59c, request)
    payload = bytes(vm.uc.mem_read(output, read_u32(vm, request + 0x24)))
    assert payload == struct.pack('>i', len(name.encode())) + name.encode()
    fixtures = [roundtrip(vm, 16592, 0x5ac59c, 0x4c0af0,
                          {'field_0x80': name}, payload, 'candidate')]

    for rejected in (False, True, False):
        reason = 1 if rejected else 0
        fields = {'field_0x7c': rejected, 'field_0x80': reason, 'field_0x88': None}
        payload = bytes([int(rejected)]) + struct.pack('>ii', reason, -1)
        fixtures.append(roundtrip(vm, 20821, 0x3ceba0, 0x30b20c,
                                  fields, payload, 'rejected' if rejected else 'accepted'))
        message = vm.alloc(0x100)
        vm.uc.mem_write(message, struct.pack('<Q', 0xa69e38))
        stream, _ = vm.stream(payload)
        vm.uc.mem_write(message + 0x10, bytes(vm.uc.mem_read(stream, 0x70)))
        vm.call(0x30b20c, message)
        before = len(stages), len(errors)
        # Full native dispatcher -> native listener lookup -> native virtual
        # callback -> native screen transition (asset constructor captured).
        vm.call(0x71e538, manager, message, count=2000000)
        assert vm.reg(0) == 1
        assert len(stages) - before[0] == int(not rejected)
        assert len(errors) - before[1] == int(rejected)
        assert len(pushes) == len(stages)
    assert stages == [1, 1] and len(queued) == 1
    # The former 25074 reply takes the clan-manager branch and cannot invoke
    # the naming listener. Supply a disconnected GameClient lookup here.
    vm.register_hook(0x698448, lambda machine: machine.ret(0))
    old_message = vm.alloc(0x100)
    # Recover the real type's vtable from the checked-in factory catalogue.
    profile = json.loads((Path(__file__).resolve().parents[2] / 'lib/protocol/libg-profile.json').read_text())
    old_type = next(entry for entry in profile['messages'] if entry['id'] == 25074)
    vm.uc.mem_write(old_message, struct.pack('<Q', int(old_type['vtable'], 16)))
    vm.call(0x71e538, manager, old_message, count=2000000)
    assert stages == [1, 1] and len(errors) == 1
    report = {
        'librarySha256': hashlib.sha256((ROOT / 'libg.so').read_bytes()).hexdigest(),
        'request': 16592, 'response': 20821,
        'submission': '0x4b4e44', 'dispatcher': '0x71e538',
        'listenerLookup': ['0x22febc', '0x148784'],
        'successCallback': ['0x61e61c', '0x67494c'],
        'acceptedFlag': False, 'rejectedReason': 1,
        'acceptedTransitions': len(stages), 'rejectedTransitions': len(errors),
        'queuedRequests': len(queued), 'fixtures': fixtures,
        'former25074ReplyAdvancesNaming': False,
        'gameCodeAdapters': ['0x5f5ae8 window lookup', '0x301ce8 text widget getter',
                             '0x7158ec request enqueue capture', '0x1a0728 screen asset constructor',
                             '0x2c3a64 screen push capture', '0x6aee80 localization lookup',
                             '0x617184 error text display', '0x698448 disconnected GameClient for unrelated 25074 control'],
        'scope': 'Native preflight request, codecs, full response dispatch and confirmation-screen transition; no Android rendering, final command 948 or gameplay validation claimed.'
    }
    destination = ROOT / 'native-name-check.json'
    destination.write_text(json.dumps(report, indent=2) + '\n')
    print('Native naming preflight 16592 -> 20821 advances confirmation on false, displays error on true: PASS')


if __name__ == '__main__':
    main()

"""Run original cancel/result dispatcher branches with UI boundary adapters."""
import hashlib
import json
import struct

from native_vm import NativeVM, ROOT
from starter_home import qword, word


def main():
    vm = NativeVM(trace_instructions=False)
    vm.uc.mem_protect(0, 4096, 0)
    state = vm.alloc(32)
    word(vm, state, 6)
    vm.uc.mem_write(0xd5d7a0, struct.pack('<Q', state))
    root, home, popup, search, client = (vm.alloc(0x500) for _ in range(5))
    for address, pointer in [(0x365058, root), (0x1b2f00, home),
                             (0x4c27b8, popup), (0x684400, search),
                             (0x698448, client), (0x420b54, client)]:
        vm.register_hook(address, lambda machine, pointer=pointer: machine.ret(pointer))
    # The optional secondary search dialog is absent in this focused case.
    vm.register_hook(0x5a3828, lambda machine: machine.ret(0))
    vm.register_hook(0x1d5c58, lambda machine: machine.ret(0))
    observed = []

    def close_popup(machine):
        assert machine.reg(0) == popup
        observed.append('close-search-popup')
        machine.ret(0)

    def cancel_state(machine):
        assert machine.reg(0) == search
        assert [machine.reg(n) for n in (1, 2, 3)] == [0, 0, 0]
        observed.append('clear-search-state')
        machine.ret(0)

    def battle_result(machine):
        assert machine.reg(0) == client and machine.reg(1) == result
        observed.append('battle-result-consumer')
        machine.ret(0)

    vm.register_hook(0x739910, close_popup)
    vm.register_hook(0x3f1aa8, cancel_state)
    vm.register_hook(0x63c2ec, battle_result)
    cancel = vm.alloc(0x100)
    vm.uc.mem_write(cancel, struct.pack('<Q', 0xa4bda8))
    assert vm.call(qword(vm, 0xa4bda8 + 0x28), cancel) == 25382
    assert vm.call(0x71e538, vm.alloc(0x200), cancel, count=100000) == 1
    assert observed == ['close-search-popup', 'clear-search-state']
    result = vm.alloc(0x100)
    vm.call(0x608750, result)
    assert vm.call(qword(vm, qword(vm, result) + 0x28), result) == 22871
    assert vm.call(0x71e538, vm.alloc(0x200), result, count=100000) == 1
    assert observed[-1] == 'battle-result-consumer'
    report = {
        'librarySha256': hashlib.sha256((ROOT / 'libg.so').read_bytes()).hexdigest(),
        'cancel': {'message': 25382, 'dispatcherBranch': '0x71ebc0',
                   'popupCallback': '0x739910', 'stateCallback': '0x3f1aa8'},
        'result': {'message': 22871, 'dispatcherBranch': '0x71f85c',
                   'consumer': '0x63c2ec', 'hudConstructor': '0x13b2ac'},
        'observed': observed,
        'adapters': ['UI singleton/window lookups', 'close popup and search state callbacks',
                     'connected GameClient lookup/state callback', 'result UI consumer boundary'],
        'scope': 'Original type virtual methods and full dispatcher branches execute. UI callbacks are captured, not Android screens. No Home is used as a cancellation acknowledgement.',
    }
    (ROOT / 'native-battle-routing.json').write_text(json.dumps(report, indent=2) + '\n')
    print('Native cancel and battle-result dispatcher routing PASS; Android UI not emulated')


if __name__ == '__main__':
    main()

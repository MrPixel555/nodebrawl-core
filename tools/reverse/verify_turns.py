"""Run the real EndClientTurn parser and SelectDeck logic with explicit UI adapters."""
import json
import struct

from native_vm import ROOT
from starter_home import StarterHome, qword, word
from verify_home import read_u32
from verify_schemas import vint


def verify_turn(vm, commands, variant):
    command_pointers = []
    for command in commands:
        stream, _ = vm.stream(bytes.fromhex(command['payloadHex']))
        pointer = vm.call(0x36714c, stream, 1, 1, count=2000000)
        assert pointer
        command_pointers.append(pointer)
    message = vm.alloc(0x100)
    stream, buffer = vm.stream()
    vm.uc.mem_write(message + 0x10, bytes(vm.uc.mem_read(stream, 0x70)))
    word(vm, message + 0x88, 8192 if variant else 37)
    word(vm, message + 0x8c, -8192 if variant else 12345)
    if command_pointers:
        collection = vm.alloc(16)
        pointers = vm.alloc(len(command_pointers) * 8)
        vm.uc.mem_write(pointers, struct.pack('<' + 'Q' * len(command_pointers), *command_pointers))
        vm.uc.mem_write(collection, struct.pack('<Qii', pointers, len(command_pointers), len(command_pointers)))
        vm.uc.mem_write(message + 0x80, struct.pack('<Q', collection))
    vm.call(0x520928, message, count=4000000)
    size = read_u32(vm, message + 0x24)
    payload = bytes(vm.uc.mem_read(buffer, size))
    expected = vint(8192 if variant else 37) + vint(-8192 if variant else 12345) + vint(len(commands))
    expected += b''.join(bytes.fromhex(command['payloadHex']) for command in commands) + bytes.fromhex('ffffffff')
    assert payload == expected
    second = vm.alloc(0x100)
    inp, buf = vm.stream(payload)
    vm.uc.mem_write(second + 0x10, bytes(vm.uc.mem_read(inp, 0x70)))
    vm.call(0x17c560, second, count=4000000)
    consumed = read_u32(vm, second + 0x24)
    assert consumed == size
    collection = qword(vm, second + 0x80)
    assert read_u32(vm, collection + 0xc) == len(commands)
    word(vm, second + 0x24, 0)
    word(vm, second + 0x2c, 0)
    vm.call(0x520928, second, count=4000000)
    assert read_u32(vm, second + 0x24) == size and bytes(vm.uc.mem_read(buf, size)) == payload
    return {'id': 13597, 'variant': variant,
            'fields': {'field_0x88': 8192 if variant else 37, 'field_0x8c': -8192 if variant else 12345,
                       'commands': [{'id': command['id'], 'fields': command['fields']} for command in commands],
                       'field_0x98': None},
            'payloadHex': payload.hex(), 'nativeDecodeConsumed': consumed, 'nativeReencodeEqual': True}


def main():
    model = StarterHome()
    vm = model.vm
    commands = json.loads((ROOT / 'native-commands.json').read_text())
    fixtures = [verify_turn(vm, [], 0)]
    fixtures.append(verify_turn(vm, [next(c for c in commands if c['id'] == kind and c['variant'] == variant)
                                    for kind, variant in [(703, 0), (948, 1), (987, 1)]], 1))
    (ROOT / 'native-turns.json').write_text(json.dumps(fixtures, indent=2) + '\n')

    # Real logic context uses Home +0x48 and observer +0xa8. Only the observer
    # callback is adapted; SelectDeck and its Home/collection helpers execute.
    config = vm.alloc(0x400)
    vm.uc.mem_write(config + 0x301, b'\1')  # Five-deck feature enabled.
    vm.uc.mem_write(0xd5dc80, struct.pack('<Q', config))
    context = vm.alloc(0xb0)
    vm.uc.mem_write(context + 0x48, struct.pack('<Q', model.home))
    observer, vtable = vm.alloc(8), vm.alloc(0x100)
    vm.uc.mem_write(observer, struct.pack('<Q', vtable))
    vm.uc.mem_write(context + 0xa8, struct.pack('<Q', observer))
    vm.uc.mem_write(vtable + 0xf8, struct.pack('<Q', 0x20005000))
    callbacks = []

    def notify(machine):
        callbacks.append([machine.reg(1), machine.reg(2)])
        machine.ret()

    vm.register_hook(0x20005000, notify)
    command = vm.call(0x41a1dc, 703)
    observations = []
    for requested, result, selected in [(1, 0, 1), (4, 0, 4), (4, 4, 4), (0, 0, 0), (5, 3, 0), (-1, 3, 0)]:
        word(vm, command + 0x1c, requested)
        actual = vm.call(0x32f870, command, context, 2, count=2000000)
        assert actual == result and read_u32(vm, model.home + 0x2a0) == selected
        observations.append({'requestedDeck': requested, 'nativeResult': actual, 'selectedDeck': selected})
    assert callbacks == [[0, 1], [1, 4], [4, 0]]
    output = {'librarySha256': json.loads((ROOT / 'command-profile.json').read_text())['librarySha256'],
              'messageId': 13597, 'commandId': 703, 'nativeExecute': '0x32f870',
              'observations': observations, 'observerCallbacks': callbacks,
              'scope': 'Original command/Home logic with CSV lookup adapters and a UI observer callback; not Android UI or gameplay checksum validation'}
    (ROOT / 'native-select-deck.json').write_text(json.dumps(output, indent=2) + '\n')
    print('EndClientTurn native encode/decode/reencode: 2 fixtures PASS')
    print('SelectDeck native execution: 6 cases, 3 observer callbacks PASS')


if __name__ == '__main__':
    main()

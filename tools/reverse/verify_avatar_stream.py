"""Verify the self AvatarStream request and genuinely empty initial response.

The native stream manager must receive an allocated empty vector, not a null
list. No battle history, clan invitations or name-change gameplay is invented.
"""
import hashlib
import json
import struct

from native_vm import NativeVM, ROOT
from verify_alliances import roundtrip
from verify_home import read_u32


def main():
    vm = NativeVM(trace_instructions=False)
    # Reject accidental null dereferences rather than allowing zero-page reads.
    vm.uc.mem_protect(0, 4096, 0)
    requests = []
    for identity in ([0, 1], [0, 8192]):
        wire = struct.pack('>ii', *identity)
        requests.append(roundtrip(vm, 11712, 0x65f3b0, 0x48bc08,
                                  {'field_0x80': identity}, wire, identity[1]))
    reply = roundtrip(vm, 28299, 0x2ebe8c, 0x2326c8,
                      {'entries': []}, b'\0', 'allocated-empty')
    manager = vm.alloc(0x30)
    consumed = []
    for _ in range(2):
        message = vm.alloc(0x1000)
        vm.uc.mem_write(message, struct.pack('<Q', 0xa6d980))
        stream, _ = vm.stream(b'\0')
        vm.uc.mem_write(message + 0x10, bytes(vm.uc.mem_read(stream, 0x70)))
        vm.call(0x2326c8, message)
        assert read_u32(vm, message + 0x24) == 1
        assert struct.unpack('<Q', vm.uc.mem_read(message + 0x80, 8))[0] != 0
        result = vm.call(0x6e6968, manager, message, count=1000000)
        assert result == 1
        assert bytes(vm.uc.mem_read(manager + 0x24, 2)) == b'\1\0'
        assert bytes(vm.uc.mem_read(message + 0x80, 8)) == bytes(8)
        consumed.append({'result': result, 'loaded': True, 'messageListOwnershipTransferred': True})
    # The native decoder allows null, but the real stream consumer does not.
    message = vm.alloc(0x1000)
    vm.uc.mem_write(message, struct.pack('<Q', 0xa6d980))
    stream, _ = vm.stream(b'\x7f')
    vm.uc.mem_write(message + 0x10, bytes(vm.uc.mem_read(stream, 0x70)))
    vm.call(0x2326c8, message)
    assert bytes(vm.uc.mem_read(message + 0x80, 8)) == bytes(8)
    try:
        vm.call(0x6e6968, manager, message, count=1000000)
    except RuntimeError:
        from unicorn.arm64_const import UC_ARM64_REG_PC
        assert vm.uc.reg_read(UC_ARM64_REG_PC) == 0x6e6ab8
    else:
        raise AssertionError('Native null stream list unexpectedly accepted')
    fixtures = {'requests': requests, 'emptyReply': reply}
    report = {'librarySha256': hashlib.sha256((ROOT / 'libg.so').read_bytes()).hexdigest(),
              'request': 11712, 'requestConstructor': '0x535908', 'lobbySendCall': '0x59f208',
              'requestEncoder': '0x65f3b0', 'requestDecoder': '0x48bc08',
              'requestFields': 'one fixed-width Big Endian int32 pair; no name string',
              'response': 28299, 'responseEncoder': '0x2ebe8c', 'responseDecoder': '0x2326c8',
              'emptyPayloadHex': '00', 'consumer': '0x6e6968', 'managerGlobal': '0xd4c300',
              'loadedFlagOffset': '0x24', 'consumption': consumed,
              'nullListRejectedByConsumer': True, 'nullListFaultPC': '0x6e6ab8',
              'gameCodeAdapters': [],
              'scope': 'Original request/empty-response codecs and empty native stream consumer with unreadable null page. No nonempty stream entry codecs, populated stream manager, name UI or Android execution verified.'}
    (ROOT / 'native-avatar-stream-fixtures.json').write_text(json.dumps(fixtures, indent=2) + '\n')
    (ROOT / 'native-avatar-stream.json').write_text(json.dumps(report, indent=2) + '\n')
    print('Native 11712 request, 28299 allocated empty stream, repeated consumer load/ownership and null-list negative PASS')


if __name__ == '__main__':
    main()

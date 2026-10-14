"""Verify Node Login replies and session boxes through the native Messaging parser.

The only input adapter implements the native reader's read(buffer,count) method.
Connection fields are initialized explicitly; outgoing Login is not assumed to
have run. Native checks, authentication, constructors and decoders execute.
"""
import json
from pathlib import Path
import struct
import subprocess

from native_vm import NativeVM, ROOT


def qword(vm, pointer):
    return struct.unpack('<Q', vm.uc.mem_read(pointer, 8))[0]


def word(vm, pointer):
    return struct.unpack('<I', vm.uc.mem_read(pointer, 4))[0]


class MessagingHarness:
    def __init__(self):
        self.vm = NativeVM(trace_instructions=False)
        self.messaging = self.vm.alloc(0x300)
        self.factory = self.vm.alloc(0x20)
        self.vm.uc.mem_write(self.factory, struct.pack('<Q', 0xa4c938))
        self.vm.uc.mem_write(self.messaging + 0xc8, struct.pack('<Q', self.factory))
        self.reader = self.vm.alloc(0x20)
        table = self.vm.alloc(0x40)
        self.vm.uc.mem_write(table + 0x30, struct.pack('<Q', 0x20002000))
        self.vm.uc.mem_write(self.reader, struct.pack('<Q', table))
        self.shared = self.vm.alloc(16)
        self.vm.uc.mem_write(self.shared, struct.pack('<Q', self.reader))
        self.packet = b''
        self.offset = 0
        def read(vm):
            count = min(vm.reg(2), len(self.packet) - self.offset)
            vm.uc.mem_write(vm.reg(1), self.packet[self.offset:self.offset + count])
            self.offset += count
            vm.ret(count)
        self.vm.register_hook(0x20002000, read)

    def state(self, value=None):
        if value is not None:
            self.vm.uc.mem_write(self.messaging + 0x254, struct.pack('<I', value))
        return word(self.vm, self.messaging + 0x254)

    def receive(self, id, version, payload):
        self.packet = struct.pack('>H', id) + len(payload).to_bytes(3, 'big') + struct.pack('>H', version) + payload
        self.offset = 0
        result = self.vm.call(0x250bbc, self.messaging, self.shared, count=200000000)
        assert self.offset == len(self.packet), 'Native parser did not read all framed bytes'
        return result


def main():
    exporter = Path(__file__).resolve().parents[1] / 'export-transport-vectors.js'
    vectors = json.loads(subprocess.check_output(['node', str(exporter)]))
    observations = []
    for vector in vectors:
        model = MessagingHarness()
        vm, obj = model.vm, model.messaging
        model.state(3)
        hello = bytes(range(24))
        assert model.receive(20100, 0, struct.pack('>I', 24) + hello) == 0
        assert word(vm, obj + 0x230) == 24
        assert bytes(vm.uc.mem_read(qword(vm, obj + 0x228), 24)) == hello
        # These are explicitly synthetic client-side handshake state fields.
        vm.uc.mem_write(obj + 0x260, bytes.fromhex(vector['clientPublicKey']))
        vm.uc.mem_write(obj + 0x280, bytes.fromhex(vector['clientSecret']))
        vm.uc.mem_write(obj + 0x2a0, bytes.fromhex(vector['clientNonce']))
        model.state(4)
        native_open = []
        def observe_open(vm):
            native_open.append({'nonce': bytes(vm.uc.mem_read(vm.reg(3), 24)).hex(),
                                'key': bytes(vm.uc.mem_read(vm.reg(4), 32)).hex()})
        vm.register_hook(0x1f8f08, observe_open)
        message = model.receive(20758, 1, bytes.fromhex(vector['box']))
        assert message and qword(vm, message) == 0xa62c90
        assert word(vm, message + 0x24) == len(bytes.fromhex(vector['payload']))
        assert native_open[0] == {'nonce': vector['replyNonce'], 'key': vector['sharedKey']}
        assert model.state() == 5
        assert bytes(vm.uc.mem_read(obj + 0x260, 0x70)) == bytes(0x70), 'Native handshake material was not cleared'
        receive_cipher, send_cipher = qword(vm, obj + 0x1f8), qword(vm, obj + 0x200)
        assert bytes(vm.uc.mem_read(receive_cipher + 8, 32)).hex() == vector['sessionKey']
        assert bytes(vm.uc.mem_read(receive_cipher + 0x28, 24)).hex() == vector['serverNonce']
        assert bytes(vm.uc.mem_read(send_cipher + 0x28, 24)).hex() == vector['clientNonce']
        for frame in vector['incoming']:
            received = model.receive(frame['id'], frame['version'], bytes.fromhex(frame['box']))
            assert received and vm.call(qword(vm, qword(vm, received) + 0x28), received) == frame['id']
        assert bytes(vm.uc.mem_read(receive_cipher + 0x28, 24)).hex() == vector['finalServerNonce']
        for frame in vector['outgoing']:
            plain = bytes.fromhex(frame['payload'])
            input = vm.alloc(max(1, len(plain)))
            vm.uc.mem_write(input, plain)
            output = vm.alloc(len(plain) + 16)
            assert vm.call(0x6554f8, send_cipher, input, output, len(plain), count=10000000) == 0
            assert bytes(vm.uc.mem_read(output, len(plain) + 16)).hex() == frame['box']
        assert bytes(vm.uc.mem_read(send_cipher + 0x28, 24)).hex() == vector['finalClientNonce']
        observations.append({**vector, 'nativeLoginReplyAccepted': True, 'nativeStateAfterLoginReply': 5,
                             'nativeIncomingFramesAccepted': len(vector['incoming']),
                             'nativeOutgoingBoxesMatched': len(vector['outgoing']),
                             'nativeHandshakeMaterialCleared': True,
                             'runtimeState': 'Synthetic client state in protocol VM; outgoing Login and Android initialization not executed'})
        print(f'Native Messaging Login reply and bidirectional session, variant {vector["variant"]}: PASS', flush=True)
    (ROOT / 'native-transport.json').write_text(json.dumps(observations, indent=2) + '\n')
    failed = json.loads((Path(__file__).resolve().parents[2] / 'test/fixtures/native-encrypted-failed.json').read_text())
    model = MessagingHarness()
    model.state(4)
    for name, offset in [('clientPublicKey', 0x260), ('clientSecret', 0x280), ('clientNonce', 0x2a0)]:
        model.vm.uc.mem_write(model.messaging + offset, bytes.fromhex(failed[name]))
    result = model.receive(20103, 4, bytes.fromhex(failed['box']))
    assert qword(model.vm, result) == 0xa70d88
    assert word(model.vm, result + 0x24) == len(bytes.fromhex(failed['payload']))
    assert model.state() == 5
    (ROOT / 'native-encrypted-failed.json').write_text(json.dumps({**failed, 'nativeAccepted': True, 'nativeState': 5}, indent=2) + '\n')
    print('Native encrypted LoginFailed: PASS', flush=True)



if __name__ == '__main__':
    main()

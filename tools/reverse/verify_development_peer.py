"""Exercise the Frida Stalker call-site argument overrides in the protocol VM.

The override changes only key/nonce arguments at the same call sites as Frida.
Native key generation, Salsa, MAC verification, packet parsing and codecs execute.
This does not validate Interceptor installation or Android runtime behavior.
"""
import hashlib
import json
from pathlib import Path
import struct
import subprocess
from elftools.elf.elffile import ELFFile

from native_vm import ROOT
from verify_schemas import prepare
from verify_transport import MessagingHarness, qword, word
from unicorn.arm64_const import UC_ARM64_REG_SP, UC_ARM64_REG_X2, UC_ARM64_REG_X3

helper = Path(__file__).resolve().parents[1] / 'development-peer-oracle.js'
def node(operation, **values):
    result = subprocess.run(['node', str(helper)], input=json.dumps({'operation': operation, **values}),
                            text=True, stdout=subprocess.PIPE, check=True)
    return json.loads(result.stdout)

model = MessagingHarness()
vm, obj = model.vm, model.messaging
peer = bytes.fromhex(node('public')['publicKey'])
model.state(3)
hello = bytes(range(24))
assert model.receive(20100, 0, struct.pack('>I', 24) + hello) == 0
fields = json.loads((ROOT / 'extra-schemas.json').read_text())['10101']
message, _, payload, _ = prepare(vm, fields, 1)
vm.uc.mem_write(message, struct.pack('<Q', 0xa2d968))
vm.uc.mem_write(message + 8, struct.pack('<I', 4))
vm.uc.mem_write(obj + 0x258, struct.pack('<Q', message))
observed = []
login = {}

def native_object(vm, outgoing):
    sp = vm.uc.reg_read(UC_ARM64_REG_SP)
    pointer = qword(vm, sp + (0x60 if outgoing else 0x3b0))
    assert pointer == obj, 'Stalker call-site stack slot did not resolve Messaging'
    return pointer


def override_core(vm, outgoing):
    assert vm.reg(3) == 1
    native_object(vm, outgoing)
    secret = bytes(vm.uc.mem_read(obj + 0x280, 32))
    shared = bytes.fromhex(node('shared', clientSecret=secret.hex())['shared'])
    pointer = vm.alloc(32)
    vm.uc.mem_write(pointer, shared)
    vm.uc.reg_write(UC_ARM64_REG_X2, pointer)
    observed.append(hex(0x3bcc68 if outgoing else 0x27eab4))


def override_nonce(vm, outgoing):
    native_object(vm, outgoing)
    pub = bytes(vm.uc.mem_read(obj + 0x260, 32))
    nonce = bytes(vm.uc.mem_read(obj + 0x2a0, 24))
    digest = hashlib.blake2b((b'' if outgoing else nonce) + pub + peer, digest_size=24).digest()
    pointer = vm.alloc(24)
    vm.uc.mem_write(pointer, digest)
    vm.uc.reg_write(UC_ARM64_REG_X3, pointer)
    observed.append(hex(0x3bcc84 if outgoing else 0x27ead4))
    if outgoing:
        output, count = vm.reg(0), vm.reg(2)
        def returned(vm):
            login['box'] = pub.hex() + bytes(vm.uc.mem_read(output + 16, count - 16)).hex()
        vm.register_hook(0x3bcc88, returned)

vm.register_hook(0x3bcc68, lambda vm: override_core(vm, True))
vm.register_hook(0x3bcc84, lambda vm: override_nonce(vm, True))
vm.register_hook(0x27eab4, lambda vm: override_core(vm, False))
vm.register_hook(0x27ead4, lambda vm: override_nonce(vm, False))
assert vm.call(0x3affd4, obj, count=300000000, timeout=120000000) == 1
print('Native outgoing Login with development peer override: PASS', flush=True)
reply = node('reply', helloNonce=hello.hex(), loginBox=login['box'], loginPayload=payload.hex(),
             homePayload=json.loads((ROOT / 'native-home.json').read_text())['payloadHex'])
assert reply['loginPayloadAccepted']
# The surrounding native connection caller normally advances this state.
model.state(4)
for frame in reply['frames']:
    result = model.receive(frame['id'], frame['version'], bytes.fromhex(frame['payload']))
    expected = {20758: 0xa62c90, 21217: 0xa6d260, 20108: 0xa735c8}[frame['id']]
    assert result and qword(vm, result) == expected
    if frame['id'] == 21217:
        assert word(vm, result + 0x24) == 416
assert model.state() == 5
assert observed == ['0x3bcc68', '0x3bcc84', '0x27eab4', '0x27ead4']
for segment in ELFFile(open(ROOT / 'libg.so', 'rb')).iter_segments():
    if segment['p_type'] == 'PT_LOAD' and segment['p_flags'] & 1:
        start, size = segment['p_vaddr'], segment['p_filesz']
        assert bytes(vm.uc.mem_read(start, size)) == vm.memory[start:start + size], 'Original executable bytes changed'
(ROOT / 'native-development-peer.json').write_text(json.dumps({
    'nativeOutgoingLoginAcceptedByNode': True, 'nativeNodeReplyAccepted': True,
    'nativeEncryptedHomeConsumed': 416, 'nativeEncryptedKeepAliveAccepted': True,
    'nativeStateAfterReply': 5, 'overriddenCallSites': observed,
    'androidStalkerExecutionVerified': False,
    'originalExecutableBytesUnchanged': True,
    'runtimeState': 'Protocol VM with call-site overrides and verified Messaging stack slots; connection caller state initialized explicitly',
}, indent=2) + '\n')
print('Node development transport -> native LoginOk, empty Home and KeepAlive: PASS', flush=True)

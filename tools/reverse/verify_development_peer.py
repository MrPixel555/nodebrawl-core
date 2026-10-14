"""Exercise the Frida peer-key argument overrides in the native protocol VM.

The override changes only key/nonce arguments at the same call sites as Frida.
Native key generation, Salsa, MAC verification, packet parsing and codecs execute.
This does not validate Interceptor installation or Android runtime behavior.
"""
import hashlib
import json
from pathlib import Path
import struct
import subprocess

from native_vm import ROOT
from verify_schemas import prepare
from verify_transport import MessagingHarness, qword, word
from unicorn.arm64_const import UC_ARM64_REG_LR, UC_ARM64_REG_X2, UC_ARM64_REG_X3

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

def override_core(vm):
    caller = vm.uc.reg_read(UC_ARM64_REG_LR)
    if caller not in [0x3bcc6c, 0x27eab8] or vm.reg(3) != 1:
        return
    secret = bytes(vm.uc.mem_read(obj + 0x280, 32))
    shared = bytes.fromhex(node('shared', clientSecret=secret.hex())['shared'])
    pointer = vm.alloc(32)
    vm.uc.mem_write(pointer, shared)
    vm.uc.reg_write(UC_ARM64_REG_X2, pointer)
    observed.append(hex(caller))


def override_nonce(vm, outgoing):
    caller = vm.uc.reg_read(UC_ARM64_REG_LR)
    if caller != (0x3bcc88 if outgoing else 0x27ead8):
        return
    pub = bytes(vm.uc.mem_read(obj + 0x260, 32))
    nonce = bytes(vm.uc.mem_read(obj + 0x2a0, 24))
    digest = hashlib.blake2b((b'' if outgoing else nonce) + pub + peer, digest_size=24).digest()
    pointer = vm.alloc(24)
    vm.uc.mem_write(pointer, digest)
    vm.uc.reg_write(UC_ARM64_REG_X3, pointer)
    observed.append(hex(caller))
    if outgoing:
        output, count = vm.reg(0), vm.reg(2)
        def returned(vm):
            login['box'] = pub.hex() + bytes(vm.uc.mem_read(output + 16, count - 16)).hex()
        vm.register_hook(caller, returned)

vm.register_hook(0x35b118, override_core)
vm.register_hook(0x36bc7c, lambda vm: override_nonce(vm, True))
vm.register_hook(0x1f8f08, lambda vm: override_nonce(vm, False))
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
assert observed == ['0x3bcc6c', '0x3bcc88', '0x27eab8', '0x27ead8']
(ROOT / 'native-development-peer.json').write_text(json.dumps({
    'nativeOutgoingLoginAcceptedByNode': True, 'nativeNodeReplyAccepted': True,
    'nativeEncryptedHomeConsumed': 416, 'nativeEncryptedKeepAliveAccepted': True,
    'nativeStateAfterReply': 5, 'overriddenCallSites': observed,
    'androidInterceptorInstallationVerified': False,
    'runtimeState': 'Protocol VM with explicit development peer key/nonce argument overrides; connection caller state initialized explicitly',
}, indent=2) + '\n')
print('Node development transport -> native LoginOk, empty Home and KeepAlive: PASS', flush=True)

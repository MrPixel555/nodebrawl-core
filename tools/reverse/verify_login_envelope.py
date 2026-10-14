"""Execute native outgoing Login with real native key generation and box creation."""
import json
import struct
import subprocess
from pathlib import Path

from native_vm import NativeVM, ROOT
from verify_schemas import prepare
from unicorn.arm64_const import UC_ARM64_REG_LR

vm = NativeVM(trace_instructions=False)
vm.entropy = lambda size: bytes((n * 7 + 23) & 255 for n in range(size))
obj = vm.alloc(0x300)
vm.uc.mem_write(obj + 0x254, struct.pack('<I', 3))
fields = json.loads((ROOT / 'extra-schemas.json').read_text())['10101']
message, _, payload, _ = prepare(vm, fields, 1)
vm.uc.mem_write(message, struct.pack('<Q', 0xa2d968))
vm.uc.mem_write(message + 8, struct.pack('<I', 4))
vm.uc.mem_write(obj + 0x258, struct.pack('<Q', message))
hello = bytes(range(24))
nonce = vm.alloc(24)
vm.uc.mem_write(nonce, hello)
vm.uc.mem_write(obj + 0x228, struct.pack('<QQ', nonce, len(hello)))
observation = {}

def seal_probe(vm):
    output, count = vm.reg(0), vm.reg(2)
    observation.update({
        'clientPublicKey': bytes(vm.uc.mem_read(obj + 0x260, 32)).hex(),
        'clientSecret': bytes(vm.uc.mem_read(obj + 0x280, 32)).hex(),
        'clientNonce': bytes(vm.uc.mem_read(obj + 0x2a0, 24)).hex(),
        'serverHelloNonce': hello.hex(), 'loginPayload': payload.hex(),
        'nativeNonce': bytes(vm.uc.mem_read(vm.reg(3), 24)).hex(),
        'nativeKey': bytes(vm.uc.mem_read(vm.reg(4), 32)).hex(),
        'nativePaddedPlaintext': bytes(vm.uc.mem_read(vm.reg(1), count)).hex(),
    })
    def returned(vm):
        observation['nativeBox'] = bytes(vm.uc.mem_read(output + 16, count - 16)).hex()
    vm.register_hook(vm.uc.reg_read(UC_ARM64_REG_LR), returned)

vm.register_hook(0x36bc7c, seal_probe)
assert vm.call(0x3affd4, obj, count=300000000, timeout=120000000) == 1
assert observation['nativePaddedPlaintext'] == bytes(32).hex() + observation['serverHelloNonce'] + observation['clientNonce'] + observation['loginPayload']
needle = bytes.fromhex(observation['clientPublicKey'] + observation['nativeBox'])
heap = bytes(vm.uc.mem_read(0x10000000, vm.heap - 0x10000000))
observation['nativePublicKeyPrefixFound'] = needle in heap
assert observation['nativePublicKeyPrefixFound'], 'Native wire buffer did not contain public key + compact box'
observation.update({'nativeFunction': '0x3affd4', 'nativeEncodeCompleted': True,
                    'runtimeState': 'Protocol VM; deterministic test entropy; no Android execution'})
subprocess.run(['node', str(Path(__file__).resolve().parents[1] / 'check-native-login.js')], input=json.dumps(observation), text=True, check=True)
(ROOT / 'native-login-envelope.json').write_text(json.dumps(observation, indent=2) + '\n')
print('Native outgoing Login key generation, nonce, plaintext and public-key-prefixed box: PASS', flush=True)

#!/usr/bin/env python3
"""Execute the patched ARM64 library offline, without crypto argument hooks.

Requires the existing optional GAME_ANALYSIS_DIR VM workspace. Does not model
Android's loader/UI or execute Frida. File/socket adapters are confined to test
boundaries; all new native crypto and endpoint parsing execute as compiled.
"""
import argparse
import io
import hashlib
import json
from pathlib import Path
import struct
import subprocess
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'reverse'))
from elftools.elf.elffile import ELFFile
from native_vm import NativeVM, ROOT
from verify_schemas import prepare
from verify_transport import MessagingHarness, qword, word
from unicorn import UC_HOOK_CODE
from unicorn.arm64_const import UC_ARM64_REG_X0
from elf_patch import runtime_image, align, REPO


class PatchedVM(NativeVM):
    def __init__(self, library, raw=False):
        super().__init__(trace_instructions=False)
        # Hundreds of independent PLT hooks make the multi-million-byte startup
        # loop needlessly expensive. The imports occupy one contiguous PLT;
        # none of the optional stream-read observations are needed here.
        for hook in self.point_hooks:
            self.uc.hook_del(hook)
        self.point_hooks = [self.uc.hook_add(UC_HOOK_CODE, self.on_code, begin=min(self.imports), end=max(self.imports))]
        self.uid = 10123
        memory, encrypted = runtime_image(ELFFile(io.BytesIO(library)))
        mapped = align(len(self.memory), 4096)
        if len(memory) > mapped:
            self.uc.mem_map(mapped, align(len(memory), 4096) - mapped)
        self.uc.mem_write(0, bytes(encrypted if raw else memory))
        self.resolve_imports()

    def on_intr(self, uc, number, data):
        if self.reg(8) == 174:
            self.uc.reg_write(UC_ARM64_REG_X0, self.uid)
        else:
            super().on_intr(uc, number, data)


def handshake(library, key, inline):
    model = MessagingHarness(PatchedVM(library))
    vm, obj = model.vm, model.messaging
    model.state(3)
    hello = bytes(range(24))
    if not inline:
        assert model.receive(20100, 0, struct.pack('>I', 24) + hello) == 0
    fields = json.loads((ROOT / 'extra-schemas.json').read_text())['10101']
    message, _, payload, _ = prepare(vm, fields, 1)
    vm.uc.mem_write(message, struct.pack('<Q', 0xa2d968))
    vm.uc.mem_write(message + 8, struct.pack('<I', 4))
    vm.uc.mem_write(obj + 0x258, struct.pack('<Q', message))
    login = {}
    # Observation at the original return site only: no registers or memory
    # are changed and no new/native crypto function is replaced or hooked.
    def observe_return(vm):
        login['box'] = bytes(vm.uc.mem_read(obj + 0x260, 32)) + bytes(vm.uc.mem_read(login['out'] + 16, login['count'] - 16))
    def observe_seal(vm):
        login['out'], login['count'] = vm.reg(0), vm.reg(2)
    vm.register_hook(0x36bc7c, observe_seal)
    vm.register_hook(0x264204 if inline else 0x3bcc88, observe_return)
    if inline:
        assert model.receive(20100, 0, struct.pack('>I', 24) + hello, count=400000000, timeout=120000000) == 0
    else:
        assert vm.call(0x3affd4, obj, count=400000000, timeout=120000000) == 1
    secret = bytes(vm.uc.mem_read(obj + 0x280, 32))
    home = json.loads((ROOT / 'native-home.json').read_text())['payloadHex']
    reply = json.loads(subprocess.check_output(['node', str(REPO / 'tools/client/peer-oracle.js')], input=json.dumps({
        'clientSecret': secret.hex(), 'serverPublicKey': key, 'loginBox': login['box'].hex(),
        'helloNonce': hello.hex(), 'loginPayload': payload.hex(), 'homePayload': home}).encode()))
    model.state(4)
    for frame in reply['frames']:
        received = model.receive(frame['id'], frame['version'], bytes.fromhex(frame['payload']), count=400000000, timeout=120000000)
        assert received and qword(vm, received) == {20758: 0xa62c90, 21217: 0xa6d260, 20108: 0xa735c8}[frame['id']]
        if frame['id'] == 21217:
            assert word(vm, received + 0x24) == len(bytes.fromhex(home))
    assert model.state() == 5
    assert bytes(vm.uc.mem_read(obj + 0x260, 0x70)) == bytes(0x70)
    print('Patched native handshake, ' + ('inline' if inline else 'deferred') + ': PASS', flush=True)
    return {'inlineLogin': inline, 'outgoingLoginAcceptedByNode': True, 'nativeReplyHomeKeepAliveAccepted': True, 'state': 5, 'cryptoArgumentOverrides': 0}


def connections(library, report):
    vm = PatchedVM(library)
    cases = []
    path, connected = [], []
    config = [None]
    error = vm.alloc(4)
    dns, freed = [], []
    def getaddrinfo(vm):
        host = vm.string(vm.reg(0)).decode()
        dns.append(host)
        assert vm.reg(1) == 0
        assert word(vm, vm.reg(2) + 4) == 2 and word(vm, vm.reg(2) + 8) == 1
        if host == 'missing.invalid':
            vm.ret(-2)
            return
        address = vm.alloc(16)
        vm.uc.mem_write(address, bytes([2, 0, 0, 0, 192, 0, 2, 99]) + bytes(8))
        info = vm.alloc(48)
        vm.uc.mem_write(info, struct.pack('<iiiiI4xQQQ', 0, 2, 1, 6, 16, 0, address, 0))
        vm.uc.mem_write(vm.reg(3), struct.pack('<Q', info))
        vm.ret(0)
    def freeaddrinfo(vm):
        freed.append(vm.reg(0))
        vm.ret(0)
    def fopen(vm):
        path.append(vm.string(vm.reg(0)).decode())
        vm.ret(0x1234 if config[0] is not None else 0)
    def fread(vm):
        count = min(vm.reg(2), len(config[0]))
        vm.uc.mem_write(vm.reg(0), config[0][:count])
        vm.ret(count)
    def connect(vm):
        assert vm.reg(0) == 7 and vm.reg(2) == 16
        connected.append(bytes(vm.uc.mem_read(vm.reg(1), 16)))
        vm.uc.mem_write(error, struct.pack('<I', 115))
        vm.ret(-1)  # Preserve the original EINPROGRESS contract.
    for at, name in vm.imports.items():
        fn = {'fopen': fopen, 'fread': fread, 'fclose': lambda vm: vm.ret(), '__errno': lambda vm: vm.ret(error), 'connect': connect, 'getaddrinfo': getaddrinfo, 'freeaddrinfo': freeaddrinfo}.get(name)
        if fn:
            vm.register_hook(at, fn)
    original = vm.alloc(16)
    vm.uc.mem_write(original, b'\x02\x00\x24\x7b\x01\x02\x03\x04' + bytes(8))
    for text, expected in [(None, None), (b'192.0.2.20:1234\n', ('192.0.2.20', 1234)), (b'127.0.0.1:65535', ('127.0.0.1', 65535)), (b'', None), (b'256.2.3.4:9339', None), (b'1.2.3.4:0', None), (b'1.2.3.4:65536', None), (b'1.2.3.4:9339\ntrailing', None), (b'x' * 272, None), (b'game.example.com:1234\r\n', ('192.0.2.99', 1234)), (b'missing.invalid:9339', None), (b'1.2.3.4:9339\0x', None)]:
        config[0] = text
        connected.clear()
        vm.uc.mem_write(error, bytes(4))
        assert vm.call(report['nativeSymbols']['peer_connect'], 7, original, 16) & 0xffffffff == 0xffffffff
        if expected:
            assert len(connected) == 1
            value = connected[0]
            assert '.'.join(map(str, value[4:8])) == expected[0]
            assert int.from_bytes(value[2:4], 'big') == expected[1]
            assert word(vm, error) == 115
        else:
            assert not connected and word(vm, error) == (113 if text == b'missing.invalid:9339' else 22)
        cases.append({'config': None if text is None else text.decode(), 'accepted': bool(expected)})
    vm.uid = 1010123
    path.clear()
    config[0] = b'192.0.2.1:9339\n'
    vm.call(report['nativeSymbols']['peer_connect'], 7, original, 16)
    assert path == ['/data/user/10/com.supercell.clashroyale/files/configs.so']
    assert dns == ['game.example.com', 'missing.invalid'] and len(freed) == 1
    print('Native configs.so parsing, DNS, nonblocking errno and Android user paths: PASS', flush=True)
    return cases


def startup(library):
    vm = PatchedVM(library, raw=True)
    assert bytes(vm.uc.mem_read(0xa80010, 4)) != b'TID_'
    vm.call(0x31f934, count=500000000, timeout=120000000, max_slices=3)
    assert bytes(vm.uc.mem_read(0xa80010, 4)) == b'TID_'
    # Every protected string now agrees with the independently decoded image.
    from elf_patch import STRING_TABLE, ranges
    expected, _ = runtime_image(ELFFile(io.BytesIO(library)))
    entries = ranges(expected, STRING_TABLE)
    for at, size in entries:
        assert bytes(vm.uc.mem_read(at, size)) == bytes(expected[at:at + size]), hex(at)
    print('Original startup string decryptor on patched ELF: PASS', flush=True)
    return {'originalStringDecryptorExecuted': True, 'stringRangesMatched': len(entries)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--library', type=Path, required=True)
    parser.add_argument('--report', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    library, report = args.library.read_bytes(), json.loads(args.report.read_text())
    assert hashlib.sha256(library).hexdigest() == report['patchedLibrarySha256']
    result = {'serverPublicKey': report['serverPublicKey'], 'startup': startup(library),
              'handshakes': [handshake(library, report['serverPublicKey'], inline) for inline in [False, True]],
              'connections': connections(library, report), 'patchedLibrarySha256': report['patchedLibrarySha256'], 'androidLoaderAndUiVerified': False}
    args.output.write_text(json.dumps(result, indent=2) + '\n')


if __name__ == '__main__':
    main()

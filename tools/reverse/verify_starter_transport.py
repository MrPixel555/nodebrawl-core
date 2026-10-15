"""Feed the actual Node starter provider through native session decryption/codecs."""
import json
from pathlib import Path
import struct
import subprocess

from starter_home import StarterHome
from verify_transport import MessagingHarness, qword, word
from native_vm import ROOT

data = StarterHome()
model = MessagingHarness(vm=data.vm)
vector = json.loads(subprocess.check_output(['node', str(Path(__file__).resolve().parents[1] / 'export-starter-transport.js')]))
model.state(3)
assert model.receive(20100, 0, struct.pack('>I', 24) + bytes(range(24))) == 0
for name, offset in [('clientPublicKey', 0x260), ('clientSecret', 0x280), ('clientNonce', 0x2a0)]:
    model.vm.uc.mem_write(model.messaging + offset, bytes.fromhex(vector[name]))
model.state(4)
for frame in vector['frames']:
    message = model.receive(frame['id'], frame['version'], bytes.fromhex(frame['payload']))
    expected = {20758: 0xa62c90, 21217: 0xa6d260, 20108: 0xa735c8}[frame['id']]
    assert message and qword(model.vm, message) == expected
    if frame['id'] == 21217:
        # Messaging owns its nested stream; verify against its returned message,
        # not the standalone seed decoder's previous input_stream recorder.
        assert data.decoded_message == message
        assert word(model.vm, message + 0x24) == vector['homeBytes']
        home = qword(model.vm, message + 0x80)
        avatar = qword(model.vm, message + 0x88)
        assert bytes(model.vm.uc.mem_read(avatar + 0x10, 24)) == struct.pack('<ii', *vector['accountId']) * 3
        assert word(model.vm, home + 0x134) == 8
        assert word(model.vm, home + 0x3c8) == word(model.vm, avatar + 0xd8) == 1
assert model.state() == 5
report = {'nativeLoginOkAccepted': True, 'nativeStarterHomeConsumed': vector['homeBytes'],
          'nativeAccountBindingsMatched': True, 'nativeKeepAliveAccepted': True,
          'nativeHomeLevel': 1, 'nativeAvatarLevel': 1,
          'scope': 'Node starter provider to native session parser with synthetic handshake fields and CSV data adapters',
          'androidLobbyVerified': False}
(ROOT / 'native-starter-transport.json').write_text(json.dumps(report, indent=2) + '\n')
print('Node starter provider -> native encrypted LoginOk, starter Home and KeepAlive PASS')

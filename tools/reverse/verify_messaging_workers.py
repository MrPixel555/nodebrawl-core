"""Run the original Messaging constructor and capture its native worker tuples.

Only OS thread/socket creation is adapted for the single-thread protocol VM.
This verifies worker selection, not Stalker execution on Android.
"""
import json
import struct

from native_vm import NativeVM, ROOT

vm = NativeVM(trace_instructions=False)
messaging = vm.alloc(0x300)
workers = []


def create_thread(machine):
    tls, member, adjustment, instance = struct.unpack('<QQQQ', machine.uc.mem_read(machine.reg(3), 32))
    assert tls and adjustment == 0 and instance == messaging
    assert struct.unpack('<Q', machine.uc.mem_read(instance, 8))[0] == 0xa5b528
    workers.append({'start': hex(machine.reg(2)), 'member': hex(member),
                    'adjustment': adjustment, 'instanceMatches': True})
    machine.uc.mem_write(machine.reg(0), struct.pack('<Q', 0x555000 + len(workers)))
    machine.ret(0)


def socket_pair(machine):
    assert (machine.reg(0), machine.reg(1), machine.reg(2)) == (1, 1, 0)
    machine.uc.mem_write(machine.reg(3), struct.pack('<ii', 101, 102))
    machine.ret(0)


def fcntl(machine):
    assert machine.reg(0) in (101, 102)
    machine.ret(0)


vm.register_hook(0xdfe30, create_thread)
vm.register_hook(0xe04a0, socket_pair)
vm.register_hook(0xe06a0, fcntl)
vm.call(0x23fe4c, messaging, 0x50)
assert [worker['start'] for worker in workers] == ['0x8011bc', '0x8011bc']
assert [worker['member'] for worker in workers] == ['0x16db08', '0x6a5ab8']
report = {'constructor': '0x23fe4c', 'vtable': '0xa5b528', 'tupleBytes': 32,
          'tupleFields': ['TLS', 'member', 'adjustment', 'instance'], 'workers': workers,
          'scope': 'Original ARM64 constructor in Unicorn; OS adapters; no Android runtime verification'}
(ROOT / 'native-messaging-workers.json').write_text(json.dumps(report, indent=2) + '\n')
print('Original Messaging constructor: two verified native worker tuples PASS')

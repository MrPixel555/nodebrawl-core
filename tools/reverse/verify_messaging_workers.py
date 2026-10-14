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

# Exercise the original successful-connect branch with an explicitly initialized
# connection object. Resolver, sockets and unrelated virtual status calls are
# adapters; the native std::thread tuple/trampoline/member instructions execute.
network = NativeVM(trace_instructions=False)
connection = network.alloc(0x100)
callback = network.alloc(0x300)
vtable = network.alloc(0xb0)
address_info = network.alloc(0x30)
address = network.alloc(16)
host = network.alloc(32)
port = network.alloc(8)
network.uc.mem_write(connection, struct.pack('<Q', vtable))
network.uc.mem_write(connection + 0x50, struct.pack('<Q', callback))
network.uc.mem_write(callback, struct.pack('<Q', 0xa5b528))
network.uc.mem_write(vtable + 0xa8, struct.pack('<Q', 0x20002010))
network.uc.mem_write(vtable + 0x78, struct.pack('<Q', 0x20002014))
network.uc.mem_write(vtable + 0x90, struct.pack('<Q', 0x20002018))
network.uc.mem_write(address_info, struct.pack('<iiiiQQQQ', 0, 2, 1, 6, 16, 0, address, 0))
network.uc.mem_write(address, bytes.fromhex('0200247bc63364010000000000000000'))
network.uc.mem_write(host, b'test.example\0')
network.uc.mem_write(port, b'9339\0')
network.register_hook(0x169858, lambda machine: machine.ret(address_info))
network.register_hook(0xe0160, lambda machine: machine.ret(147))
network.register_hook(0xdf950, lambda machine: machine.ret(0))
network.register_hook(0xe0340, lambda machine: machine.ret(0))
network.register_hook(0x20002010, lambda machine: machine.ret(0))
network.register_hook(0x20002014, lambda machine: machine.ret(1))
network.register_hook(0xe0b20, lambda machine: machine.ret(0))


def create_tls_key(machine):
    machine.uc.mem_write(machine.reg(0), struct.pack('<I', 1))
    machine.ret(0)


network.register_hook(0xdfd10, create_tls_key)
connection_workers = []


def connection_thread(machine):
    argument = machine.reg(3)
    tls, member, adjustment, instance = struct.unpack('<QQQQ', machine.uc.mem_read(argument, 32))
    assert tls and machine.reg(2) == 0x825b70 and member == 0x7c92b0
    assert adjustment == 0 and instance == connection
    assert struct.unpack('<Q', machine.uc.mem_read(instance + 0x50, 8))[0] == callback
    connection_workers.append({'start': hex(machine.reg(2)), 'member': hex(member),
                               'adjustment': adjustment, 'callbackOffset': '0x50'})
    connection_thread.argument = argument
    machine.uc.mem_write(machine.reg(0), struct.pack('<Q', 500))
    machine.ret(0)


entered = []


def reader_entry(machine):
    assert machine.reg(0) == connection
    entered.append(True)
    machine.ret(0)


network.register_hook(0xdfe30, connection_thread)
network.register_hook(0x20002018, reader_entry)
network.call(0x2330ec, connection, host, port)
assert len(connection_workers) == 1
network.call(0x825b70, connection_thread.argument)
assert entered == [True]
report = {'constructor': '0x23fe4c', 'vtable': '0xa5b528', 'tupleBytes': 32,
          'tupleFields': ['TLS', 'member', 'adjustment', 'instance'], 'workers': workers,
          'connectionWorkers': connection_workers, 'connectionStart': '0x2330ec',
          'connectionScope': 'Explicit connection object; native connect branch, tuple and trampoline; OS/reader-entry adapters',
          'scope': 'Original ARM64 constructor in Unicorn; OS adapters; no Android runtime verification'}
(ROOT / 'native-messaging-workers.json').write_text(json.dumps(report, indent=2) + '\n')
print('Original Messaging constructor and connection: three verified native worker tuples and reader dispatch PASS')

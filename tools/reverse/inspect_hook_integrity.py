"""Locate old inline hooks in the checksum table used by the reported crash."""
import json
import os
from pathlib import Path
import struct

root = Path(os.environ['GAME_ANALYSIS_DIR'])
memory = (root / 'memory.bin').read_bytes()
table = 0xbeefd4  # Referenced by the checker at 0x5148ac.
hooks = {
    0x250bbc: 'Messaging.read', 0x41e914: 'Login.encode',
    0x154440: 'Home.decode', 0x3affd4: 'Login.build',
    0x1f8f08: 'authenticated open', 0x35b118: 'HSalsa core',
    0x36bc7c: 'authenticated seal',
}
matches = []
count = total = 0
for pointer in range(table, len(memory) - 20, 12):
    v1, v2, v3, v4, v5 = struct.unpack_from('<5I', memory, pointer)
    address = (v4 - v3 - v2 - v1 + table) & 0xffffffff
    size = (v2 + v4 - v5) & 0xffffffff
    if not size:
        break
    assert address + size <= len(memory), 'Invalid protected range'
    for hook, name in hooks.items():
        if address < hook + 16 and hook < address + size:
            matches.append({'name': name, 'hook': hex(hook), 'tableEntry': count,
                            'rangeStart': hex(address), 'rangeBytes': size})
    count += 1
    total += size
else:
    raise AssertionError('Checksum table has no terminator')
assert {match['hook'] for match in matches} == {hex(hook) for hook in hooks}
report = {
    'checker': '0x5148ac', 'checksumTable': hex(table),
    'protectedRangeCount': count, 'protectedByteCount': total,
    'oldInlineHookCoverage': matches,
    'scope': 'Static coverage of original hook prologues; does not execute Android or disable integrity checks',
}
(root / 'native-hook-integrity.json').write_text(json.dumps(report, indent=2) + '\n')
print(f'All seven old inline hooks intersect {count} protected ranges; use code-preserving probes')

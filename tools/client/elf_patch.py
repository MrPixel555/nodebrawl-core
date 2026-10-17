"""Pinned ARM64 client rebuild with original Arxan checksum verification.

ELF mapping/relocations and string XOR follow the existing APK analysis. The
three checksum accumulators independently implement the algorithm documented
by Mimi8298/Supercell.ArxanUnprotector; no integrity branch is disabled.
"""
import ctypes
import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import struct
import subprocess

from elftools.elf.elffile import ELFFile

REPO = Path(__file__).resolve().parents[2]
LIBRARY_SHA = '4dd79f7c143fe87dba0e3c7521fe150bf1e018783a2e04632bd38bba5dafde5a'
PUBLIC_KEY = '8ddd4aa88e325e6cf7393740d2b9a9a952934477a44818bc0605d3b730cc5831'
STRING_TABLE = 13624892
STRING_KEY = 13919807
CALLS = {
    0x3bcc68: ('peer_shared_deferred', 0x35b118),
    0x2641e4: ('peer_shared_inline', 0x35b118),
    0x27eab4: ('peer_shared_reply', 0x35b118),
    0x3bcc84: ('peer_seal_deferred', 0x36bc7c),
    0x264200: ('peer_seal_inline', 0x36bc7c),
    0x27ead4: ('peer_open_reply', 0x1f8f08),
    0x2331b8: ('peer_connect', 0xdf950),
}


def align(value, alignment=0x10000):
    return (value + alignment - 1) & -alignment


def branch(source, target):
    delta = target - source
    if delta % 4 or not -(1 << 27) <= delta < (1 << 27):
        raise ValueError('Invalid ARM64 BL range')
    return struct.pack('<I', 0x94000000 | ((delta >> 2) & 0x3ffffff))


def ranges(memory, table):
    result = []
    for at in range(table, len(memory) - 20, 12):
        v1, v2, v3, v4, v5 = struct.unpack_from('<5I', memory, at)
        address = (v4 - v3 - v2 - v1 + table) & 0xffffffff
        size = (v2 + v4 - v5) & 0xffffffff
        if not size:
            return result
        if address + size >= len(memory):
            raise ValueError('Invalid native range table')
        result.append((address, size))
    raise ValueError('Unterminated native range table')


def runtime_image(elf):
    loads = [s for s in elf.iter_segments() if s['p_type'] == 'PT_LOAD']
    memory = bytearray(max(s['p_vaddr'] + s['p_memsz'] for s in loads))
    for segment in loads:
        memory[segment['p_vaddr']:segment['p_vaddr'] + segment['p_filesz']] = segment.data()
    for name in ['.rela.dyn', '.rela.plt']:
        for entry in elf.get_section_by_name(name).iter_relocations():
            if entry['r_info_type'] == 1027:
                struct.pack_into('<Q', memory, entry['r_offset'], entry['r_addend'])
    encrypted = bytes(memory)
    key = memory[STRING_KEY:STRING_KEY + 128]
    for address, size in ranges(memory, STRING_TABLE):
        for n in range(size):
            memory[address + n] ^= key[n % 128]
    return memory, encrypted


def find_tables(memory, start, size):
    active, found = [], []
    for at in range(start, start + size - 20, 4):
        v1, v2, v3, v4, v5 = struct.unpack_from('<5I', memory, at)
        length = (v2 + v4 - v5) & 0xffffffff
        if active:
            remaining = []
            for base in active:
                if (at - base) % 12:
                    remaining.append(base)
                    continue
                address = (v4 - v3 - v2 - v1 + base) & 0xffffffff
                if length == 0:
                    if at - base >= 24:
                        found.append(base)
                elif address < len(memory) and address + length + 8 < len(memory):
                    remaining.append(base)
            active = remaining
        elif length:
            address = (v4 - v3 - v2 - v1 + at) & 0xffffffff
            if address < len(memory) and address + length + 8 < len(memory):
                active.append(at)
    return found


class Checksums:
    def __init__(self, work):
        compiler = shutil.which(os.environ.get('CC', 'cc'))
        if not compiler:
            raise RuntimeError('A host C compiler is required for the verified checksum accelerator')
        path = work / 'checksum.so'
        subprocess.run([compiler, '-O2', '-fPIC', '-shared', str(REPO / 'tools/client/checksum.c'), '-o', str(path)], check=True)
        self.library = ctypes.CDLL(str(path))

    def calculate(self, memory, entries):
        data = ctypes.create_string_buffer(bytes(memory))
        flat = [value for pair in entries for value in pair]
        table = (ctypes.c_uint32 * len(flat))(*flat)
        result = (ctypes.c_uint32 * 3)()
        self.library.checksum(data, table, len(entries), result)
        return list(result)


def payload(elf, code_start, work, clang, linker, public_key):
    native = REPO / 'client/native'
    flags = ['--target=aarch64-linux-android21', '-Oz', '-fPIC', '-ffreestanding', '-fno-builtin', '-fno-stack-protector', '-fno-unwind-tables', '-fno-asynchronous-unwind-tables', '-ffunction-sections', '-fdata-sections', '-mno-outline-atomics', '-nostdinc', '-I' + str(native / 'include'), '-I' + str(REPO / 'client/vendor/monocypher')]
    macro = '-DSERVER_PUBLIC_KEY_BYTES=' + ','.join('0x' + public_key[n:n + 2] for n in range(0, 64, 2))
    objects = []
    for source in [native / 'entry.S', native / 'peer.c', REPO / 'client/vendor/monocypher/monocypher.c']:
        obj = work / (source.stem + '.o')
        subprocess.run([clang, *flags, macro, '-c', str(source), '-o', str(obj)], check=True)
        objects.append(str(obj))
    rel = elf.get_section_by_name('.rela.plt')
    symbols = elf.get_section(rel['sh_link'])
    imports = {symbols.get_symbol(r['r_info_sym']).name: elf.get_section_by_name('.plt')['sh_addr'] + 32 + n * 16 for n, r in enumerate(rel.iter_relocations())}
    addresses = { 'native_hsalsa': 0x35b118, 'native_seal': 0x36bc7c, 'native_open': 0x1f8f08 }
    addresses['memset'] = imports['memset']
    for name, symbol in [('native_connect', 'connect'), ('native_fopen', 'fopen'), ('native_fread', 'fread'), ('native_fclose', 'fclose'), ('native_errno', '__errno'), ('native_getaddrinfo', 'getaddrinfo'), ('native_freeaddrinfo', 'freeaddrinfo')]:
        addresses[name] = imports[symbol]
    script = 'OUTPUT_ARCH(aarch64)\nENTRY(peer_connect)\nSECTIONS {\n . = ' + hex(code_start) + ';\n .text : { KEEP(*(.text.entry)) *(.text*) }\n .rodata : ALIGN(16) { *(.rodata*) }\n /DISCARD/ : { *(.comment) *(.note*) *(.eh_frame*) }\n}\n'
    script += '\n'.join(name + ' = ' + hex(address) + ';' for name, address in addresses.items())
    (work / 'payload.ld').write_text(script)
    target = work / 'payload.elf'
    subprocess.run([linker, '--gc-sections', '-T', str(work / 'payload.ld'), '-o', str(target), *objects], check=True)
    compiled = ELFFile(io.BytesIO(target.read_bytes()))
    if any(section['sh_type'] in ['SHT_REL', 'SHT_RELA', 'SHT_DYNAMIC'] and section['sh_size'] for section in compiled.iter_sections()):
        raise ValueError('Payload must have no dynamic relocations')
    sections = [s for s in compiled.iter_sections() if s['sh_flags'] & 2 and s['sh_size']]
    if any(s['sh_type'] == 'SHT_NOBITS' or s['sh_flags'] & 1 for s in sections):
        raise ValueError('Payload must be immutable and contain no BSS')
    output = bytearray(max(s['sh_addr'] + s['sh_size'] for s in sections) - code_start)
    for section in sections:
        offset = section['sh_addr'] - code_start
        output[offset:offset + section['sh_size']] = section.data()
    names = {s.name: s['st_value'] for s in compiled.get_section_by_name('.symtab').iter_symbols()}
    return bytes(output), names


def patch_library(original, work, clang, linker, public_key=PUBLIC_KEY):
    if hashlib.sha256(original).hexdigest() != LIBRARY_SHA:
        raise ValueError('Unsupported libg.so; only the supplied ARM64 3.1.0 library is supported')
    if len(public_key) != 64 or len(bytes.fromhex(public_key)) != 32:
        raise ValueError('Invalid peer public key')
    work.mkdir(parents=True, exist_ok=True)
    elf = ELFFile(io.BytesIO(original))
    memory, encrypted = runtime_image(elf)
    baseline = bytes(memory)
    data = elf.get_section_by_name('.data')
    checksum = Checksums(work)
    tables = []
    for table in find_tables(encrypted, data['sh_addr'], data['sh_size']):
        entries = ranges(memory, table)
        if not entries:
            continue
        values = checksum.calculate(memory, entries)
        locations = [[n for n in range(data['sh_addr'], data['sh_addr'] + data['sh_size'] - 4, 4) if struct.unpack_from('<I', memory, n)[0] == value] for value in values]
        if locations[0] and len(locations[0]) == len(locations[1]) == len(locations[2]):
            tables.append({'address': table, 'entries': entries, 'locations': locations, 'originalKeys': values})
    if not any(t['address'] == 0xbeefd4 and len(t['entries']) == 83788 for t in tables):
        raise ValueError('Original integrity baseline did not verify')
    end = max(segment['p_vaddr'] + segment['p_memsz'] for segment in elf.iter_segments() if segment['p_type'] == 'PT_LOAD')
    appended = align(max(len(original), end))
    code_start = appended + 0x1000
    code, names = payload(elf, code_start, work, clang, linker, public_key)
    changed = []
    for address, (name, target) in CALLS.items():
        if bytes(memory[address:address + 4]) != branch(address, target):
            raise ValueError('Original call-site opcode mismatch at ' + hex(address))
        new = branch(address, names[name])
        memory[address:address + 4] = new
        changed.append({'address': address, 'target': names[name], 'symbol': name, 'oldHex': branch(address, target).hex(), 'newHex': new.hex()})
    for _ in range(16):
        updates = 0
        for table in tables:
            values = checksum.calculate(memory, table['entries'])
            for value, locations in zip(values, table['locations']):
                for at in locations:
                    if struct.unpack_from('<I', memory, at)[0] != value:
                        struct.pack_into('<I', memory, at, value)
                        updates += 1
        if not updates:
            break
    else:
        raise ValueError('Integrity metadata did not converge')
    output = bytearray(original)
    def file_offset(address):
        for segment in elf.iter_segments():
            if segment['p_type'] == 'PT_LOAD' and segment['p_vaddr'] <= address < segment['p_vaddr'] + segment['p_filesz']:
                return segment['p_offset'] + address - segment['p_vaddr']
        raise ValueError('Patch is not backed by ELF file data')
    for change in changed:
        at = file_offset(change['address'])
        output[at:at + 4] = bytes.fromhex(change['newHex'])
    metadata = []
    for table in tables:
        values = checksum.calculate(memory, table['entries'])
        for value, locations in zip(values, table['locations']):
            for address in locations:
                assert struct.unpack_from('<I', memory, address)[0] == value
                at = file_offset(address)
                # String protection is XOR. Preserve encryption by applying
                # just the plaintext delta; never rewrite relocated pointers.
                for n in range(4):
                    output[at + n] ^= baseline[address + n] ^ memory[address + n]
        metadata.append({'table': hex(table['address']), 'ranges': len(table['entries']), 'originalKeys': table['originalKeys'], 'updatedKeys': values, 'locations': table['locations']})
    phdrs = original[elf['e_phoff']:elf['e_phoff'] + elf['e_phnum'] * elf['e_phentsize']]
    total = 0x1000 + len(code)
    output.extend(bytes(appended + total - len(output)))
    phdrs += struct.pack('<IIQQQQQQ', 1, 5, appended, appended, appended, total, total, 0x10000)
    output[appended:appended + len(phdrs)] = phdrs
    output[code_start:code_start + len(code)] = code
    struct.pack_into('<Q', output, 32, appended)
    struct.pack_into('<H', output, 56, elf['e_phnum'] + 1)
    patched = ELFFile(io.BytesIO(output))
    check_memory, _ = runtime_image(patched)
    for table in tables:
        assert checksum.calculate(check_memory, table['entries']) == [struct.unpack_from('<I', check_memory, group[0])[0] for group in table['locations']]
    report = {'originalLibrarySha256': LIBRARY_SHA, 'patchedLibrarySha256': hashlib.sha256(output).hexdigest(), 'serverPublicKey': public_key,
              'fridaRequired': False, 'instrumentationFrameworkBundled': False, 'integrityChecksDisabled': False,
              'appendedSegment': {'address': appended, 'size': total, 'flags': 'RX', 'programHeadersRelocated': True},
              'calls': changed, 'integrity': metadata, 'nativeSymbols': {name: names[name] for name in ['peer_connect', 'peer_shared', 'peer_seal', 'peer_open']}}
    return bytes(output), report

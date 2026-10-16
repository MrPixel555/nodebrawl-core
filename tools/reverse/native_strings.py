"""Run selected native String/data initializers for JSON and game-data analysis.

The String path selects 183 constructors; the data path adds 38 constructors
with explicit C/POSIX libc support. Selection is pinned to this library and its
function map. Android application/loader/worker startup remains outside scope.
"""
import hashlib
import json

from capstone import Cs, CS_ARCH_ARM64, CS_MODE_LITTLE_ENDIAN
from elftools.elf.elffile import ELFFile
from native_vm import ROOT

LIBRARY_SHA256 = '4dd79f7c143fe87dba0e3c7521fe150bf1e018783a2e04632bd38bba5dafde5a'
EXCLUDED_DATA_INITIALIZERS = {
    0x31f934: 'Outside the recovered function map; application loader initialization not modeled',
    0xf0410: 'Large application initialization thunk not verified in the data-only VM',
    0xf1430: 'Worker initialization requires native threads',
    0xf15bc: 'Application property initialization outside the data-only probe'}


def initializer_groups(vm):
    assert hashlib.sha256((ROOT / 'libg.so').read_bytes()).hexdigest() == LIBRARY_SHA256
    functions = dict(json.loads((ROOT / 'functions.json').read_text()))
    disassembler = Cs(CS_ARCH_ARM64, CS_MODE_LITTLE_ENDIAN)
    selected, remaining = [], []
    with (ROOT / 'libg.so').open('rb') as handle:
        section = ELFFile(handle).get_section_by_name('.init_array')
        for offset in range(0, section['sh_size'], 8):
            pointer = int.from_bytes(vm.memory[section['sh_addr'] + offset:section['sh_addr'] + offset + 8], 'little')
            if pointer not in functions:
                assert pointer in EXCLUDED_DATA_INITIALIZERS
                remaining.append(pointer)
                continue
            targets = {instruction.op_str for instruction in disassembler.disasm(
                vm.memory[pointer:pointer + functions[pointer]], pointer) if instruction.mnemonic in ('bl', 'b')}
            if '#0x65612c' in targets and '#0x85e460' not in targets:
                selected.append(pointer)
            else:
                remaining.append(pointer)
    assert len(selected) == 183
    assert len(remaining) == 42 and set(EXCLUDED_DATA_INITIALIZERS) <= set(remaining)
    return selected, [pointer for pointer in remaining if pointer not in EXCLUDED_DATA_INITIALIZERS]


def initialize_strings(vm):
    selected, _ = initializer_groups(vm)
    for pointer in selected:
        vm.call(pointer)
    return selected


def initialize_data_globals(model):
    """Run the other 38 selected constructors before native GameData linking.

    These include containers, regexes, constants, RNG and C++ support objects;
    executing them must preserve registered CSV tables and the text dictionary.
    Running this after linking would reset live caches and is rejected.
    """
    vm = model.vm
    assert vm.uc.mem_read(0xd6c128, 1)[0] == 0, 'Data constructors must precede GameData linking'
    _, selected = initializer_groups(vm)
    assert len(selected) == 38
    text_dictionary = model.qword(0xd66200)
    for pointer in selected:
        vm.call(pointer, count=20000000, max_slices=5)
        for kind, table in model.tables.items():
            assert model.qword(0xd5dc68 + kind * 8) == table, (hex(pointer), kind)
        assert model.qword(0xd66200) == text_dictionary, hex(pointer)
    # The native reward-selector cache uses a std::map sentinel. Zeroed BSS
    # is not a constructed map, even though lookups initially return empty.
    assert model.qword(0xd69950) == 0xd69958
    assert model.qword(0xd69958) == 0 and model.qword(0xd69960) == 0
    return selected

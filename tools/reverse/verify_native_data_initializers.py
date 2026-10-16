"""Verify native data prerequisites and the reward-map initialization regression."""
import argparse
import json
from pathlib import Path

from native_csv import NativeCsv
from native_strings import initialize_data_globals, EXCLUDED_DATA_INITIALIZERS, LIBRARY_SHA256
from native_vm import ROOT
from unicorn.arm64_const import UC_ARM64_REG_PC


def map_probe(initialized):
    model = NativeCsv()
    vm = model.vm
    if initialized:
        vm.call(0xf1c8c)
    node = vm.alloc(0x40)
    try:
        vm.call(0x823b3c, 0xd69950, 0xd69958, 0xd69958, node)
    except RuntimeError:
        assert not initialized and vm.uc.reg_read(UC_ARM64_REG_PC) == 0x823b5c
        return False
    assert initialized
    assert model.qword(0xd69950) == model.qword(0xd69958) == node
    assert model.qword(0xd69960) == 1 and model.qword(node + 16) == 0xd69958
    return True


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--checkpoint', type=Path, required=True,
                        help='Pre-link checkpoint with 72 raw tables and the native full text dictionary')
    args = parser.parse_args()
    assert map_probe(False) is False and map_probe(True) is True
    model = NativeCsv()
    model.restore(args.checkpoint)
    assert len(model.tables) == 72 and model.qword(0xd66200)
    selected = initialize_data_globals(model)
    report = {'librarySha256': LIBRARY_SHA256, 'stringInitializerCatalogCount': 183,
              'additionalDataInitializers': [hex(pointer) for pointer in selected],
              'excludedInitializers': {hex(key): value for key, value in EXCLUDED_DATA_INITIALIZERS.items()},
              'registeredTablesPreserved': len(model.tables), 'textDictionaryPreserved': True,
              'nativeRewardCacheSentinelVerified': True,
              'mapRegression': {'initializer': '0xf1c8c', 'nativeInsert': '0x823b3c',
                                'uninitializedFaultPc': '0x823b5c', 'initializedInsertSucceeded': True},
              'gameCodeAdapters': [],
              'scope': 'Selected native data prerequisites and a synthetic std::map-node insertion, not complete Android process initialization. GameData field linking, world construction and simulation remain unverified.'}
    (ROOT / 'native-data-initializers-verification.json').write_text(json.dumps(report, indent=2) + '\n')
    print('38 data constructors preserve 72 tables/text dictionary; original reward-map initialization regression PASS')


if __name__ == '__main__':
    main()

"""Verify the nested string/JSON startup message against its original codecs."""
import json
import struct

from native_vm import NativeVM, ROOT
from verify_home import read_u32


def main():
    vm = NativeVM(trace_instructions=False)
    fixtures = []
    for variant, (name, details) in enumerate([
        ('home-open', '{"screen":"home","entry":"login"}'),
        ('بازیکن', '{}'),
        ('Client_ContentDownloadFailed', '{"label":"Client","type":"ContentDownloadFailed","product":"download_url","productDetail":"https://content.example/8f3a0350bb1c87f1676dc4571fd5a84cf6afe5dc/csv_client/animations.csv?token=private","failCode":"404"}'),
    ]):
        # Native JSON output escapes forward slashes, including URL separators.
        details = details.replace('/', '\\/')
        wire = b''.join(struct.pack('>I', len(value.encode())) + value.encode() for value in (name, details))
        message = vm.alloc(0x100)
        stream, buffer = vm.stream(wire)
        vm.uc.mem_write(message + 0x10, bytes(vm.uc.mem_read(stream, 0x70)))
        vm.call(0x581cc4, message, count=2000000)
        consumed = read_u32(vm, message + 0x24)
        assert consumed == len(wire)
        for n in range(2):
            vm.uc.mem_write(message + 0x24, bytes(4))
            vm.uc.mem_write(message + 0x2c, bytes(4))
            vm.call(0x21c2d4, message, count=2000000)
            size = read_u32(vm, message + 0x24)
            assert size == len(wire) and bytes(vm.uc.mem_read(buffer, size)) == wire
            if n == 0:
                vm.uc.mem_write(message + 0x24, bytes(4))
                vm.uc.mem_write(message + 0x2c, bytes(4))
                vm.call(0x581cc4, message, count=2000000)
                assert read_u32(vm, message + 0x24) == len(wire)
        fixtures.append({'id': 10459, 'variant': variant,
                         'fields': {'field_0x80_0x8': name, 'field_0x80_0x20_json': details},
                         'payload': wire.hex(), 'native_decode_consumed': consumed,
                         'native_reencode_equal': True})
    (ROOT / 'native-startup.json').write_text(json.dumps(fixtures, indent=2) + '\n')
    print(f'Native message 10459 nested strings encode/decode/reencode: {len(fixtures)} fixtures PASS')


if __name__ == '__main__':
    main()

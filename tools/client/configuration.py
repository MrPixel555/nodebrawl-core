"""The intentionally plain-text configs.so asset is not an ELF library."""
import ipaddress
import re


def validate_config(data):
    if not 0 < len(data) < 272 or b'\0' in data:
        raise ValueError('Invalid configs.so size or embedded NUL')
    text = data.decode('ascii')
    if text.endswith('\n'):
        text = text[:-1]
    if text.endswith('\r'):
        text = text[:-1]
    host, separator, port = text.partition(':')
    if not separator or not re.fullmatch(r'[0-9]{1,5}', port) or not 1 <= int(port) <= 65535:
        raise ValueError('configs.so must contain host:port on one line')
    if not host or len(host) > 253:
        raise ValueError('Invalid configs.so hostname')
    if re.fullmatch(r'[0-9.]+', host):
        ipaddress.IPv4Address(host)
    elif not all(re.fullmatch(r'[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?', label) for label in host.rstrip('.').split('.')):
        raise ValueError('Invalid configs.so hostname; use ASCII/Punycode DNS names')
    return host, int(port)

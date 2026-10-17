/* Connection/peer adaptation only. Native HSalsa17, Salsa17, MAC checks,
 * codecs and gameplay remain in the original library. No instrumentation
 * framework, shared mutable crypto buffers or server private key. */
#include "monocypher.h"

extern void native_hsalsa(void *, const void *, const void *, int);
extern int native_seal(void *, const void *, uint64_t, const void *, const void *);
extern int native_open(void *, const void *, uint64_t, const void *, const void *, int);
extern int native_connect(int, const void *, unsigned int);
extern void *native_fopen(const char *, const char *);
extern size_t native_fread(void *, size_t, size_t, void *);
extern int native_fclose(void *);
extern int *native_errno(void);

static const uint8_t peer[32] = { SERVER_PUBLIC_KEY_BYTES };

void peer_shared(void *out, const void *input, const void *unused, int flags,
                 const uint8_t *messaging)
{
    (void)unused;
    uint8_t raw[32];
    crypto_x25519(raw, messaging + 0x280, peer);
    native_hsalsa(out, input, raw, flags);
    crypto_wipe(raw, sizeof(raw));
}

int peer_seal(void *out, const void *input, uint64_t length, const void *unused,
              const void *key, const uint8_t *messaging)
{
    (void)unused;
    uint8_t nonce[24];
    crypto_blake2b_ctx hash;
    crypto_blake2b_init(&hash, sizeof(nonce));
    crypto_blake2b_update(&hash, messaging + 0x260, 32);
    crypto_blake2b_update(&hash, peer, sizeof(peer));
    crypto_blake2b_final(&hash, nonce);
    int result = native_seal(out, input, length, nonce, key);
    crypto_wipe(nonce, sizeof(nonce));
    return result;
}

int peer_open(void *out, const void *input, uint64_t length, const void *unused,
              const void *key, int tag_length, const uint8_t *messaging)
{
    (void)unused;
    uint8_t nonce[24];
    crypto_blake2b_ctx hash;
    crypto_blake2b_init(&hash, sizeof(nonce));
    crypto_blake2b_update(&hash, messaging + 0x2a0, 24);
    crypto_blake2b_update(&hash, messaging + 0x260, 32);
    crypto_blake2b_update(&hash, peer, sizeof(peer));
    crypto_blake2b_final(&hash, nonce);
    int result = native_open(out, input, length, nonce, key, tag_length);
    crypto_wipe(nonce, sizeof(nonce));
    return result;
}

/* The Android launcher resolves an IP/hostname on a background thread and
 * writes only IPv4:port here. The original nonblocking TCP connection and its
 * error handling still execute. This call site is the game socket only. */
static size_t decimal(char *out, unsigned int value)
{
    char reversed[12];
    size_t count = 0;
    do { reversed[count++] = (char)('0' + value % 10); value /= 10; } while (value);
    for (size_t n = 0; n < count; n++) out[n] = reversed[count - n - 1];
    return count;
}

static unsigned int app_user(void)
{
    register unsigned long x8 __asm__("x8") = 174; /* Android ARM64 getuid */
    register unsigned long x0 __asm__("x0");
    __asm__ volatile("svc #0" : "=r"(x0) : "r"(x8) : "memory");
    return (unsigned int)(x0 / 100000);
}

static int endpoint(const char *text, uint8_t address[4], unsigned int *port)
{
    for (unsigned int n = 0; n < 4; n++) {
        unsigned int value = 0, digits = 0;
        while (*text >= '0' && *text <= '9') {
            if (++digits > 3) return 0;
            value = value * 10 + (unsigned int)(*text++ - '0');
        }
        if (!digits || value > 255) return 0;
        address[n] = (uint8_t)value;
        if (*text++ != (n == 3 ? ':' : '.')) return 0;
    }
    unsigned int value = 0, digits = 0;
    while (*text >= '0' && *text <= '9') {
        if (++digits > 5) return 0;
        value = value * 10 + (unsigned int)(*text++ - '0');
    }
    if (*text == '\n') text++;
    if (!digits || !value || value > 65535 || *text) return 0;
    *port = value;
    return 1;
}

int peer_connect(int fd, const void *original, unsigned int original_size)
{
    if (!original || original_size < 16 || *(const uint16_t *)original != 2) {
        *native_errno() = 22;
        return -1;
    }
    char path[128], config[64] = "223.223.223.1:9339\n";
    const char prefix[] = "/data/user/", suffix[] = "/com.supercell.clashroyale/files/private-server.conf";
    size_t at = 0;
    for (size_t n = 0; n < sizeof(prefix) - 1; n++) path[at++] = prefix[n];
    at += decimal(path + at, app_user());
    for (size_t n = 0; n < sizeof(suffix); n++) path[at++] = suffix[n];
    void *file = native_fopen(path, "rb");
    if (!file) file = native_fopen("/data/data/com.supercell.clashroyale/files/private-server.conf", "rb");
    if (file) {
        size_t count = native_fread(config, 1, sizeof(config) - 1, file);
        native_fclose(file);
        config[count] = 0;
        if (count == sizeof(config) - 1) { *native_errno() = 22; return -1; }
    }
    uint8_t target[16] = {2, 0};
    unsigned int port = 0;
    if (!endpoint(config, target + 4, &port)) { *native_errno() = 22; return -1; }
    target[2] = (uint8_t)(port >> 8);
    target[3] = (uint8_t)port;
    return native_connect(fd, target, sizeof(target));
}

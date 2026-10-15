# Login built on the device but absent from the server trace

After changing checkout directories, the server uses a new development key.
The user's first trace with the matching generated script opened LoginFailed
successfully; the server rejected the stored account credentials. This proves
that the new public-key pairing works for that connection. Authentication was
not relaxed and existing account/key files were not changed.

The user then cleared **only app data**. In the next trace, native Login encoding
and inline sealing returned zero, but the server received only ClientHello
10100 and sent ServerHello 20100. It received **no Login 10101** before the peer
ended that connection. Another silent connection timed out without any bytes;
its source/purpose is not established. This trace does not show a new credential
rejection, invalid MAC, Home decode failure or content download failure.

The network-v7 device trace shows one send-worker dispatch for ClientHello,
then inline Login seal result zero. It shows no send-worker or reader return
before the server's 30-second idle timeout, and no Login reached the server.
However, the v7 return probes were at/beside exclusive atomic loops. In
particular, 0x6a5bc8 is an LDAXR instruction. Stalker's `memoryAccess` guard can
omit a callout there; missing observations are **not proof of a native deadlock**.
The first observation must not be used to claim a broken return path.

Network-v8 changes the tracing boundary and corrects those observations:

- The synchronous writer 0x207320..0x207598 (0x278 bytes) is excluded from
  Stalker, including nested calls. It encodes/copies frames and invokes the
  connection write. It does not construct the peer key/handshake nonce. Both
  native Login builder/reader peer adapters remain traced. Original game code,
  writer arguments, cipher operations and socket calls execute unchanged.
- `native-send-worker-dispatch` runs at caller BL sites 0x6a5bc4/0x6a5c10,
  outside the excluded function. It records state and recognizes wrapper
  vtable 0xa2cae8; only that wrapper supplies type at +0x7c and version at +8.
  Native getter 0x23876c is `ldr w0,[x0,#0x7c]; ret`.
- `native-send-worker-return` runs at the common continuation 0x6a5c14,
  **after** the shared_ptr exclusive loop and destructor paths. Its duration
  includes that cleanup; it is not a write syscall result or peer receipt.
- Reader returns are observed at nonnull branch 0x71b3a4 and null epilogue
  0x71b3d4, after shared_ptr cleanup. The returned message is in **X21**, not X0
  at those sites. `native-messaging-read-return` reports initial/final state,
  elapsed time and pointer presence only. Null is normal for ServerHello.

Every site has an original-byte profile check. Native library bytes, protocol,
authentication and timing limits are not patched. No bodies/tokens/private keys
are recorded. This change reduces instrumentation inside the writer and makes
observations usable; it is **not a confirmed Android send-stall fix**.

The added Linux x86-64 runtime check, `tools/check-frida-send-exclusion.py`,
passed with Frida 17.23.3: an excluded mutex/socket writer and its nested helper
ran unmodified, actual socketpair request/ACK completed, outside probes resumed,
and original writer bytes/input registration table stayed unchanged. This is
separate from the user's Frida 17.15.4 ARM64 Android environment. Node's 616 tests
also check crypto vectors, metadata privacy/register preservation, exclusion
range and both safe caller sites. Android verification remains necessary.

The ready root `client-dev.js` is now network-v8 for the user's current public
key `8ddd4aa88e325e6cf7393740d2b9a9a952934477a44818bc0605d3b730cc5831`,
host 223.223.223.1:9339. The private key and accounts remain local. A later key
change requires regenerating the script with `tools/make-client-trace.js`;
closing CMD does not delete state, but another checkout has different default
`.local` paths. Existing credentials need their matching account database.

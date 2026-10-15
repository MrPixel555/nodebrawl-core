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

Network-v7 adds read-only Stalker observations to locate the missing boundary:

- Native parser entry 0x250bbc and its caller return sites 0x71b388/0x71b3cc:
  `native-messaging-read-return` reports initial/final state, duration and whether
  a message pointer was returned. A null return can be normal for ServerHello;
  it is not classified as a failure.
- Send-worker dispatch into 0x207320: `native-send-worker-dispatch` reports state
  and recognizes the serialized-message vtable 0xa2cae8. Only for that verified
  wrapper does it read the message type at +0x7c and version at +8. Original
  getter 0x23876c is `ldr w0,[x0,#0x7c]; ret`.
- Caller sites 0x6a5bc8/0x6a5c14 report `native-send-worker-return` and duration.
  Dispatch/return establish this native boundary, not successful socket delivery.

All added sites have original-byte profile checks. No native library code,
arguments, return values, account credentials or cipher behavior is changed.
Bodies, tokens and key material are not recorded. The protocol VM already
verifies inline Login boxes, but it does not exercise the real Android socket
or prove the cause of this new send stall. Device output with these observations
is required before choosing a behavioral fix.

The ready root `client-dev.js` is now network-v7 for the user's current public
key `8ddd4aa88e325e6cf7393740d2b9a9a952934477a44818bc0605d3b730cc5831`,
host 223.223.223.1:9339. The private key and accounts remain local. A later key
change requires regenerating the script with `tools/make-client-trace.js`;
closing CMD does not delete state, but another checkout has different default
`.local` paths. Existing credentials need their matching account database.

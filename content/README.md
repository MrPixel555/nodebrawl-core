# Original content for the supplied APK

`fingerprint.json` is the original content manifest (version 3.1945.13, fingerprint
8f3a0350bb1c87f1676dc4571fd5a84cf6afe5dc). All **1,200 original files** are now
committed under `assets/`, totaling **176,402,252 bytes**. They
are served without decompressing, renaming or replacing their contents; each
matches the original SHA-1. The manifest's own SHA-256 is pinned in the server.

The APK provided 1,075 files (91,265,310 bytes) and omitted 125 entries. After the
environment network change, all 125 were retrieved from the original HTTPS CDN,
totaling 85,136,942 bytes; every original manifest SHA-1 matched. See
[`docs/content-restoration.json`](../docs/content-restoration.json) for the
source and per-file SHA-1/SHA-256/size evidence. `inventory.json` preserves the
original APK baseline and is not the current runtime missing-file count.

The URL advertised to Android now defaults to
`https://game-assets.clashroyaleapp.com`. The supplied APK targets SDK 28 and
does not opt into cleartext HTTP, so advertising `http://223.223.223.1:9338`
is incompatible with its default network policy on Android 9+. The local HTTP
server still serves all files on 9338 for checks or behind a trusted HTTPS
reverse proxy; set `CONTENT_URL` to that proxy's reachable HTTPS URL if using it.
No TLS trust or Android policy checks are disabled.

To verify present files and restore any later-missing entries:

```bash
node tools/fetch-content.js --base-url https://game-assets.clashroyaleapp.com
```

In a Node 24 cloud instance that requires its configured HTTPS proxy, prepend
`--use-env-proxy` after `node`; the ordinary command works on direct networks.
An HTTPS source must serve `/<fingerprint>/<asset-path>`. The tool skips verified
files, preserves existing mismatched files, bounds downloads and exits nonzero
if anything remains unavailable. On-demand downloads use the same checks. If the
official source later loses the version, use the fully restored checkout or a
verified mirror. No substitute assets or changed fingerprints are used.

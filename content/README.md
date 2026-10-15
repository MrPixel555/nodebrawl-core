# Original content for the supplied APK

`fingerprint.json` is the original content manifest (version 3.1945.13, fingerprint
8f3a0350bb1c87f1676dc4571fd5a84cf6afe5dc). The 1,075 original files available in
the uploaded APK are committed under `assets/`, totaling 91,265,310 bytes. They
are served without decompressing, renaming or replacing their contents; each
matches the original SHA-1. The manifest's own SHA-256 is pinned in the server.

The APK omits another 125 manifest entries. They are **not bundled or verified**
by the current checkout. The HTTP server can retrieve a missing file from
`CONTENT_UPSTREAM_URL` and publishes it only after its original hash matches.
The default development upstream is game-assets.clashroyaleapp.com; availability
of this old content is unverified because this cloud environment's egress policy
blocked the request. No fallback file is substituted for a missing asset.

To prefetch the missing files from a source with the original content layout:

```bash
node tools/fetch-content.js --base-url https://game-assets.clashroyaleapp.com
```

An HTTPS source must serve `/<fingerprint>/<asset-path>`. The tool skips verified
files, preserves existing mismatched files, bounds downloads and exits nonzero
if anything remains unavailable. On-demand downloads use the same checks. If the
official source no longer has the version, a verified mirror or the exact missing
files are required; see `inventory.json` for the original APK inventory.

.section .text.entry,"ax"
.p2align 2
.global peer_shared_deferred, peer_shared_inline, peer_shared_reply
.global peer_seal_deferred, peer_seal_inline, peer_open_reply
peer_shared_deferred:
  ldr x4, [sp, #0x60]
  b peer_shared
peer_shared_inline:
  ldr x4, [sp, #0x3b0]
  b peer_shared
peer_shared_reply:
  ldr x4, [sp, #0x3b0]
  b peer_shared
peer_seal_deferred:
  ldr x5, [sp, #0x60]
  b peer_seal
peer_seal_inline:
  ldr x5, [sp, #0x3b0]
  b peer_seal
peer_open_reply:
  ldr x6, [sp, #0x3b0]
  b peer_open

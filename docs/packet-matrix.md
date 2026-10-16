# Complete message and command implementation matrix

Every catalogued type is listed, including unresolved codecs and absent handlers. Runtime support below is the starter configuration and may cover only the stated branch. Factory creation, wire codecs and gameplay are separate checks.

| Message | Name | Wire codec | Runtime support |
| --- | --- | --- | --- |
| 10098 | Message10098 | verified | not implemented |
| 10099 | Message10099 | verified | not implemented |
| 10100 | ClientHello | verified | hello |
| 10101 | Login | verified | login |
| 10102 | Message10102 | verified | not implemented |
| 10108 | KeepAlive | verified | heartbeat |
| 10268 | Message10268 | verified | not implemented |
| 10344 | Message10344 | verified | not implemented |
| 10393 | Message10393 | verified | not implemented |
| 10453 | CreateAlliance | verified | not implemented |
| 10459 | Message10459 | verified | metadata receipt and bounded content diagnostics |
| 10484 | Message10484 | verified | not implemented |
| 10576 | Message10576 | verified | not implemented |
| 10593 | Message10593 | verified | not implemented |
| 10679 | Message10679 | unresolved | not implemented |
| 10707 | Message10707 | verified | not implemented |
| 10834 | Message10834 | verified | not implemented |
| 10916 | Message10916 | unresolved | not implemented |
| 10947 | Message10947 | unresolved | not implemented |
| 10953 | TrainingModeNpcRequest | verified | ordinary Training with null PvE reference only; PvE challenges unsupported |
| 10985 | Message10985 | verified | not implemented |
| 11006 | Message11006 | verified | not implemented |
| 11212 | Message11212 | verified | not implemented |
| 11311 | Message11311 | verified | not implemented |
| 11466 | Message11466 | verified | not implemented |
| 11474 | Message11474 | unresolved | not implemented |
| 11485 | Message11485 | verified | startup receipt |
| 11632 | Message11632 | verified | not implemented |
| 11689 | Message11689 | unresolved | not implemented |
| 11712 | AvatarStreamRequest | verified | authenticated self AvatarStream request |
| 11760 | Message11760 | unresolved | not implemented |
| 11836 | Message11836 | verified | not implemented |
| 11925 | Message11925 | unresolved | not implemented |
| 12087 | Message12087 | unresolved | not implemented |
| 12373 | PlayerProfileRequest | verified | persisted starter player profile lookup |
| 12395 | Message12395 | unresolved | not implemented |
| 12405 | HomeLogicStopped | verified | Home transition receipt/final commands outside an active battle |
| 12445 | Message12445 | verified | not implemented |
| 12473 | Message12473 | verified | not implemented |
| 12526 | Message12526 | verified | native return-dialog Home route |
| 12527 | Message12527 | verified | not implemented |
| 12649 | Message12649 | unresolved | not implemented |
| 12848 | Message12848 | unresolved | not implemented |
| 12912 | Message12912 | verified | not implemented |
| 12951 | Message12951 | verified | not implemented |
| 13006 | Message13006 | verified | queued/loading matchmaking cancellation |
| 13058 | Message13058 | verified | not implemented |
| 13090 | Message13090 | verified | not implemented |
| 13172 | Message13172 | verified | not implemented |
| 13211 | Message13211 | unresolved | not implemented |
| 13351 | Message13351 | unresolved | not implemented |
| 13475 | Message13475 | unresolved | not implemented |
| 13481 | Message13481 | unresolved | not implemented |
| 13525 | Message13525 | unresolved | not implemented |
| 13549 | Message13549 | verified | not implemented |
| 13597 | EndClientTurn | verified | normal matchmaking 527; commands 563/693/703/805, initial naming 948, gold packs 687, Arena1 boost branch 595 and free tier-zero pass gold 836 and Home flags 869, pass seen progress 762 |
| 13631 | Message13631 | verified | not implemented |
| 13727 | Message13727 | verified | not implemented |
| 13732 | Message13732 | verified | not implemented |
| 13752 | Message13752 | verified | network report receipt |
| 13781 | Message13781 | unresolved | not implemented |
| 13882 | ChangeAllianceSettings | verified | not implemented |
| 14054 | Message14054 | verified | not implemented |
| 14062 | Message14062 | verified | native battle end Home route |
| 14124 | Message14124 | unresolved | not implemented |
| 14164 | Message14164 | unresolved | not implemented |
| 14173 | Message14173 | unresolved | not implemented |
| 14315 | Message14315 | verified | not implemented |
| 14674 | Message14674 | verified | not implemented |
| 14783 | AdvancedAllianceSearch | verified | empty advanced clan search |
| 14809 | Message14809 | verified | not implemented |
| 14843 | Message14843 | verified | not implemented |
| 14997 | Message14997 | unresolved | not implemented |
| 15114 | Message15114 | verified | not implemented |
| 15141 | Message15141 | unresolved | not implemented |
| 15164 | Message15164 | unresolved | not implemented |
| 15226 | Message15226 | unresolved | not implemented |
| 15263 | GameModeSnapshotAck | verified | native snapshot acknowledgement; not proof of Android UI |
| 15332 | Message15332 | verified | not implemented |
| 15353 | Message15353 | verified | not implemented |
| 15415 | Message15415 | unresolved | not implemented |
| 15428 | Message15428 | unresolved | not implemented |
| 15441 | Message15441 | verified | not implemented |
| 15725 | Message15725 | unresolved | not implemented |
| 15821 | Message15821 | unresolved | not implemented |
| 15965 | Message15965 | verified | battle Home route, authoritative forfeit and results |
| 16001 | Message16001 | verified | not implemented |
| 16045 | Message16045 | verified | not implemented |
| 16194 | ClientCommandRequest | verified | owned native battle inputs and checksum reports |
| 16220 | Message16220 | verified | not implemented |
| 16292 | Message16292 | verified | not implemented |
| 16401 | Message16401 | verified | not implemented |
| 16442 | ServerFriendsRequest | verified | empty server-friend list prefetch |
| 16592 | CheckName | verified | name preflight; no account mutation |
| 16783 | Message16783 | unresolved | not implemented |
| 16957 | Message16957 | verified | not implemented |
| 17151 | Message17151 | unresolved | not implemented |
| 17212 | Message17212 | verified | not implemented |
| 17221 | Message17221 | verified | not implemented |
| 17248 | Message17248 | unresolved | not implemented |
| 17337 | Message17337 | unresolved | not implemented |
| 17363 | Message17363 | verified | not implemented |
| 17438 | Message17438 | unresolved | not implemented |
| 17541 | Message17541 | unresolved | not implemented |
| 17599 | Message17599 | verified | not implemented |
| 17628 | Message17628 | verified | not implemented |
| 17656 | Message17656 | unresolved | not implemented |
| 17688 | Message17688 | verified | not implemented |
| 17967 | TrainingNpcRequest | verified | source Training NPC world and bot |
| 18077 | Message18077 | verified | not implemented |
| 18100 | Message18100 | verified | not implemented |
| 18102 | Message18102 | verified | not implemented |
| 18104 | Message18104 | verified | not implemented |
| 18195 | Message18195 | unresolved | not implemented |
| 18216 | Message18216 | unresolved | not implemented |
| 18385 | Message18385 | unresolved | not implemented |
| 18443 | Message18443 | unresolved | not implemented |
| 18495 | Message18495 | verified | not implemented |
| 18533 | Message18533 | verified | native return-dialog Home route |
| 18685 | Message18685 | verified | not implemented |
| 18720 | Message18720 | unresolved | not implemented |
| 18900 | Message18900 | unresolved | not implemented |
| 18974 | Message18974 | verified | not implemented |
| 19089 | Message19089 | verified | not implemented |
| 19158 | Message19158 | unresolved | not implemented |
| 19248 | Message19248 | verified | not implemented |
| 19329 | Message19329 | unresolved | not implemented |
| 19355 | Message19355 | unresolved | not implemented |
| 19397 | Message19397 | unresolved | not implemented |
| 19404 | Message19404 | unresolved | not implemented |
| 19462 | Message19462 | verified | not implemented |
| 19500 | Message19500 | verified | not implemented |
| 19503 | Message19503 | verified | not implemented |
| 19591 | Message19591 | verified | not implemented |
| 19652 | Message19652 | unresolved | not implemented |
| 19726 | Message19726 | verified | not implemented |
| 19958 | Message19958 | verified | not implemented |
| 19966 | Message19966 | verified | not implemented |
| 20000 | Message20000 | unresolved | not implemented |
| 20072 | Message20072 | verified | not implemented |
| 20100 | ServerHello | verified | hello response |
| 20103 | LoginFailed | verified | login failure |
| 20108 | KeepAliveOk | verified | heartbeat response |
| 20144 | Message20144 | unresolved | not implemented |
| 20154 | Message20154 | unresolved | not implemented |
| 20182 | Message20182 | verified | not implemented |
| 20316 | Message20316 | verified | not implemented |
| 20324 | Message20324 | verified | not implemented |
| 20329 | Message20329 | unresolved | not implemented |
| 20367 | Message20367 | verified | not implemented |
| 20388 | Message20388 | unresolved | not implemented |
| 20429 | Message20429 | verified | not implemented |
| 20463 | Message20463 | verified | not implemented |
| 20471 | Message20471 | verified | not implemented |
| 20758 | LoginOk | verified | login success and content URL vectors |
| 20819 | Message20819 | unresolved | not implemented |
| 20821 | CheckNameResult | verified | name check result; false flag accepts candidate |
| 20828 | Message20828 | unresolved | not implemented |
| 21008 | Message21008 | verified | not implemented |
| 21047 | ServerFriends | unresolved | only type-zero empty list supported; general friend codec unresolved |
| 21083 | Message21083 | verified | not implemented |
| 21217 | OwnHomeData | unresolved | persistent Home with 95 unlocked cards, card order and free pass claim |
| 21243 | Message21243 | unresolved | not implemented |
| 21669 | Message21669 | verified | not implemented |
| 21749 | Message21749 | unresolved | not implemented |
| 21769 | Message21769 | verified | not implemented |
| 21822 | Message21822 | unresolved | not implemented |
| 21827 | Message21827 | unresolved | not implemented |
| 21888 | Message21888 | verified | not implemented |
| 21926 | Message21926 | unresolved | not implemented |
| 21929 | Message21929 | unresolved | not implemented |
| 22064 | Message22064 | verified | not implemented |
| 22091 | Message22091 | verified | not implemented |
| 22177 | Message22177 | unresolved | not implemented |
| 22192 | ServerCommand | verified | not implemented |
| 22344 | Message22344 | unresolved | not implemented |
| 22493 | Message22493 | verified | not implemented |
| 22556 | Message22556 | unresolved | not implemented |
| 22572 | Message22572 | verified | not implemented |
| 22594 | Message22594 | unresolved | not implemented |
| 22605 | Message22605 | verified | not implemented |
| 22675 | Message22675 | unresolved | not implemented |
| 22708 | Message22708 | unresolved | not implemented |
| 22757 | PlayerProfile | unresolved | native starter profile provider; general codec unresolved |
| 22823 | Message22823 | unresolved | not implemented |
| 22871 | Message22871 | unresolved | not implemented |
| 22904 | Message22904 | verified | not implemented |
| 22906 | Message22906 | verified | not implemented |
| 22968 | Message22968 | verified | not implemented |
| 22999 | Message22999 | unresolved | not implemented |
| 23160 | Message23160 | verified | not implemented |
| 23251 | Message23251 | verified | not implemented |
| 23269 | Message23269 | unresolved | not implemented |
| 23311 | Message23311 | verified | not implemented |
| 23426 | Message23426 | verified | not implemented |
| 23609 | Message23609 | unresolved | not implemented |
| 23943 | Message23943 | verified | not implemented |
| 24184 | AdvancedAllianceSearchResult | verified | advanced clan search result |
| 24233 | Message24233 | verified | not implemented |
| 24255 | Message24255 | unresolved | not implemented |
| 24278 | Message24278 | verified | not implemented |
| 24283 | Message24283 | unresolved | not implemented |
| 24291 | Message24291 | verified | not implemented |
| 24292 | Message24292 | unresolved | not implemented |
| 24338 | Message24338 | verified | not implemented |
| 24365 | Message24365 | verified | not implemented |
| 24415 | Message24415 | unresolved | not implemented |
| 24514 | Message24514 | verified | not implemented |
| 24546 | Message24546 | unresolved | not implemented |
| 24933 | Message24933 | verified | not implemented |
| 24990 | Message24990 | verified | not implemented |
| 25027 | Message25027 | verified | not implemented |
| 25074 | AllianceSearchResult | verified | not implemented |
| 25084 | Message25084 | verified | not implemented |
| 25161 | Message25161 | unresolved | not implemented |
| 25261 | Message25261 | unresolved | not implemented |
| 25275 | Message25275 | unresolved | not implemented |
| 25279 | Message25279 | unresolved | not implemented |
| 25290 | Message25290 | verified | not implemented |
| 25382 | Message25382 | verified | not implemented |
| 25507 | Message25507 | verified | not implemented |
| 25520 | Message25520 | verified | not implemented |
| 25729 | Message25729 | unresolved | not implemented |
| 25781 | Message25781 | unresolved | not implemented |
| 25892 | Message25892 | verified | not implemented |
| 25953 | Message25953 | verified | not implemented |
| 25992 | Message25992 | unresolved | not implemented |
| 26036 | Message26036 | unresolved | not implemented |
| 26085 | Message26085 | unresolved | not implemented |
| 26133 | Message26133 | unresolved | not implemented |
| 26147 | Message26147 | unresolved | not implemented |
| 26157 | Message26157 | verified | not implemented |
| 26287 | Message26287 | verified | not implemented |
| 26310 | Message26310 | unresolved | not implemented |
| 26360 | PlayerProfileFailed | verified | absent player response |
| 26474 | Message26474 | verified | not implemented |
| 26492 | Message26492 | unresolved | not implemented |
| 26500 | Message26500 | verified | not implemented |
| 26511 | Message26511 | verified | not implemented |
| 26720 | Message26720 | verified | not implemented |
| 26774 | Message26774 | verified | not implemented |
| 26783 | Message26783 | verified | not implemented |
| 26831 | Message26831 | unresolved | not implemented |
| 26980 | CommandBatch | verified | native sector tick/checksum and command broadcast |
| 27029 | Message27029 | verified | not implemented |
| 27050 | Message27050 | verified | not implemented |
| 27072 | Message27072 | verified | not implemented |
| 27109 | Message27109 | unresolved | not implemented |
| 27137 | Message27137 | unresolved | not implemented |
| 27172 | Message27172 | unresolved | not implemented |
| 27224 | Message27224 | verified | not implemented |
| 27361 | Message27361 | unresolved | not implemented |
| 27447 | Message27447 | verified | not implemented |
| 27629 | Message27629 | unresolved | not implemented |
| 27832 | Message27832 | verified | not implemented |
| 27891 | Message27891 | unresolved | not implemented |
| 27914 | Message27914 | verified | not implemented |
| 28089 | Message28089 | verified | not implemented |
| 28100 | Message28100 | unresolved | not implemented |
| 28158 | Message28158 | verified | not implemented |
| 28165 | Message28165 | unresolved | not implemented |
| 28299 | AvatarStream | unresolved | only allocated empty AvatarStream supported; nonempty entry codecs unresolved |
| 28313 | Message28313 | unresolved | not implemented |
| 28356 | Message28356 | unresolved | not implemented |
| 28732 | Message28732 | verified | not implemented |
| 28741 | Message28741 | unresolved | not implemented |
| 28766 | Message28766 | verified | not implemented |
| 28851 | Message28851 | verified | not implemented |
| 28854 | Message28854 | unresolved | not implemented |
| 28887 | Message28887 | verified | not implemented |
| 28921 | Message28921 | unresolved | not implemented |
| 28991 | DeferredGameModeSnapshot | verified native engine | native online world snapshot and reconnect state |
| 29188 | Message29188 | unresolved | not implemented |
| 29461 | Message29461 | verified | not implemented |
| 29531 | Message29531 | verified | not implemented |
| 29561 | Message29561 | unresolved | not implemented |
| 29604 | Message29604 | verified | not implemented |
| 29670 | Message29670 | unresolved | not implemented |
| 29829 | Message29829 | verified | not implemented |
| 29901 | Message29901 | unresolved | not implemented |
| 29949 | Message29949 | verified | not implemented |
| 29957 | Message29957 | verified | not implemented |
| 29991 | Message29991 | unresolved | not implemented |
| 29997 | Message29997 | verified | not implemented |

| Command | Native executor | Wire codec | Runtime support |
| --- | --- | --- | --- |
| 2 | 0x5deac4 | verified subset | native spell validation/execution; owned deck, elixir, legal placement, bounded tick window, duplicate protection |
| 18 | 0x6340d4 | verified | native battle command executor; only valid in its native mode |
| 28 | 0x2ab0b0 | verified | native battle command executor; only valid in its native mode |
| 49 | 0x137614 | verified | native battle command executor; only valid in its native mode |
| 57 | 0x140720 | verified | native battle command executor; only valid in its native mode |
| 203 | 0x3fbc58 | verified | not implemented |
| 235 | 0x68c938 | verified subset | not implemented |
| 252 | 0x585728 | unresolved | not implemented |
| 254 | 0x2c2d68 | verified | not implemented |
| 255 | 0x2e1d94 | verified | not implemented |
| 261 | 0x13e304 | unresolved | not implemented |
| 265 | 0x51c090 | verified | not implemented |
| 278 | 0x29e27c | unresolved | not implemented |
| 287 | 0x66c634 | verified | not implemented |
| 291 | 0x540a30 | verified | not implemented |
| 292 | 0x4680d0 | verified | not implemented |
| 301 | 0x3dc630 | unresolved | not implemented |
| 312 | 0x30270c | verified | not implemented |
| 314 | 0x2e1414 | unresolved | not implemented |
| 320 | 0x206e58 | verified | not implemented |
| 322 | 0x4cfa28 | verified | not implemented |
| 327 | 0x6b2ed0 | unresolved | not implemented |
| 334 | 0x20db10 | unresolved | not implemented |
| 345 | 0x230d04 | unresolved | not implemented |
| 358 | 0x37376c | verified | not implemented |
| 365 | 0x11c4b0 | unresolved | not implemented |
| 368 | 0x6dac0c | verified | not implemented |
| 370 | 0x1c8c18 | verified | not implemented |
| 391 | 0x2be1d8 | unresolved | not implemented |
| 421 | 0x4c0cfc | verified | not implemented |
| 433 | 0x5db6f4 | unresolved | not implemented |
| 440 | 0x5e66bc | unresolved | not implemented |
| 445 | 0x21d784 | unresolved | not implemented |
| 450 | 0x4c0410 | unresolved | not implemented |
| 454 | 0x4535f4 | unresolved | not implemented |
| 469 | 0x3f4180 | verified | not implemented |
| 477 | 0x6dbf30 | unresolved | not implemented |
| 479 | 0x630e54 | verified | not implemented |
| 490 | 0x1a5898 | verified | not implemented |
| 503 | 0x6bb594 | verified | not implemented |
| 521 | 0x1ade8c | verified | not implemented |
| 523 | 0x4c125c | verified | not implemented |
| 527 | 0x370930 | verified | normal matchmaking, native 1v1/2v2, optional labelled bots; event branches unsupported |
| 532 | 0x204678 | verified | not implemented |
| 541 | 0x637c64 | verified | not implemented |
| 547 | 0x6bc17c | verified | not implemented |
| 556 | 0x2a7780 | verified | not implemented |
| 560 | 0x2a54a8 | unresolved | not implemented |
| 562 | 0x63d4e4 | unresolved | not implemented |
| 563 | 0x6750b0 | verified | eight owned deck cards; foreign operations unsupported |
| 565 | 0x40e7d0 | verified | not implemented |
| 571 | 0x4c19f8 | verified | not implemented |
| 577 | 0x48c0f0 | verified | not implemented |
| 580 | 0x32a348 | unresolved | not implemented |
| 581 | 0x181bf0 | verified | not implemented |
| 589 | 0x3ca728 | unresolved | not implemented |
| 590 | 0x425060 | verified | not implemented |
| 593 | 0x49fa74 | unresolved | not implemented |
| 595 | 0x59b664 | verified | only Arena1 ChestSpeedUp reference [54,1], false flag |
| 596 | 0x1e83fc | verified | not implemented |
| 602 | 0x119b48 | verified | not implemented |
| 616 | 0x220678 | unresolved | not implemented |
| 622 | 0x39ef20 | verified | not implemented |
| 623 | 0x538b40 | unresolved | not implemented |
| 628 | 0x107144 | verified | not implemented |
| 638 | 0x43fcec | verified | not implemented |
| 640 | 0x4c3db8 | unresolved | not implemented |
| 650 | 0x12c84c | verified | not implemented |
| 653 | 0x5cf4ec | verified | not implemented |
| 656 | 0x121030 | verified | not implemented |
| 658 | 0x448d1c | verified | not implemented |
| 660 | 0x3dc314 | verified | not implemented |
| 664 | 0x4719a4 | verified | not implemented |
| 668 | 0x1a8d98 | verified | not implemented |
| 670 | 0x69e5f4 | verified | not implemented |
| 676 | 0x1b586c | verified | not implemented |
| 682 | 0x359e2c | verified | not implemented |
| 687 | 0x1be468 | verified | three gold resource packs from table 55 |
| 691 | 0x4a4b0c | verified | not implemented |
| 693 | 0x49a670 | verified | manual active-card swap or indexed inventory replacement |
| 696 | 0x59a0bc | verified | not implemented |
| 703 | 0x32f870 | verified | select one of five persisted decks |
| 705 | 0x65b778 | verified | not implemented |
| 715 | 0x4521f8 | verified | not implemented |
| 716 | 0x5d63b4 | unresolved | not implemented |
| 717 | 0x485148 | verified | not implemented |
| 723 | 0x61433c | verified | not implemented |
| 732 | 0x6e34f4 | unresolved | not implemented |
| 738 | 0x63a510 | verified | not implemented |
| 742 | 0x32f090 | verified | not implemented |
| 744 | 0x60520c | verified | not implemented |
| 751 | 0x347c54 | unresolved | not implemented |
| 762 | 0x460fac | verified | persist seen crowns monotonically up to server-stored earned crowns; never grants crowns or rewards |
| 775 | 0x4296d0 | verified | not implemented |
| 780 | 0x63798c | verified | not implemented |
| 783 | 0x545570 | verified | not implemented |
| 798 | 0x69d39c | unresolved | not implemented |
| 804 | 0x58bad0 | verified | not implemented |
| 805 | 0x474628 | verified | unchanged level-one synchronization only |
| 810 | 0x1dd900 | unresolved | not implemented |
| 819 | 0x112f28 | verified | not implemented |
| 820 | 0x4493d8 | unresolved | not implemented |
| 827 | 0x6655a8 | verified | not implemented |
| 834 | 0x578044 | verified | not implemented |
| 835 | 0x6e3694 | verified | not implemented |
| 836 | 0x1d14cc | verified | free tier zero (crown selectors 0..9), current pass, non-premium: 500 gold, cap and persistent claim |
| 837 | 0x4414e8 | verified | not implemented |
| 839 | 0x644904 | verified | not implemented |
| 841 | 0x59b170 | verified | not implemented |
| 845 | 0x63d8d8 | verified | not implemented |
| 852 | 0x2cba3c | verified | not implemented |
| 863 | 0x2c0e9c | verified | not implemented |
| 869 | 0x59ed34 | verified | set one of Home flag bits 1..4 |
| 870 | 0x15af10 | verified | not implemented |
| 875 | 0x59a2e4 | verified | not implemented |
| 885 | 0x315544 | unresolved | not implemented |
| 888 | 0x5dcb38 | verified | not implemented |
| 911 | 0x3601ec | unresolved | not implemented |
| 912 | 0x2c5320 | unresolved | not implemented |
| 914 | 0x3e140c | unresolved | not implemented |
| 921 | 0x4472a4 | verified | not implemented |
| 926 | 0x237fe8 | verified | not implemented |
| 929 | 0x4263d4 | unresolved | not implemented |
| 947 | 0x1c68cc | verified | not implemented |
| 948 | 0x19b0a0 | verified | initial free naming only; later renames unsupported |
| 959 | 0x38875c | unresolved | not implemented |
| 963 | 0x139cf4 | unresolved | not implemented |
| 965 | 0x18c78c | unresolved | not implemented |
| 966 | 0x741720 | verified | not implemented |
| 967 | 0x2c2b08 | verified | not implemented |
| 968 | 0x1e6538 | verified | not implemented |
| 981 | 0x241b80 | unresolved | not implemented |
| 987 | 0x17152c | verified | not implemented |
| 988 | 0x755660 | unresolved | not implemented |
| 990 | 0x2d3b28 | verified | not implemented |

# سرور پروتکل Clash Royale 3.1.0

این نسخه در nodebrawl-core، بر اساس کتابخانهٔ ARM64 و APK ارسالی ساخته شده است. **هنوز سرور کامل و قابل‌بازی نیست:** وضعیت معتبر بازیکن و Home، handlerهای بازی و شبیه‌سازی نبرد کامل نشده‌اند.

- کاتالوگ ۲۸۴ شناسه و ۱۵۹ کدک پیام؛ قالب‌ها با encoder/decoder اصلی کتابخانه بررسی شده‌اند.
- دریافت TCP تکه‌تکه، چند فریم در یک دریافت، محدودیت صف/اندازه، heartbeat و ذخیرهٔ اتمی حساب‌ها.
- انتقال اختیاری `nacl17`: Login رمز‌شده، LoginOk/LoginFailed رمز‌شده و کلید/nonce مستقل پیام‌های بعدی.
- اسکریپت Frida برای ثبت اتصال، تغییر آدرس و تنظیم اختیاری کلید عمومی سرور توسعه.
- مسیر رمزنگاری و تنظیم کلید با توابع اصلی کتابخانه در Unicorn آزموده شده؛ اسکریپت فعلی برای حفظ checksum از Stalker استفاده می‌کند. تأیید آن روی Android هنوز لازم است.

## دریافت و اجرا

Node.js 18 یا بالاتر نیاز است. نصب ابزارهای توسعه با Yarn Classic و lockfile موجود:

```bash
git pull origin main
yarn install --frozen-lockfile --non-interactive
npm test
npm run lint
```

برای آزمون اتصال رمز‌شده، سرور را روی کامپیوتر یا سرور خود اجرا کنید:

```bash
TRANSPORT=nacl17 HOST=0.0.0.0 PORT=9339 npm start
```

معادل در Windows CMD:

```bat
set TRANSPORT=nacl17
set HOST=0.0.0.0
set PORT=9339
npm start
```

در اولین اجرا، کلید سرور در `.local/server-key.json` ساخته می‌شود. کلید خصوصی داخل Git نیست؛ آن فایل را بین اجراها نگه دارید. کنسول فقط **کلید عمومی** را نشان می‌دهد.

برای آزمون داخلی از ترمینال دیگر، کلید عمومی چاپ‌شده را جایگزین کنید:

```bash
SERVER_PUBLIC_KEY="PUBLIC_KEY_FROM_SERVER" node tools/smoke-client.js
```

بدون تنظیم `TRANSPORT`، سرور plaintext است و با `node tools/smoke-client.js` آزموده می‌شود. حالت plaintext به کلاینتی با تغییرات متناسب نیاز دارد.

**سرور پیش‌فرض Home معتبر ندارد.** پاسخ فعلی، LoginFailed با توضیح نبودن provider سازگار است. آزمون smoke همین پاسخ را بررسی می‌کند؛ نتیجهٔ آن ورود به بازی نیست.

## آزمون دستگاه با Frida

اسکریپت آمادهٔ `client-dev.js` در ریشهٔ ریپازیتوری، برای سرور `223.223.223.1:9339` و کلید عمومی `b82bd01df81e8eba890cb3659d2b2f083a47717dc8159106380ca146bb8b9745` تنظیم شده است. اگر کنسول سرور همین کلید عمومی را نشان می‌دهد، پس از دریافت تغییرات مستقیماً اجرا کنید؛ دانلود فایل جداگانه از چت لازم نیست:

```bat
frida -U -f com.supercell.clashroyale -l client-dev.js -o frida-network.log
```

این فایل با `tools/make-client-trace.js` از سورس‌های ریپازیتوری ساخته شده و کلید خصوصی ندارد. برای آدرس یا کلید عمومی متفاوت، اسکریپت خودتان را طبق دستور زیر بسازید. فایل `.local/server-key.json` قبلی سرور را نگه دارید تا کلید عوض نشود.

در دستور زیر، `192.168.1.10` را با IPv4 قابل دسترس سرورتان و `PUBLIC_KEY_FROM_SERVER` را با کلید عمومی کنسول جایگزین کنید:

```bash
node tools/make-client-trace.js --host 192.168.1.10 --port 9339 --server-public-key "PUBLIC_KEY_FROM_SERVER" --output .local/client-jni.js
frida -U -f com.supercell.clashroyale -l .local/client-jni.js -o .local/frida-jni.log
```

**اسکریپت قدیمی را حذف/غیرفعال کنید و نسخهٔ تازه بسازید.** هم‌زمان دو اسکریپت را بارگذاری نکنید. گزارش کرش دستگاه نشان داد هوک‌های مستقیم قبلی در محدوده‌های checksum بازی قرار می‌گرفتند و بررسی یکپارچگی به مسیر کرش `libg+0x514b30` می‌رسید. نسخهٔ جدید هیچ هوک مستقیمی در کد `libg.so` نصب نمی‌کند؛ Stalker فقط نسخهٔ اجرایی موقت را ابزارگذاری می‌کند و checksumهای بازی غیرفعال نمی‌شوند.

نسخهٔ بعدی که کل GLThread را دنبال می‌کرد نیز روی Android 14 با Frida 17.15.4 در مسیر مفسر ART کرش کرد. نسخهٔ JNI بعد از آن روی گوشی باز ماند، ولی پیام Login به سرور رسید بدون اینکه رویداد تنظیم کلید ثبت شود. نسخهٔ `network-v2` دو صف `Messaging` را پوشش داد و ClientHello را مشاهده کرد، اما worker خواندن اتصال و مسیر ساخت Login داخل دریافت ServerHello را پوشش نمی‌داد. **نسخهٔ فعلی `network-v3` علاوه بر اجرای بومی `GameApp.update()`، دو صف `Messaging` و worker خواندن اتصال متعلق به آن را پوشش می‌دهد.** آرگومان ورودی این workerها در `pthread_create` جایگزین می‌شود؛ کد کتابخانه و tuple اصلی thread تغییر نمی‌کنند. کتابخانهٔ ART و سایر کتابخانه‌ها از ردیابی کنار گذاشته شده‌اند. اسکریپت باید با `-f` و پیش از ساخت workerها بارگذاری شود.

برای `nacl17`، **کلید عمومی سرور** چاپ‌شده در کنسول را در `--server-public-key` قرار دهید؛ کلید جداگانه‌ای به نام «کلید کلاینت» لازم نیست. بازی جفت‌کلید موقت خودش را می‌سازد. کلید خصوصی `.local/server-key.json` را در اسکریپت یا لاگ قرار ندهید. در صورت عوض‌شدن کلید سرور، اسکریپت را با کلید عمومی جدید دوباره بسازید.

تنظیم کلید فقط در پردازش جاری انجام می‌شود. Stalker آرگومان کلید مشترک و nonce را در دو مسیر ساخت Login و مسیر بازکردن پاسخ تغییر می‌دهد؛ رمزنگاری پیام‌های جلسه به توابع خود بازی سپرده می‌شود. یک کپی از جدول JNI به `RegisterNatives` داده می‌شود تا اجرای `update()` از یک wrapper عبور کند؛ جدول اصلی تغییر نمی‌کند. پس از بازشدن نخستین پاسخ، ردیابی همهٔ workerهای فعال و فریم فعال متوقف می‌شود. اتصال تازه، workerهای بومی موجود را دوباره فعال می‌کند. ردیابی GLThread هنگام اجرای Java یا مفسر انجام نمی‌شود. این مرحله ممکن است کندتر اجرا شود. سازندهٔ واقعی `Messaging` و شاخهٔ موفق اتصال با adapterهای سیستم‌عامل در Unicorn اجرا شده‌اند؛ رفتار نسخهٔ جدید روی گوشی و UI هنوز تأیید نشده است.

اسکریپت معماری ARM64، ELF build ID و بایت‌های محل callها و ورودی workerها را کنترل می‌کند. در خروجی جدید `diagnostics:"network-v3"` و `tracingScope:"messaging-workers-and-jni-update"`، سپس `messaging-worker-registered` و `messaging-worker-scope-started` برای roleهای `events`، `send` و `socket` را بررسی کنید. رویدادهای `development-peer-shared`، `development-peer-seal-result` و `development-peer-open-result` اعمال تنظیم و نتیجهٔ توابع رمزنگاری را نشان می‌دهند؛ `path:"server-hello-login"` مسیر ساخت مستقیم Login هنگام دریافت ServerHello است. `result:0` موفقیت همان تابع است و به‌تنهایی به معنای ورود به بازی نیست. اگر `development-peer-error` دیده شد، متن همان رویداد را گزارش کنید. فایل خروجی `-o` متعلق به Frida است؛ logcat معمولی این رویدادهای JavaScript را ثبت نمی‌کند. کلید خصوصی، توکن حساب و بدنهٔ پیام‌ها ثبت نمی‌شوند.

برای آزمون اتصال با **فقط هوک‌های libc**، دستور تولید را بدون `--server-public-key` و با نام خروجی تازه اجرا کنید. در این حالت نه Stalker فعال است و نه هوکی در `libg.so` نصب می‌شود؛ کلید بازی عوض نمی‌شود و ورود با `nacl17` سرور توسعه انتظار نمی‌رود. برای حفظ آدرس فعلی بازی، `--host` را هم حذف کنید. خروجی موجود بازنویسی نمی‌شود؛ برای اسکریپت تازه، نام خروجی تازه انتخاب کنید.

### اتصال برقرار است ولی بارگذاری جلو نمی‌رود

`game-connect-result` با `result:0` فقط برقراری TCP را تأیید می‌کند. نسخهٔ JNI روی دستگاه کاربر تا این مرحله پیش رفت و بازی باز ماند؛ هنوز ورود واقعی تأیید نشده است. برای ثبت سمت سرور، در Windows CMD پیش از `npm start` اجرا کنید:

```bat
set TRACE_NETWORK=1
```

سرور اکنون `connection-open`، شمار بایت‌های دریافتی، `message-received` و `message-sent` را با یک `connectionId` ثبت می‌کند. ترتیب مورد انتظار شامل دریافت `10100`، ارسال `20100`، دریافت `10101` و در نبود Home ارسال `20103` است. اتصال ساکت بعد از ۳۰ ثانیه با `reason:"idle-timeout"` و شمار بایت/فریم بسته می‌شود. پیام `Home data missing` به‌تنهایی گزارشی از دریافت Login نیست.

اگر سرور `10101` را با `Ciphertext authentication failed` گزارش کند ولی Frida هیچ `development-peer-shared` یا `development-peer-seal` نداشته باشد، تنظیم کلید در مسیر رمزنگاری مشاهده نشده است؛ صرف ثبت `development-peer-enabled` موفقیت آن را ثابت نمی‌کند. در نسخهٔ فعلی، آماده‌بودن Login پیش از ServerHello نیز در آزمون بومی پوشش داده شده است: Login رمز‌شده توسط Node پذیرفته شد و پاسخ رمز‌شدهٔ Node توسط parser اصلی کتابخانه باز شد. این آزمون اجرای Android نیست. خط `Home data missing` علت شکست MAC نیست؛ پس از handshake موفق، نبود Home همچنان موجب LoginFailed می‌شود.

رویدادهای `native-client-hello-encode`، `native-messaging-state` و `native-login-build` مرحلهٔ بومی را مشخص می‌کنند. `native-frame-returned` و `native-frame-complete` پایان تابع و پایان ردیابی آن را جداگانه نشان می‌دهند. آزادسازی contextهای Stalker با تأخیر روی thread اسکریپت انجام می‌شود. ثبت سوکت، `send/recv`، `sendto/recvfrom` و `write/read` را پوشش می‌دهد؛ فراخوانی‌های تو‌در‌تو دوبار شمرده نمی‌شوند. شمار صفر این ابزار به‌تنهایی نبود ترافیک را ثابت نمی‌کند؛ گزارش واقعی دریافت سرور اولویت دارد. بدنهٔ پکت، توکن حساب و کلید خصوصی ثبت نمی‌شوند.

اسکریپت تازه را با نام خروجی تازه بسازید، بازی را از ابتدا با `-f` اجرا کنید و خروجی Frida و سرور را از شروع اتصال تا حداقل ۳۵ ثانیه ثبت کنید. این گزارش‌ها اتصال به listener اشتباه، اتصال بدون ClientHello و توقف پس از ServerHello را از هم قابل تشخیص می‌کنند.

## تنظیمات و توسعه

| متغیر | پیش‌فرض / کاربرد |
| --- | --- |
| `TRANSPORT` | `plaintext` یا `nacl17` |
| `HOST` | `127.0.0.1` |
| `PORT` | `9339` |
| `DATA_DIR` | `.local/accounts`؛ یک پردازش برای هر دیتابیس |
| `SERVER_KEY_PATH` | `.local/server-key.json` در حالت `nacl17` |
| `TRACE_NETWORK` | `1` برای ثبت رویدادهای اتصال و مشخصات پکت؛ پیش‌فرض خاموش |
| `HOME_TEMPLATE_PATH` | مسیر قالب Home معتبر؛ اختیاری |

قالب Home شامل `librarySha256` مطابق پروفایل، `messageId: 21217`، `version`، `payloadHex`، `payloadSha256` و `accountIdOffsets` است. offsetها باید محل واقعی Long هشت‌بایتی شناسهٔ حساب باشند. بررسی checksum صحت فایل را می‌سنجد؛ سازگاری با بازی نیازمند آزمون جداگانه است.

برای توسعه، `createGameServer` از `server/core.js`، `AccountStore`، `homeProvider`، handlerهای شناسه‌محور در `Map` و `transportFactory` در دسترس‌اند. فیلدهای هنوز نام‌گذاری‌نشده با offset واقعی مثل `field_0x80` ثبت شده‌اند. داشتن کدک به معنای پیاده‌سازی منطق پیام نیست. پکت‌های بدون handler با وضعیت unsupported گزارش می‌شوند.

```bash
node tools/packets.js
node tools/packets.js --json
```

فایل‌های قدیمی `Protocol/` و `ByteStream/` حفظ شده‌اند؛ ورودی برنامه سرور جدید `server/` را اجرا می‌کند.

## شواهد و تحلیل

نسخه از AndroidManifest تأیید شده: `com.supercell.clashroyale`، نسخهٔ `3.1.0`، build `400`. نسخهٔ محتوا در fingerprint برابر `3.1945.13` است. کتابخانهٔ داخل APK دقیقاً برابر نسخهٔ رمزگشایی‌شدهٔ رشته‌های فایل اصلی است. ۱۴۹ جدول CSV باز شد، هش ۱۰۷۵ فایل موجود تطبیق داشت و ۱۲۵ فایل فهرست‌شده در APK نبودند.

```bash
python3 tools/apk-transfer.py join /path/client.apk.manifest.json --parts-directory /path/parts --output .local/client.apk
python3 tools/inspect-apk.py .local/client.apk --output .local/apk
python3 tools/apk_data.py .local/apk --output .local/game-data
python3 -m unittest discover -s test/python -v
```

خروجی `game-data.json` شامل ستون‌ها، نوع‌ها، نام رکوردها و هش جدول‌ها است. assets اصلی داخل Git کپی نشده‌اند.

Home خالیِ استانداردشدهٔ ۴۱۶ بایتی با encoder و decoder اصلی رفت‌وبرگشت پایدار دارد. حالت تنظیم کلید توسعه نیز در مدل بومی، Login ساخته‌شده با توابع اصلی را در Node باز کرده و پاسخ رمز‌شدهٔ Node شامل LoginOk، همین Home خالی و KeepAlive را در parser اصلی خوانده است. Home خالی هنوز وضعیت معتبر قابل‌بازی نیست و به سرور پیش‌فرض وصل نشده است.

۳۹۱ آزمون Node، هفت آزمون ابزار APK و lint پاس شده‌اند. wrapper واقعی نیز با Frida 17.15.4 روی Linux x86-64 آزموده شد: دو بار ورود/خروج از تابع بومی، کپی جدول، تغییر آرگومان و پایان ردیابی پس از خروج بررسی شدند. این آزمون جای Android/ARM64 را نمی‌گیرد. آزمون‌های TCP از Home مصنوعی استفاده می‌کنند؛ آزمون‌های Unicorn اجرای Android نیستند. [گزارش توابع، شواهد و محدودیت‌ها](docs/compatibility.md) جزئیات و دستور بازتولید تحلیل بومی را ثبت می‌کند.

# سرور پروتکل Clash Royale 3.1.0

این نسخه در nodebrawl-core، بر اساس کتابخانهٔ ARM64 و APK ارسالی ساخته شده است. **هنوز سرور کامل و قابل‌بازی نیست:** وضعیت معتبر بازیکن و Home، handlerهای بازی و شبیه‌سازی نبرد کامل نشده‌اند.

- کاتالوگ ۲۸۴ شناسه و ۱۵۹ کدک پیام؛ قالب‌ها با encoder/decoder اصلی کتابخانه بررسی شده‌اند.
- دریافت TCP تکه‌تکه، چند فریم در یک دریافت، محدودیت صف/اندازه، heartbeat و ذخیرهٔ اتمی حساب‌ها.
- انتقال اختیاری `nacl17`: Login رمز‌شده، LoginOk/LoginFailed رمز‌شده و کلید/nonce مستقل پیام‌های بعدی.
- اسکریپت Frida برای ثبت اتصال، تغییر آدرس و تنظیم اختیاری کلید عمومی سرور توسعه.
- مسیر رمزنگاری و تنظیم کلید با توابع اصلی کتابخانه در Unicorn آزموده شده؛ اجرای واقعی Frida روی Android هنوز تأیید نشده است.

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

در اولین اجرا، کلید سرور در `.local/server-key.json` ساخته می‌شود. کلید خصوصی داخل Git نیست؛ آن فایل را بین اجراها نگه دارید. کنسول فقط **کلید عمومی** را نشان می‌دهد.

برای آزمون داخلی از ترمینال دیگر، کلید عمومی چاپ‌شده را جایگزین کنید:

```bash
SERVER_PUBLIC_KEY="PUBLIC_KEY_FROM_SERVER" node tools/smoke-client.js
```

بدون تنظیم `TRANSPORT`، سرور plaintext است و با `node tools/smoke-client.js` آزموده می‌شود. حالت plaintext به کلاینتی با تغییرات متناسب نیاز دارد.

**سرور پیش‌فرض Home معتبر ندارد.** پاسخ فعلی، LoginFailed با توضیح نبودن provider سازگار است. آزمون smoke همین پاسخ را بررسی می‌کند؛ نتیجهٔ آن ورود به بازی نیست.

## آزمون دستگاه با Frida

در دستور زیر، `192.168.1.10` را با IPv4 قابل دسترس سرورتان و `PUBLIC_KEY_FROM_SERVER` را با کلید عمومی کنسول جایگزین کنید:

```bash
node tools/make-client-trace.js --host 192.168.1.10 --port 9339 --server-public-key "PUBLIC_KEY_FROM_SERVER" --output .local/client-dev.js
frida -U -f com.supercell.clashroyale -l .local/client-dev.js
```

تنظیم کلید فقط در پردازش جاری بازی انجام می‌شود. فایل APK یا `.so` روی دیسک تغییر نمی‌کند. این حالت، آرگومان کلید مشترک و nonce را در چهار محل مشخصِ مسیر handshake تغییر می‌دهد؛ رمزنگاری پیام‌های جلسه را به توابع خود بازی می‌سپارد. همان تغییر آرگومان‌ها در مدل بومی با سرور Node آزموده شده‌اند؛ نصب hookها و رفتار UI روی Android هنوز نیازمند آزمون دستگاه است.

اسکریپت پیش از hookها معماری ARM64، ELF build ID و بایت‌های محل توابع را کنترل می‌کند. رویدادهای `library-profile-matched`، `development-peer-enabled`، `game-connect`، `login-encode` و `authenticated-open-leave` برای بررسی اتصال مفیدند. کلید خصوصی، توکن حساب و بدنهٔ پیام‌ها ثبت نمی‌شوند.

برای ثبت اتصال بدون تنظیم کلید، `--server-public-key` را حذف کنید. برای حفظ آدرس فعلی بازی، `--host` را هم حذف کنید. تغییر آدرس به‌تنهایی، کلاینت رسمی را با کلید سرور توسعه سازگار نمی‌کند. خروجی موجود بازنویسی نمی‌شود؛ برای اسکریپت تازه، نام خروجی تازه انتخاب کنید.

## تنظیمات و توسعه

| متغیر | پیش‌فرض / کاربرد |
| --- | --- |
| `TRANSPORT` | `plaintext` یا `nacl17` |
| `HOST` | `127.0.0.1` |
| `PORT` | `9339` |
| `DATA_DIR` | `.local/accounts`؛ یک پردازش برای هر دیتابیس |
| `SERVER_KEY_PATH` | `.local/server-key.json` در حالت `nacl17` |
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

۳۸۱ آزمون Node، هفت آزمون ابزار APK و lint پاس شده‌اند. آزمون‌های TCP از Home مصنوعی استفاده می‌کنند؛ آزمون‌های Unicorn اجرای Android نیستند. [گزارش توابع، شواهد و محدودیت‌ها](docs/compatibility.md) جزئیات و دستور بازتولید تحلیل بومی را ثبت می‌کند.

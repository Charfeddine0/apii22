# API-CHAT

أداة بسيطة لتشغيل خادم Express يفتح جلسة ChatGPT عبر Puppeteer ويولّد ردًا على أي محتوى ترسله عبر نقاط `/generate` للمقالات و`/image` للصور.

## المتطلبات
- Node.js 18 أو أحدث
- يمكن ضبط عنوان ChatGPT عبر متغيّر البيئة `CHATGPT_URL` (يجب أن يبدأ بـ `https://`). إذا لم يُحدّد فسيتم استخدام القيمة الموجودة في `config.json` أو الافتراضية `https://chatgpt.com/`.
- يمكن تشغيل Puppeteer في الوضع الخفي عبر المتغيّر `HEADLESS_MODE` (القيم المسموحة: `true`، `false`، أو `new` للحصول على Headless الجديد في Chromium). إذا لم يُحدّد فسيتم استخدام القيمة الموجودة في `config.json` أو الافتراضية `new`.
- ملف كوكيز اختياري `cookies.json` في جذر المشروع لتجاوز تسجيل الدخول إذا لزم الأمر.

## التثبيت
```bash
npm install
```

## التشغيل
```bash
npm start
```
ستجد الخادم يعمل على `http://localhost:3002` ويشغّل متصفحًا في وضع Headless (إلا إذا غيّرت الإعدادات).

### تغيير وضع التشغيل إلى Headless
- عبر المتغيّر:
  ```bash
  HEADLESS_MODE=true npm start
  ```
- أو من خلال `config.json`:
  ```json
  {
    "chatgpt_url": "https://chatgpt.com/",
    "headless": "new"
  }
  ```
سيتم تسجيل الوضع الفعلي في سجلّ التشغيل عند بدء المتصفّح.

## الاستخدام
### توليد مقالات عبر `/generate`
أرسل نص البرومبت مباشرة في الـ body (نص عادي) أو داخل JSON يحتوي على `prompt`:
```bash
curl -X POST http://localhost:3002/generate \
  -H "Content-Type: application/json" \
  -d '{"prompt":"اكتب لي ملخصًا عن الذكاء الاصطناعي"}'
```
ستحصل على JSON يحتوي على الحقل `generated` بالنص الذي أعاده ChatGPT، بدون تنزيل أو حفظ للصور.

### توليد صور عبر `/image`
للحصول على روابط صور محفوظة، استخدم نقطة `/image` بنفس الطريقة:
```bash
curl -X POST http://localhost:3002/image \
  -H "Content-Type: application/json" \
  -d '{"prompt":"اصنع لي صورة لمنظر طبيعي"}'
```
سيتم تنزيل أي صور تظهر في الرد، حفظها داخل المجلد `image/` في جذر المشروع، وإرجاعها كالتالي:

```json
{
  "success": true,
  "generated": "وصف الصورة...",
  "images": [
    {
      "url": "/image/image-1710000000000-1.png",
      "source": "blob:https://chatgpt.com/…"
    }
  ]
}
```

يمكنك الوصول للصورة عبر نفس عنوان الخادم، مثلًا `http://localhost:3002/image/image-1710000000000-1.png`.

# AKKAD — إصدار Android مزدوج

## المستخدم الأفقي
المسار `android/app`. شاشة كاملة إجبارية `landscape` مع مشغل Media3/ExoPlayer؛ يدعم HLS وMPEG-TS وملفات الفيديو التي يستطيع نظام الجهاز فك ترميزها. تسجيل VIP أو الكود يعمل وفق صلاحيات الخادم.

## الإدارة العمودية
المسار `android/control`. حزمة مستقلة `iq.akkad.control`، شاشة ثابتة `portrait` تعرض إدارة المصادر، الحسابات، الأكواد، الباقات، TMDb، وفحص التشغيل.

## بناء نسختَي APK
يستخدم GitHub Actions:
```
gradle -p android :app:assembleDebug :control:assembleDebug --no-daemon
```
الملفات الناتجة:
- `android/app/build/outputs/apk/debug/app-debug.apk`
- `android/control/build/outputs/apk/debug/control-debug.apk`

هذه نسخ اختبار بتوقيع Android Debug ولا تحافظ على هوية توقيع إنتاج ثابت بين عمليات البناء. لا تضع مفاتيح التوقيع داخل المستودع.
لنسخ Release اضبط `AKKAD_SIGNING_STORE_FILE`, `AKKAD_SIGNING_STORE_PASSWORD`, `AKKAD_SIGNING_KEY_ALIAS`, `AKKAD_SIGNING_KEY_PASSWORD` في بيئة بناء آمنة.

النسختان تحملان نفس بيانات الخادم عبر HTTPS. لا يمكن إجبار كل مزود على العمل إذا كان رابط البث الأصلي منتهياً أو لا يقبل اتصالات Railway، ولا يمكن ضمان صوت MKV على كل أجهزة فك الترميز.

# أكّد TV — Android TV

تطبيق Android بواجهة مستخدم أفقية إجبارية، يدعم الهواتف الأفقية وAndroid TV وأجهزة الريموت.

## تنفيذ قائم
- الحزمة: `iq.akkad.tv.preview` للاختبار؛ الإصدار النهائي: `iq.akkad.tv`.
- `TvActivity` بنمط Immersive Fullscreen و`screenOrientation=landscape`.
- هوية أكّد الفضائية زرقاء/بنفسجية، مع واجهة المستخدم الحالية من `https://akkad-core-production.up.railway.app/tv`.
- المشغل الأصلي Media3/ExoPlayer لتشغيل الفيديو بعد التحقق من صلاحية الرابط والنطاق ومسار `/api/media/`.
- تكامل اتجاهات الريموت والأسهم مع واجهة الويب، وعدم منح أذونات للكاميرا/الميكروفون.
- منع أخذ لقطة شاشة/التسجيل من داخل نافذة APK عبر `FLAG_SECURE`، مع العلم أنه لا يمنع نسخ ملف APK نفسه.
- لا تحفظ مفاتيح مزودي Xtream أو صلاحيات الخادم ضمن APK.

## البناء التجريبي
يقوم GitHub Actions بتنفيذ `gradle -p android :app:assembleDebug` وإرفاق `app-debug.apk` في Artifact باسم `akkadtv-landscape-preview-apk`.
هذه نسخة اختبارية تحمل توقيع Android Debug، وهي **ليست توقيع إصدار ثابتاً**، وقد يختلف توقيعها بين تشغيلات CI.

## التوقيع النهائي الثابت
يجب إعداد ملف keystore خاص وغير مرفوع إلى مستودع GitHub العام، واستخدام هذه المتغيرات الآمنة عند بناء Release:

```text
AKKAD_SIGNING_STORE_FILE
AKKAD_SIGNING_STORE_PASSWORD
AKKAD_SIGNING_KEY_ALIAS
AKKAD_SIGNING_KEY_PASSWORD
```

نسخة Release: `gradle -p android :app:assembleRelease`.
يجب الاحتفاظ بنسخة احتياطية آمنة من keystore وكلمات المرور؛ لا يمكن ضمان تحديث نفس حزمة الإصدار عند فقد توقيعها.

## الاختبارات
`npm test` يتحقق من مكونات الواجهة وصلاحية المسارات، ولا يغني عن اختبار التشغيل على هاتف وجهاز Android TV حقيقيين.

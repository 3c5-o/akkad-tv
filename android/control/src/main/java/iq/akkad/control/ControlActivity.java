package iq.akkad.control;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.os.Build;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import android.view.View;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.SslErrorHandler;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.net.http.SslError;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * AKKAD admin: fixed portrait view with connection recovery and an Android Keystore
 * encrypted refresh token. Authentication and admin authorization stay server-side.
 */
public final class ControlActivity extends Activity {
    private static final String CIPHER_ALIAS = "AKKAD_CONTROL_REFRESH_KEY_2026";
    private static final String SECRET_PREF = "refresh_encrypted";
    private WebView web;
    private FrameLayout root;
    private LinearLayout offlineOverlay;
    private TextView offlineMessage;
    private boolean pageFailed;
    private volatile boolean trustedPage;
    private long lastBackAt;
    private final Uri trusted = Uri.parse(BuildConfig.CONTROL_URL);

    private boolean trustedUrl(Uri uri) {
        return uri != null
            && "https".equalsIgnoreCase(uri.getScheme())
            && trusted.getHost() != null
            && trusted.getHost().equalsIgnoreCase(uri.getHost())
            && (uri.getPort() == -1 || uri.getPort() == 443);
    }

    private synchronized SecretKey encryptionKey() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        if (!store.containsAlias(CIPHER_ALIAS)) {
            KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
            generator.init(new KeyGenParameterSpec.Builder(CIPHER_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256).build());
            generator.generateKey();
        }
        return ((KeyStore.SecretKeyEntry) store.getEntry(CIPHER_ALIAS, null)).getSecretKey();
    }

    private SharedPreferences secretStorage() {
        return getSharedPreferences("akkad_control_auth", MODE_PRIVATE);
    }

    private final class SessionBridge {
        @JavascriptInterface
        public String getRefreshToken() {
            if (!trustedPage) return "";
            try {
                String payload = secretStorage().getString(SECRET_PREF, "");
                if (payload == null || payload.isEmpty()) return "";
                String[] parts = payload.split("\\.", 2);
                if (parts.length != 2) return "";
                Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
                cipher.init(Cipher.DECRYPT_MODE, encryptionKey(),
                    new GCMParameterSpec(128, Base64.decode(parts[0], Base64.NO_WRAP)));
                return new String(cipher.doFinal(Base64.decode(parts[1], Base64.NO_WRAP)),
                    StandardCharsets.UTF_8);
            } catch (Exception ignored) { return ""; }
        }

        @JavascriptInterface
        public boolean saveRefreshToken(String value) {
            if (!trustedPage || value == null || value.length() < 10 || value.length() > 4096) return false;
            try {
                Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
                cipher.init(Cipher.ENCRYPT_MODE, encryptionKey());
                String payload = Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP) + "."
                    + Base64.encodeToString(cipher.doFinal(value.getBytes(StandardCharsets.UTF_8)), Base64.NO_WRAP);
                return secretStorage().edit().putString(SECRET_PREF, payload).commit();
            } catch (Exception ignored) { return false; }
        }

        @JavascriptInterface
        public void clearRefreshToken() {
            if (trustedPage) secretStorage().edit().remove(SECRET_PREF).apply();
        }
    }

    private void showOffline(String reason) {
        offlineMessage.setText(reason + "\n\nلن تُحذف بيانات الدخول بسبب انقطاع الشبكة.");
        offlineOverlay.setVisibility(View.VISIBLE);
    }

    private void retry() {
        pageFailed = false;
        offlineOverlay.setVisibility(View.GONE);
        if (web != null) web.loadUrl(BuildConfig.CONTROL_URL);
    }

    @Override
    @SuppressLint("SetJavaScriptEnabled")
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        getWindow().setStatusBarColor(0xFF050B1E);
        getWindow().setNavigationBarColor(0xFF050B1E);

        root = new FrameLayout(this);
        root.setBackgroundColor(Color.rgb(5, 11, 30));
        web = new WebView(this);
        web.setBackgroundColor(Color.rgb(5, 11, 30));
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        web.setOnLongClickListener(v -> true);

        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setSupportMultipleWindows(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSaveFormData(false);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) settings.setSafeBrowsingEnabled(true);

        web.addJavascriptInterface(new SessionBridge(), "AkkadAdminSession");
        web.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageStarted(WebView view, String url, android.graphics.Bitmap icon) {
                trustedPage = trustedUrl(Uri.parse(url));
                pageFailed = false;
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return !trustedUrl(request.getUrl());
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) {
                    pageFailed = true;
                    showOffline("تعذر تحميل لوحة الإدارة. تحقق من الإنترنت واتصال Railway.");
                }
            }

            @Override
            public void onReceivedHttpError(WebView view, WebResourceRequest request,
                                            WebResourceResponse response) {
                if (request.isForMainFrame() && response.getStatusCode() >= 500) {
                    pageFailed = true;
                    showOffline("خادم أكد لا يستجيب حالياً (HTTP " + response.getStatusCode() + ")");
                }
            }

            @Override
            public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
                handler.cancel();
                pageFailed = true;
                showOffline("فشل تأمين اتصال HTTPS. تحقق من الوقت والتاريخ أو اتصال الإنترنت.");
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                if (!pageFailed && trustedUrl(Uri.parse(url))) offlineOverlay.setVisibility(View.GONE);
            }
        });
        web.setWebChromeClient(new WebChromeClient() {});
        root.addView(web, new FrameLayout.LayoutParams(-1, -1));

        offlineOverlay = new LinearLayout(this);
        offlineOverlay.setOrientation(LinearLayout.VERTICAL);
        offlineOverlay.setGravity(android.view.Gravity.CENTER);
        offlineOverlay.setPadding(30, 30, 30, 30);
        offlineOverlay.setBackgroundColor(Color.rgb(7, 17, 43));
        offlineOverlay.setVisibility(View.GONE);
        offlineMessage = new TextView(this);
        offlineMessage.setTextColor(Color.WHITE);
        offlineMessage.setTextSize(17);
        offlineMessage.setGravity(android.view.Gravity.CENTER);
        offlineOverlay.addView(offlineMessage);
        Button retryButton = new Button(this);
        retryButton.setText("إعادة الاتصال");
        retryButton.setOnClickListener(v -> retry());
        offlineOverlay.addView(retryButton);
        root.addView(offlineOverlay, new FrameLayout.LayoutParams(-1, -1));
        setContentView(root);
        web.loadUrl(BuildConfig.CONTROL_URL);
    }

    @Override
    public void onBackPressed() {
        if (offlineOverlay.getVisibility() == View.VISIBLE) { retry(); return; }
        if (web.canGoBack()) { web.goBack(); return; }
        if (System.currentTimeMillis() - lastBackAt > 1800) {
            lastBackAt = System.currentTimeMillis();
            web.evaluateJavascript("document.querySelector('[data-section=overview]')?.click();", null);
            Toast.makeText(this, "اضغط رجوع مرة ثانية للخروج", Toast.LENGTH_SHORT).show();
        } else super.onBackPressed();
    }

    @Override
    protected void onPause() { super.onPause(); if (web != null) web.onPause(); }
    @Override
    protected void onResume() { super.onResume(); if (web != null) web.onResume(); }
    @Override
    protected void onDestroy() {
        trustedPage = false;
        if (web != null) { root.removeView(web); web.destroy(); web = null; }
        super.onDestroy();
    }
}

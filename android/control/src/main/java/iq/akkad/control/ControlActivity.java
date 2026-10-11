package iq.akkad.control;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

/** Portrait-only app for AKKAD administration; credentials stay on the server. */
public final class ControlActivity extends Activity {
    private WebView web;
    private long lastBackAt;
    private final Uri trusted = Uri.parse(BuildConfig.CONTROL_URL);

    @Override
    @SuppressLint("SetJavaScriptEnabled")
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        getWindow().setStatusBarColor(0xFF050B1E);
        getWindow().setNavigationBarColor(0xFF050B1E);
        web = new WebView(this);
        web.setBackgroundColor(0xFF050B1E);
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
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri destination = request.getUrl();
                if (!"https".equalsIgnoreCase(destination.getScheme()) ||
                    !trusted.getHost().equalsIgnoreCase(destination.getHost())) {
                    // Never navigate the admin session to an arbitrary web origin.
                    return true;
                }
                return false;
            }
        });
        web.setWebChromeClient(new WebChromeClient() {});
        setContentView(web);
        web.loadUrl(BuildConfig.CONTROL_URL);
    }

    @Override
    public void onBackPressed() {
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
        if (web != null) { web.destroy(); web = null; }
        super.onDestroy();
    }
}

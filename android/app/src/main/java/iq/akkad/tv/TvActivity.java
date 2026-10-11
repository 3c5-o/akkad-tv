package iq.akkad.tv;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.net.Uri;
import android.os.Bundle;
import android.os.Build;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

import androidx.media3.common.MediaItem;
import androidx.media3.common.MimeTypes;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.ui.PlayerView;

/**
 * Native Android TV host for the AKKAD viewer. All permissions, VIP memberships and
 * single-provider code scoping are enforced by the existing remote API, never here.
 */
public final class TvActivity extends Activity {
    private FrameLayout root;
    private WebView webView;
    private PlayerView playerView;
    private ExoPlayer player;
    private View customView;
    private WebChromeClient.CustomViewCallback customCallback;
    private final Uri trusted = Uri.parse(BuildConfig.AKKAD_URL);

    @Override
    @SuppressLint("SetJavaScriptEnabled")
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // Prevent screen recording/screenshots. APK copying itself requires server-side entitlement controls.
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE | WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        immersive();

        root = new FrameLayout(this);
        root.setBackgroundColor(0xFF030716);
        setContentView(root);
        webView = new WebView(this);
        webView.setBackgroundColor(0xFF030716);
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
        webView.setFocusable(true);
        webView.setFocusableInTouchMode(true);
        webView.setOnLongClickListener(v -> true);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setSupportMultipleWindows(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) settings.setSafeBrowsingEnabled(true);
        settings.setUserAgentString(settings.getUserAgentString() + " AKKAD-AndroidTV/1.0");

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, android.webkit.WebResourceRequest request) {
                Uri target = request.getUrl();
                return !sameTrustedHost(target);
            }
        });
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(PermissionRequest request) {
                request.deny();
            }
            @Override
            public void onShowCustomView(View view, CustomViewCallback callback) {
                if (customView != null) { callback.onCustomViewHidden(); return; }
                customView = view;
                customCallback = callback;
                root.addView(view, new FrameLayout.LayoutParams(-1, -1));
                view.requestFocus();
                immersive();
            }
            @Override
            public void onHideCustomView() {
                if (customView == null) return;
                root.removeView(customView);
                customView = null;
                if (customCallback != null) customCallback.onCustomViewHidden();
                customCallback = null;
            }
        });
        webView.addJavascriptInterface(new PlaybackBridge(), "AkkadAndroid");
        root.addView(webView, new FrameLayout.LayoutParams(-1, -1));
        webView.loadUrl(BuildConfig.AKKAD_URL);
    }

    private boolean sameTrustedHost(Uri target) {
        return "https".equalsIgnoreCase(target.getScheme())
            && trusted.getHost() != null && trusted.getHost().equalsIgnoreCase(target.getHost())
            && (target.getPort() == -1 || target.getPort() == 443);
    }

    private void immersive() {
        int flags = View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
            | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION;
        getWindow().getDecorView().setSystemUiVisibility(flags);
    }

    public final class PlaybackBridge {
        @JavascriptInterface
        public void playMedia(String url, String format, String title) {
            Uri media;
            try { media = Uri.parse(url); } catch (Exception ex) { return; }
            // Never permit arbitrary external pages or third-party media to use our native bridge.
            if (!sameTrustedHost(media) || media.getPath() == null ||
                !media.getPath().startsWith("/api/media/")) {
                runOnUiThread(() -> Toast.makeText(TvActivity.this, "رابط المشغل غير مسموح", Toast.LENGTH_LONG).show());
                return;
            }
            final Uri safeUri = media;
            final String mediaFormat = format == null ? "" : format;
            runOnUiThread(() -> showNativePlayer(safeUri, mediaFormat));
        }
    }

    private void showNativePlayer(Uri media, String format) {
        closeNativePlayer();
        playerView = new PlayerView(this);
        playerView.setUseController(true);
        playerView.setControllerShowTimeoutMs(5500);
        playerView.setBackgroundColor(0xFF000000);
        root.addView(playerView, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        player = new ExoPlayer.Builder(this).build();
        playerView.setPlayer(player);
        MediaItem.Builder item = new MediaItem.Builder().setUri(media);
        if ("hls".equalsIgnoreCase(format) || "m3u8".equalsIgnoreCase(format))
            item.setMimeType(MimeTypes.APPLICATION_M3U8);
        else if ("ts".equalsIgnoreCase(format)) item.setMimeType(MimeTypes.VIDEO_MP2T);
        player.setMediaItem(item.build());
        player.addListener(new Player.Listener() {
            @Override
            public void onPlayerError(PlaybackException error) {
                if ("hls".equalsIgnoreCase(format)
                    && !"ts".equalsIgnoreCase(media.getQueryParameter("format"))) {
                    Toast.makeText(TvActivity.this, "جارٍ تجربة بث TS البديل…", Toast.LENGTH_SHORT).show();
                    Uri fallback = media.buildUpon().appendQueryParameter("format", "ts").build();
                    playerView.post(() -> showNativePlayer(fallback, "ts"));
                    return;
                }
                Toast.makeText(TvActivity.this,
                    "تعذر تشغيل البث: " + error.getErrorCodeName(), Toast.LENGTH_LONG).show();
            }
        });
        player.prepare();
        player.play();
        playerView.requestFocus();
        immersive();
    }

    private void closeNativePlayer() {
        if (player != null) {
            player.stop();
            player.release();
            player = null;
        }
        if (playerView != null) {
            playerView.setPlayer(null);
            root.removeView(playerView);
            playerView = null;
        }
    }

    @Override
    public void onBackPressed() {
        if (playerView != null) { closeNativePlayer(); webView.requestFocus(); immersive(); return; }
        if (customView != null) { webView.getWebChromeClient().onHideCustomView(); return; }
        webView.evaluateJavascript(
            "document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));", null);
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (player != null) player.pause();
        if (webView != null) webView.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        immersive();
        if (webView != null) webView.onResume();
    }

    @Override
    protected void onDestroy() {
        closeNativePlayer();
        if (webView != null) { root.removeView(webView); webView.destroy(); webView = null; }
        super.onDestroy();
    }
}

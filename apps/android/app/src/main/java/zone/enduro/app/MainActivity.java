package zone.enduro.app;

import android.Manifest;
import android.app.Activity;
import android.app.DownloadManager;
import android.content.ActivityNotFoundException;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.webkit.CookieManager;
import android.webkit.GeolocationPermissions;
import android.webkit.JavascriptInterface;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;

/**
 * Enduro.Zone in its own WebView: no browser choice on launch, works without Chrome.
 * Adds what a bare WebView lacks: file picking, location, downloads (including blob: files),
 * full screen for the game (turned sideways) and the back button.
 */
public class MainActivity extends Activity {
    private static final int PICK_FILES = 1;
    private static final int ASK_LOCATION = 2;
    private static final int OLIVE = Color.parseColor("#2B2D1C");

    private WebView web;
    private FrameLayout root;
    private View fullscreenView;
    private WebChromeClient.CustomViewCallback fullscreenCallback;
    private ValueCallback<Uri[]> pendingFiles;
    private GeolocationPermissions.Callback pendingGeo;
    private String pendingGeoOrigin;
    private String host;

    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        Window w = getWindow();
        w.setStatusBarColor(OLIVE);
        w.setNavigationBarColor(OLIVE);
        host = getString(R.string.site_host);

        root = new FrameLayout(this);
        root.setBackgroundColor(Color.parseColor("#D8D3BA"));
        web = new WebView(this);
        root.addView(web, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setGeolocationEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setSupportMultipleWindows(false); // target=_blank opens through shouldOverrideUrlLoading
        s.setUserAgentString(s.getUserAgentString() + " EnduroZoneApp/" + BuildConfig.VERSION_NAME);

        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        cookies.setAcceptThirdPartyCookies(web, true);

        web.addJavascriptInterface(new Bridge(), "EnduroAndroid");
        web.setWebViewClient(new Client());
        web.setWebChromeClient(new Chrome());
        web.setDownloadListener((url, userAgent, disposition, mime, length) ->
                download(url, userAgent, disposition, mime));

        if (saved != null) web.restoreState(saved);
        else web.loadUrl(getString(R.string.launch_url));
    }

    private boolean ours(Uri uri) {
        return "https".equals(uri.getScheme()) && host.equalsIgnoreCase(uri.getHost());
    }

    private void openOutside(Uri uri) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (ActivityNotFoundException e) {
            Toast.makeText(this, "Нет приложения, чтобы открыть ссылку", Toast.LENGTH_SHORT).show();
        }
    }

    private class Client extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            if (ours(uri)) return false;
            // Frames (the 67МОТО game) load inside the page; links that leave the site go outside.
            if (!request.isForMainFrame()) return false;
            openOutside(uri);
            return true;
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            if (!request.isForMainFrame()) return;
            String retry = getString(R.string.launch_url);
            view.loadDataWithBaseURL(null,
                    "<html><head><meta name='viewport' content='width=device-width,initial-scale=1'></head>"
                            + "<body style='margin:0;font-family:sans-serif;background:#d8d3ba;color:#1f2116;display:flex;"
                            + "align-items:center;justify-content:center;height:100vh;text-align:center'>"
                            + "<div><h2>Нет связи с Enduro.Zone</h2><p>Проверьте интернет или VPN.</p>"
                            + "<a href='" + retry + "' style='display:inline-block;margin-top:12px;padding:12px 22px;"
                            + "background:#c2541f;color:#fff4e8;text-decoration:none;font-weight:bold'>Повторить</a>"
                            + "</div></body></html>",
                    "text/html", "utf-8", null);
        }
    }

    private class Chrome extends WebChromeClient {
        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
            if (pendingFiles != null) pendingFiles.onReceiveValue(null);
            pendingFiles = callback;
            Intent intent = params.createIntent();
            if (params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE)
                intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
            try {
                startActivityForResult(intent, PICK_FILES);
            } catch (ActivityNotFoundException e) {
                pendingFiles = null;
                return false;
            }
            return true;
        }

        @Override
        public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
            if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
                    || checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED) {
                callback.invoke(origin, true, false);
                return;
            }
            pendingGeo = callback;
            pendingGeoOrigin = origin;
            requestPermissions(new String[]{
                    Manifest.permission.ACCESS_FINE_LOCATION,
                    Manifest.permission.ACCESS_COARSE_LOCATION}, ASK_LOCATION);
        }

        // element.requestFullscreen(): the game goes full screen and sideways.
        @Override
        public void onShowCustomView(View view, CustomViewCallback callback) {
            if (fullscreenView != null) {
                callback.onCustomViewHidden();
                return;
            }
            fullscreenView = view;
            fullscreenCallback = callback;
            root.addView(view, new FrameLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
            web.setVisibility(View.GONE);
            hideSystemBars(true);
            setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
        }

        @Override
        public void onHideCustomView() {
            if (fullscreenView == null) return;
            root.removeView(fullscreenView);
            fullscreenView = null;
            web.setVisibility(View.VISIBLE);
            hideSystemBars(false);
            setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);
            if (fullscreenCallback != null) fullscreenCallback.onCustomViewHidden();
            fullscreenCallback = null;
        }
    }

    @SuppressWarnings("deprecation")
    private void hideSystemBars(boolean on) {
        View decor = getWindow().getDecorView();
        decor.setSystemUiVisibility(on
                ? View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                : View.SYSTEM_UI_FLAG_VISIBLE);
    }

    @Override
    protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request != PICK_FILES || pendingFiles == null) return;
        Uri[] picked = null;
        if (result == RESULT_OK && data != null) {
            if (data.getClipData() != null) {
                picked = new Uri[data.getClipData().getItemCount()];
                for (int i = 0; i < picked.length; i++) picked[i] = data.getClipData().getItemAt(i).getUri();
            } else if (data.getData() != null) {
                picked = new Uri[]{data.getData()};
            }
        }
        pendingFiles.onReceiveValue(picked);
        pendingFiles = null;
    }

    @Override
    public void onRequestPermissionsResult(int request, String[] permissions, int[] grants) {
        super.onRequestPermissionsResult(request, permissions, grants);
        if (request != ASK_LOCATION || pendingGeo == null) return;
        boolean ok = false;
        for (int g : grants) ok |= g == PackageManager.PERMISSION_GRANTED;
        pendingGeo.invoke(pendingGeoOrigin, ok, false);
        pendingGeo = null;
    }

    // Regular links (the public GPX) go to the system downloader with the session cookie.
    private void download(String url, String userAgent, String disposition, String mime) {
        if (url.startsWith("blob:")) {
            // Files the page builds itself (account export, original GPX): read in the page, saved by the bridge.
            web.evaluateJavascript(
                    "(async()=>{try{const b=await (await fetch('" + url + "')).blob();"
                            + "const a=[...document.querySelectorAll('a[download]')].find(x=>x.href==='" + url + "');"
                            + "const n=(a&&a.download)||'enduro-zone-file';"
                            + "const r=new FileReader();r.onload=()=>EnduroAndroid.save(n,b.type||'application/octet-stream',"
                            + "String(r.result).split(',')[1]);r.readAsDataURL(b);}catch(e){EnduroAndroid.failed();}})()",
                    null);
            return;
        }
        try {
            String name = URLUtil.guessFileName(url, disposition, mime);
            DownloadManager.Request r = new DownloadManager.Request(Uri.parse(url));
            r.addRequestHeader("Cookie", CookieManager.getInstance().getCookie(url));
            r.addRequestHeader("User-Agent", userAgent);
            r.setMimeType(mime);
            r.setTitle(name);
            r.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            r.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name);
            ((DownloadManager) getSystemService(DOWNLOAD_SERVICE)).enqueue(r);
            Toast.makeText(this, "Скачивается в «Загрузки»: " + name, Toast.LENGTH_SHORT).show();
        } catch (Exception e) {
            Toast.makeText(this, "Не удалось скачать файл", Toast.LENGTH_SHORT).show();
        }
    }

    private class Bridge {
        @JavascriptInterface
        public void save(String name, String mime, String base64) {
            String safe = name.replaceAll("[\\\\/:*?\"<>|]", "_");
            try {
                byte[] bytes = Base64.decode(base64, Base64.DEFAULT);
                if (Build.VERSION.SDK_INT >= 29) {
                    ContentValues v = new ContentValues();
                    v.put(MediaStore.Downloads.DISPLAY_NAME, safe);
                    v.put(MediaStore.Downloads.MIME_TYPE, mime);
                    Uri uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
                    try (OutputStream out = getContentResolver().openOutputStream(uri)) {
                        out.write(bytes);
                    }
                } else {
                    File dir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
                    dir.mkdirs();
                    try (OutputStream out = new FileOutputStream(new File(dir, safe))) {
                        out.write(bytes);
                    }
                }
                toast("Сохранено в «Загрузки»: " + safe);
            } catch (Exception e) {
                toast("Не удалось сохранить файл");
            }
        }

        @JavascriptInterface
        public void failed() {
            toast("Не удалось сохранить файл");
        }
    }

    private void toast(String text) {
        runOnUiThread(() -> Toast.makeText(this, text, Toast.LENGTH_SHORT).show());
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        if (fullscreenView != null) {
            web.evaluateJavascript("document.exitFullscreen && document.exitFullscreen()", null);
            return;
        }
        if (web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    protected void onPause() {
        super.onPause();
        CookieManager.getInstance().flush();
    }
}

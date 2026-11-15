package com.educare.app;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.app.DownloadManager;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Bundle;
import android.os.Environment;
import android.text.InputType;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import java.util.Locale;

/**
 * Thin WebView shell around the EduCare web app (Express + EJS).
 *
 * The app is server-rendered, so nothing is bundled in the APK: the URL comes
 * from BuildConfig.EDUCARE_URL, which is injected at build time. Because quick
 * cloudflared tunnels rotate, the URL can also be changed on the device from
 * the error screen ("Server settings") and is then kept in SharedPreferences.
 */
public class MainActivity extends Activity {

    private static final int REQUEST_FILE_CHOOSER = 1001;
    private static final String PREFS_NAME = "educare";
    private static final String PREF_SERVER_URL = "server_url";

    private WebView webView;
    private ProgressBar progressBar;
    private View errorView;
    private TextView errorMessage;
    private ValueCallback<Uri[]> pendingFileCallback;
    private String serverUrl;
    private String appHost;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        webView = findViewById(R.id.web_view);
        progressBar = findViewById(R.id.progress_bar);
        errorView = findViewById(R.id.error_view);
        errorMessage = findViewById(R.id.error_message);
        Button retryButton = findViewById(R.id.retry_button);
        Button settingsButton = findViewById(R.id.settings_button);

        serverUrl = loadServerUrl();
        appHost = Uri.parse(serverUrl).getHost();

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
        settings.setMediaPlaybackRequiresUserGesture(false);

        CookieManager.getInstance().setAcceptCookie(true);

        if (BuildConfig.DEBUG) {
            WebView.setWebContentsDebuggingEnabled(true);
        }

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return openExternallyIfNeeded(request.getUrl());
            }

            @Override
            public void onPageStarted(WebView view, String url, Bitmap favicon) {
                errorView.setVisibility(View.GONE);
                progressBar.setVisibility(View.VISIBLE);
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                progressBar.setVisibility(View.GONE);
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) {
                    progressBar.setVisibility(View.GONE);
                    showError();
                }
            }

            @Override
            public void onReceivedHttpError(WebView view, WebResourceRequest request,
                                            WebResourceResponse errorResponse) {
                // A dead tunnel answers with 502/1033-style error pages; treat those as failures
                // so the "Server settings" button is reachable.
                if (request.isForMainFrame() && errorResponse.getStatusCode() >= 400) {
                    progressBar.setVisibility(View.GONE);
                    showError();
                }
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView view, int newProgress) {
                progressBar.setProgress(newProgress);
                progressBar.setVisibility(newProgress >= 100 ? View.GONE : View.VISIBLE);
            }

            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                                             FileChooserParams params) {
                if (pendingFileCallback != null) {
                    pendingFileCallback.onReceiveValue(null);
                }
                pendingFileCallback = callback;
                try {
                    Intent intent = params.createIntent();
                    intent.addCategory(Intent.CATEGORY_OPENABLE);
                    startActivityForResult(intent, REQUEST_FILE_CHOOSER);
                    return true;
                } catch (ActivityNotFoundException e) {
                    pendingFileCallback = null;
                    Toast.makeText(MainActivity.this, R.string.error_no_file_picker, Toast.LENGTH_SHORT).show();
                    return false;
                }
            }
        });

        // Photo uploads are not affected by this; reports/CSV exports are.
        webView.setDownloadListener((url, userAgent, contentDisposition, mimeType, contentLength) -> {
            try {
                DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
                request.addRequestHeader("User-Agent", userAgent);
                String cookies = CookieManager.getInstance().getCookie(url);
                if (cookies != null) {
                    request.addRequestHeader("Cookie", cookies);
                }
                String fileName = android.webkit.URLUtil.guessFileName(url, contentDisposition, mimeType);
                request.setMimeType(mimeType);
                request.setTitle(fileName);
                request.setDescription(getString(R.string.app_name));
                request.setNotificationVisibility(
                        DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, fileName);

                DownloadManager manager = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
                if (manager == null) {
                    throw new IllegalStateException("DownloadManager unavailable");
                }
                manager.enqueue(request);
                Toast.makeText(this, getString(R.string.download_started, fileName), Toast.LENGTH_SHORT).show();
            } catch (Exception e) {
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
                } catch (ActivityNotFoundException ignored) {
                    Toast.makeText(this, R.string.download_failed, Toast.LENGTH_SHORT).show();
                }
            }
        });

        retryButton.setOnClickListener(v -> {
            errorView.setVisibility(View.GONE);
            webView.reload();
        });

        settingsButton.setOnClickListener(v -> showServerUrlDialog());

        if (savedInstanceState == null) {
            webView.loadUrl(serverUrl);
        } else {
            webView.restoreState(savedInstanceState);
        }
    }

    private SharedPreferences prefs() {
        return getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
    }

    /** Saved URL wins over the build-time default, so a new tunnel does not need a new APK. */
    private String loadServerUrl() {
        String saved = normalizeServerUrl(prefs().getString(PREF_SERVER_URL, null));
        if (saved != null) {
            return saved;
        }
        String baked = normalizeServerUrl(BuildConfig.EDUCARE_URL);
        return baked != null ? baked : "https://educare.invalid";
    }

    private void saveServerUrl(String url) {
        prefs().edit().putString(PREF_SERVER_URL, url).apply();
    }

    private static String normalizeServerUrl(String raw) {
        if (raw == null) {
            return null;
        }
        String value = raw.trim();
        if (value.isEmpty()) {
            return null;
        }
        if (!value.startsWith("http://") && !value.startsWith("https://")) {
            if (value.contains("://")) {
                return null; // unsupported scheme
            }
            value = "https://" + value;
        }
        String host = Uri.parse(value).getHost();
        if (host == null || host.isEmpty()) {
            return null;
        }
        while (value.endsWith("/")) {
            value = value.substring(0, value.length() - 1);
        }
        return value;
    }

    private void showServerUrlDialog() {
        final EditText input = new EditText(this);
        input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        input.setText(serverUrl);
        input.setSelection(input.getText().length());
        input.setHint(R.string.server_settings_hint);

        int padding = Math.round(20 * getResources().getDisplayMetrics().density);
        FrameLayout container = new FrameLayout(this);
        container.setPadding(padding, padding / 2, padding, 0);
        container.addView(input, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        new AlertDialog.Builder(this)
                .setTitle(R.string.server_settings_title)
                .setMessage(R.string.server_settings_help)
                .setView(container)
                .setNegativeButton(R.string.cancel, null)
                .setPositiveButton(R.string.save, (dialog, which) -> {
                    String normalized = normalizeServerUrl(input.getText().toString());
                    if (normalized == null) {
                        Toast.makeText(this, R.string.invalid_server_url, Toast.LENGTH_LONG).show();
                        return;
                    }
                    saveServerUrl(normalized);
                    serverUrl = normalized;
                    appHost = Uri.parse(normalized).getHost();
                    errorView.setVisibility(View.GONE);
                    Toast.makeText(this, R.string.server_url_saved, Toast.LENGTH_SHORT).show();
                    webView.loadUrl(normalized);
                })
                .show();
    }

    /**
     * Keeps the EduCare host inside the WebView and sends everything else
     * (mail, telephone, external links) to the matching app or browser.
     */
    private boolean openExternallyIfNeeded(Uri uri) {
        if (uri == null) {
            return false;
        }
        String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.US);
        boolean isWeb = "http".equals(scheme) || "https".equals(scheme);
        if (isWeb && appHost != null && appHost.equalsIgnoreCase(uri.getHost())) {
            return false;
        }
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (ActivityNotFoundException ignored) {
            Toast.makeText(this, R.string.error_no_app, Toast.LENGTH_SHORT).show();
        }
        return true;
    }

    private void showError() {
        errorMessage.setText(getString(R.string.error_message, serverUrl));
        errorView.setVisibility(View.VISIBLE);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == REQUEST_FILE_CHOOSER) {
            if (pendingFileCallback == null) {
                super.onActivityResult(requestCode, resultCode, data);
                return;
            }
            Uri[] results = null;
            if (resultCode == RESULT_OK && data != null) {
                if (data.getClipData() != null) {
                    int count = data.getClipData().getItemCount();
                    results = new Uri[count];
                    for (int i = 0; i < count; i++) {
                        results[i] = data.getClipData().getItemAt(i).getUri();
                    }
                } else if (data.getData() != null) {
                    results = new Uri[]{data.getData()};
                }
            }
            pendingFileCallback.onReceiveValue(results);
            pendingFileCallback = null;
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        webView.saveState(outState);
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
            return;
        }
        super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        if (pendingFileCallback != null) {
            pendingFileCallback.onReceiveValue(null);
            pendingFileCallback = null;
        }
        if (webView != null) {
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}

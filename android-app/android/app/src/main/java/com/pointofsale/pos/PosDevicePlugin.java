package com.pointofsale.pos;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.print.PrintAttributes;
import android.print.PrintManager;
import android.util.Base64;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.core.content.FileProvider;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;

/**
 * Android replacements for browser features that do not work inside an app WebView:
 *  - printHtml: Android print system (Wi-Fi/network printers, "Save as PDF", print-service apps)
 *  - shareFile: CSV/Excel exports through the share sheet (save to Files/Drive, email, chat)
 */
@CapacitorPlugin(name = "PosDevice")
public class PosDevicePlugin extends Plugin {
    private WebView printView; // kept alive until the print job is handed over

    @PluginMethod
    public void printHtml(final PluginCall call) {
        final String html = call.getString("html");
        final String job = call.getString("jobName", "POS document");
        if (html == null) { call.reject("Nothing to print.", "INVALID"); return; }
        getActivity().runOnUiThread(() -> {
            WebView view = new WebView(getActivity());
            view.getSettings().setJavaScriptEnabled(false);
            view.setWebViewClient(new WebViewClient() {
                @Override
                public void onPageFinished(WebView v, String url) {
                    PrintManager pm = (PrintManager) getActivity().getSystemService(Context.PRINT_SERVICE);
                    PrintAttributes attrs = new PrintAttributes.Builder()
                        .setMediaSize(PrintAttributes.MediaSize.UNKNOWN_PORTRAIT)
                        .setMinMargins(PrintAttributes.Margins.NO_MARGINS)
                        .build();
                    pm.print(job, v.createPrintDocumentAdapter(job), attrs);
                    call.resolve();
                }
            });
            printView = view;
            view.loadDataWithBaseURL("https://localhost/", html, "text/html", "UTF-8", null);
        });
    }

    @PluginMethod
    public void shareFile(PluginCall call) {
        String name = call.getString("filename", "export.csv").replaceAll("[^A-Za-z0-9._-]", "_");
        String data = call.getString("data");
        String mime = call.getString("mimeType", "text/csv");
        if (data == null) { call.reject("No data.", "INVALID"); return; }
        try {
            File dir = new File(getContext().getCacheDir(), "exports");
            if (!dir.exists() && !dir.mkdirs()) throw new Exception("Cannot create export folder");
            File file = new File(dir, name);
            try (FileOutputStream out = new FileOutputStream(file)) { out.write(Base64.decode(data, Base64.DEFAULT)); }
            Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", file);
            Intent send = new Intent(Intent.ACTION_SEND);
            send.setType(mime);
            send.putExtra(Intent.EXTRA_STREAM, uri);
            send.putExtra(Intent.EXTRA_SUBJECT, name);
            send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            Intent chooser = Intent.createChooser(send, "Save or share " + name);
            chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(chooser);
            call.resolve();
        } catch (Exception e) {
            call.reject("Could not export the file: " + e.getMessage(), "EXPORT_FAILED");
        }
    }
}

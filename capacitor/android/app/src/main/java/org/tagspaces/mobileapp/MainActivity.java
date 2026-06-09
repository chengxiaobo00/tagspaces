package org.tagspaces.mobileapp;

import android.os.Bundle;
import android.view.View;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import com.getcapacitor.BridgeActivity;
import org.tagspaces.plugins.IntentHandlerPlugin;
import org.tagspaces.plugins.StoragePermissionPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(StoragePermissionPlugin.class);
        registerPlugin(IntentHandlerPlugin.class);
        super.onCreate(savedInstanceState);
        insetWebViewFromSystemBars();
    }

    // Android 15+ (targetSdk 35+) force-enables edge-to-edge: the WebView always
    // extends behind the status bar, notch, and gesture nav. StatusBar plugin's
    // setOverlaysWebView({overlay:false}) became a no-op, and the SDK-35 opt-out
    // flag was removed in SDK 36. We restore pre-edge-to-edge behavior by padding
    // the WebView's parent so the WebView itself no longer overlaps system bars —
    // this fixes both flow and position:fixed/absolute UI inside the WebView.
    private void insetWebViewFromSystemBars() {
        final View parent = (View) getBridge().getWebView().getParent();
        if (parent == null) return;
        ViewCompat.setOnApplyWindowInsetsListener(parent, (v, insets) -> {
            Insets bars = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout()
            );
            v.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            return WindowInsetsCompat.CONSUMED;
        });
        ViewCompat.requestApplyInsets(parent);
    }
}

package com.excavatormanager.app;

import android.Manifest;

import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/**
 * The microphone, for the assistant's voice input.
 *
 * In a real browser, getUserMedia() puts up its own "allow the microphone"
 * prompt. Inside an Android WebView it cannot: Android checks the APP's
 * RECORD_AUDIO permission first, and if the app does not hold it the request
 * is refused outright with no prompt of any kind. The owner would tap the
 * microphone, see "the microphone is blocked", and have nowhere to go — the
 * same dead end the web build had when Permissions-Policy disabled it.
 *
 * So the app asks for the OS permission itself, on demand rather than at
 * launch: the panel explains why first, in the owner's own language, and only
 * then is this called. A permission prompt that arrives unexplained at startup
 * is the one people refuse, and on Android a refusal with "don't ask again"
 * is as permanent as Chrome's.
 */
@CapacitorPlugin(
    name = "MicPermission",
    permissions = {
        @Permission(alias = MicPermissionPlugin.MIC, strings = { Manifest.permission.RECORD_AUDIO })
    }
)
public class MicPermissionPlugin extends Plugin {

    static final String MIC = "microphone";

    /** "granted" | "denied" | "prompt" — what the web layer needs to decide
     * whether to explain, ask, or go straight to recording. */
    @PluginMethod
    public void check(PluginCall call) {
        call.resolve(state(getPermissionState(MIC)));
    }

    @PluginMethod
    public void request(PluginCall call) {
        if (getPermissionState(MIC) == PermissionState.GRANTED) {
            call.resolve(state(PermissionState.GRANTED));
            return;
        }
        requestPermissionForAlias(MIC, call, "micResult");
    }

    @PermissionCallback
    private void micResult(PluginCall call) {
        call.resolve(state(getPermissionState(MIC)));
    }

    private com.getcapacitor.JSObject state(PermissionState permission) {
        com.getcapacitor.JSObject result = new com.getcapacitor.JSObject();
        // PROMPT_WITH_RATIONALE means they refused once but can be asked again;
        // the web layer treats that as "prompt", not as a standing no.
        String value =
            permission == PermissionState.GRANTED ? "granted"
                : permission == PermissionState.DENIED ? "denied"
                    : "prompt";
        result.put("state", value);
        return result;
    }
}

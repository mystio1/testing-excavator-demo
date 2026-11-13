package com.excavatormanager.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(UpdateInstallerPlugin.class);
        registerPlugin(FileSaverPlugin.class);
        registerPlugin(PrintPlugin.class);
        registerPlugin(MicPermissionPlugin.class);
        super.onCreate(savedInstanceState);
    }
}

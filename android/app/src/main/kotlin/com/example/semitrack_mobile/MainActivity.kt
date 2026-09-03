package com.example.semitrack_mobile

import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel
import android.view.WindowManager
import com.example.semitrack_mobile.navigation.NavigationChannelHandler

class MainActivity : FlutterActivity() {
    private companion object {
        const val SCREEN_AWAKE_CHANNEL = "com.semitrax/screen_awake"
    }

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        NavigationChannelHandler(this).register(flutterEngine.dartExecutor.binaryMessenger)
        MethodChannel(
            flutterEngine.dartExecutor.binaryMessenger,
            SCREEN_AWAKE_CHANNEL,
        ).setMethodCallHandler { call, result ->
            if (call.method != "setKeepScreenOn") {
                result.notImplemented()
                return@setMethodCallHandler
            }

            val enabled = call.argument<Boolean>("enabled") ?: false
            runOnUiThread {
                if (enabled) {
                    window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                } else {
                    window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                }
            }
            result.success(null)
        }
    }

    override fun onDestroy() {
        window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        super.onDestroy()
    }
}

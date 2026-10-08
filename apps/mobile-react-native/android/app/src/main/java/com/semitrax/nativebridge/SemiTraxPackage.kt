package com.semitrax.nativebridge
import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider
class SemiTraxPackage : BaseReactPackage() {
 override fun getModule(name: String, context: ReactApplicationContext): NativeModule? = when (name) {
   NativeSemiTraxPlatformSpec.NAME -> SemiTraxPlatformModule(context)
   "SemiTraxCoPilotSetup" -> CoPilotSetupModule(context)
   else -> null
 }
 override fun getReactModuleInfoProvider() = ReactModuleInfoProvider {
   mapOf(
     NativeSemiTraxPlatformSpec.NAME to ReactModuleInfo(NativeSemiTraxPlatformSpec.NAME, SemiTraxPlatformModule::class.java.name, false, false, false, true),
     "SemiTraxCoPilotSetup" to ReactModuleInfo("SemiTraxCoPilotSetup", CoPilotSetupModule::class.java.name, false, false, false, false)
   )
 }
}


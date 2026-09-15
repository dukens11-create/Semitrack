package com.semitrax.nativebridge
/** SDK-neutral boundary. Replace only after reviewing the official vendor SDK contract. */
interface GuidanceBoundary {
  fun command(command: String, payload: String): String
}
class UnconfiguredGuidanceBoundary : GuidanceBoundary {
  override fun command(command: String, payload: String): String {
    if (command == "stopNavigation") return """{"phase":"unavailable"}"""
    throw IllegalStateException("NATIVE_TRUCK_GUIDANCE_NOT_CONFIGURED")
  }
}


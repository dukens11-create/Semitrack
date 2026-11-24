# Add project specific ProGuard rules here.
# By default, the flags in this file are appended to flags specified
# in /usr/local/Cellar/android-sdk/24.3.3/tools/proguard/proguard-android.txt
# You can edit the include path and order by changing the proguardFiles
# directive in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# Add any project specific keep options here:

# CPIK contains JNI entry points and reflection-serialized JSON models. The
# delivered package has no consumer rules. Preserve the vendor boundary until
# a Trimble-supported narrower ruleset is supplied and release-tested.
-keep class com.alk.** { *; }

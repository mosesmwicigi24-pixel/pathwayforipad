# ProGuard / R8 rules for the Nuru Pathway Android release build.
#
# Most React Native libraries ship consumer ProGuard rules inside their AARs, and
# the React Native Gradle plugin contributes the core keep rules automatically.
# The rules below are conservative belt-and-suspenders keeps for Hermes, the RN
# bridge/codegen, networking, and the specific native modules this app uses, so
# enabling minify + resource shrinking can't strip a reflectively-loaded class.

# ---- React Native core + JSI/TurboModules (New Architecture) ----------------
-keep,allowobfuscation @interface com.facebook.proguard.annotations.DoNotStrip
-keep,allowobfuscation @interface com.facebook.proguard.annotations.KeepGettersAndSetters
-keep @com.facebook.proguard.annotations.DoNotStrip class *
-keepclassmembers class * { @com.facebook.proguard.annotations.DoNotStrip *; }
-keepclassmembers class * { @com.facebook.jni.annotations.DoNotStrip *; }
-keep class com.facebook.react.** { *; }
-keep class com.facebook.jni.** { *; }
-keep class com.facebook.hermes.** { *; }
-keep class com.facebook.react.turbomodule.** { *; }
-dontwarn com.facebook.react.**
-dontwarn com.facebook.hermes.**

# Keep all native methods (JNI) and any class with native methods.
-keepclasseswithmembernames class * { native <methods>; }

# Annotations + generics + signatures (needed by RN codegen + Gson-style reflection).
-keepattributes *Annotation*,Signature,InnerClasses,EnclosingMethod,SourceFile,LineNumberTable

# ---- This app -----------------------------------------------------------------
-keep class com.nuruplace.** { *; }

# ---- react-native-nitro-modules (JSI codegen used by native modules) ----------
-keep class com.margelo.nitro.** { *; }
-dontwarn com.margelo.nitro.**

# ---- react-native-reanimated / worklets (if present) --------------------------
-keep class com.swmansion.** { *; }
-dontwarn com.swmansion.**

# ---- react-native-svg ---------------------------------------------------------
-keep public class com.horcrux.svg.** { *; }

# ---- react-native-video (ExoPlayer / media3) ----------------------------------
-keep class androidx.media3.** { *; }
-dontwarn androidx.media3.**
-keep class com.brentvatne.** { *; }

# ---- react-native-keychain ----------------------------------------------------
-keep class com.oblador.keychain.** { *; }

# ---- networking (OkHttp / Okio used by the RN networking stack) ---------------
-dontwarn okhttp3.**
-dontwarn okio.**
-dontwarn javax.annotation.**
-keepnames class okhttp3.internal.publicsuffix.PublicSuffixDatabase

# ---- Hermes / JSC engine ------------------------------------------------------
-keep class com.facebook.hermes.unicode.** { *; }

# Suppress notes for missing optional classes some libs reference reflectively.
-dontwarn java.lang.invoke.**
-dontwarn javax.lang.model.**

plugins {
 id("com.android.application")
 id("org.jetbrains.kotlin.android")
}
android {
 namespace = "app.nexus.localaispike"
 compileSdk = 35
 defaultConfig {
  applicationId = "app.nexus.localaispike"
  minSdk = 30
  targetSdk = 35
  versionCode = 1
  versionName = "0.1"
 }
 compileOptions {
  sourceCompatibility = JavaVersion.VERSION_17
  targetCompatibility = JavaVersion.VERSION_17
 }
 kotlinOptions { jvmTarget = "17" }
}
dependencies {
 implementation("com.google.ai.edge.litertlm:litertlm-android:0.18.0")
 implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")
}

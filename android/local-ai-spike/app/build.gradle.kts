plugins {
 id("com.android.application")
 id("org.jetbrains.kotlin.android")
}

// Single source of truth: compile the phone app's local-action prompt, parser and gate into this isolated
// lab. Only these four files are copied; none of the phone bridge, executor, policy or accessibility code comes along.
val phoneActionDir = layout.buildDirectory.dir("generated/phoneAction")
val copyPhoneAction = tasks.register<Copy>("copyPhoneAction") {
 from("../../phone/app/src/main/java/app/nexus/phone") {
  include("LocalActionCall.java", "LocalActionPrompt.java", "LocalActionGate.java", "LocalActionArgs.java")
 }
 into(phoneActionDir.map { it.dir("app/nexus/phone") })
}

android {
 namespace = "app.nexus.localaispike"
 compileSdk = 35
 defaultConfig {
  applicationId = "app.nexus.localaispike"
  minSdk = 30
  targetSdk = 35
  versionCode = 2
  versionName = "0.2"
 }
 compileOptions {
  sourceCompatibility = JavaVersion.VERSION_17
  targetCompatibility = JavaVersion.VERSION_17
 }
 sourceSets.getByName("main").java.srcDir(phoneActionDir)
}
tasks.named("preBuild") { dependsOn(copyPhoneAction) }
kotlin {
 compilerOptions { jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17) }
}
dependencies {
 implementation("com.google.ai.edge.litertlm:litertlm-android:0.18.0")
 implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")
}

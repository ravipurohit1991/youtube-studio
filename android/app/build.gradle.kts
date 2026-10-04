plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

// One version for both apps: read it from the desktop package.json.
val sharedVersion: String = run {
    val pkg = rootProject.file("../package.json")
    val match = if (pkg.exists()) Regex("\"version\"\\s*:\\s*\"([^\"]+)\"").find(pkg.readText()) else null
    match?.groupValues?.get(1) ?: "1.0.0"
}

// CI passes its run number so every build installs over the previous one.
val buildNumber: Int = (System.getenv("YTD_BUILD_NUMBER") ?: System.getenv("GITHUB_RUN_NUMBER"))?.toIntOrNull() ?: 1

// Release signing comes from the environment (GitHub secrets in CI). Without it the release
// APK is signed with the debug key so it still installs.
val keystorePath: String? = System.getenv("YTD_KEYSTORE_FILE")?.takeIf { it.isNotBlank() && file(it).exists() }

android {
    namespace = "com.ytdstudio.android"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.ytdstudio.android"
        minSdk = 29
        targetSdk = 36
        versionCode = buildNumber
        versionName = sharedVersion
    }

    signingConfigs {
        if (keystorePath != null) {
            create("release") {
                storeFile = file(keystorePath)
                storePassword = System.getenv("YTD_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("YTD_KEY_ALIAS")
                keyPassword = System.getenv("YTD_KEY_PASSWORD") ?: System.getenv("YTD_KEYSTORE_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            // yt-dlp's Android wrapper uses Jackson reflection; keep the bytecode as is.
            isMinifyEnabled = false
            signingConfig = if (keystorePath != null) signingConfigs.getByName("release") else signingConfigs.getByName("debug")
        }
    }

    // Python, ffmpeg and QuickJS ship as native libraries per CPU. One APK per CPU keeps each
    // download around 60 MB instead of one 230 MB universal APK.
    splits {
        abi {
            isEnable = true
            reset()
            include("arm64-v8a", "armeabi-v7a", "x86_64")
            isUniversalApk = false
        }
    }

    packaging {
        // The bundled python/ffmpeg are executed straight from nativeLibraryDir, so they must be
        // extracted on install instead of being mapped from inside the APK.
        jniLibs {
            useLegacyPackaging = true
        }
        resources {
            excludes += setOf("META-INF/DEPENDENCIES", "META-INF/LICENSE*", "META-INF/NOTICE*")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    lint {
        // Release builds run lint; don't let a style warning block the APK.
        checkReleaseBuilds = false
        abortOnError = false
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}

base {
    archivesName.set("YTD-Studio-$sharedVersion")
}

dependencies {
    val ytdl = "0.18.1"
    implementation("io.github.junkfood02.youtubedl-android:library:$ytdl")
    implementation("io.github.junkfood02.youtubedl-android:ffmpeg:$ytdl")

    implementation(platform("androidx.compose:compose-bom:2025.09.00"))
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.activity:activity-compose:1.10.1")
    implementation("androidx.core:core-ktx:1.16.0")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.9.2")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.9.2")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")

    val media3 = "1.8.0"
    implementation("androidx.media3:media3-exoplayer:$media3")
    implementation("androidx.media3:media3-ui:$media3")
    implementation("androidx.media3:media3-exoplayer-hls:$media3")
}

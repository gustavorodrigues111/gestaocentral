plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "app.planejamento.v2s"
    compileSdk = 34

    defaultConfig {
        applicationId = "app.planejamento.v2s"
        minSdk = 25          // Android 7.1 (Sunmi V2) em diante; a V2s roda Android 11
        targetSdk = 34
        versionCode = 5
        versionName = "0.2.3-piloto"
        // Abre direto no KIOSK das Etiquetas (sem admin). Host etiquetas.* dispara
        // o modo kiosk no site. Troque para testar em preview da Vercel.
        buildConfigField("String", "URL_INICIAL", "\"https://etiquetas.planejamento.app\"")
    }

    buildFeatures { buildConfig = true }

    buildTypes {
        release {
            isMinifyEnabled = false
            // Piloto: assina com a chave de debug para instalar direto no aparelho.
            signingConfig = signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}

dependencies {
    // SDK da impressora interna Sunmi (serviço AIDL do próprio aparelho).
    implementation("com.sunmi:printerlibrary:1.0.23")
}

package com.ytdstudio.android.ai

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import android.util.Log
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * The Ollama API key, encrypted with an AES key that lives in the Android Keystore (hardware-backed
 * on most phones, never exportable). Only the ciphertext is stored in the app's private preferences,
 * and allowBackup is off, so it does not leave the phone.
 */
class KeyVault(context: Context) {
    private val sp = context.getSharedPreferences("ai_secret", Context.MODE_PRIVATE)
    @Volatile private var cached: String? = null
    @Volatile private var loaded = false

    fun get(): String? {
        if (loaded) return cached
        val data = sp.getString(DATA, null)
        val iv = sp.getString(IV, null)
        cached = if (data == null || iv == null) null else try {
            val cipher = Cipher.getInstance(TRANSFORM)
            cipher.init(Cipher.DECRYPT_MODE, secretKey(), GCMParameterSpec(128, Base64.decode(iv, Base64.NO_WRAP)))
            String(cipher.doFinal(Base64.decode(data, Base64.NO_WRAP)), Charsets.UTF_8)
        } catch (e: Exception) {
            Log.w(TAG, "could not decrypt the stored key", e)
            null
        }
        loaded = true
        return cached
    }

    fun save(raw: String) {
        val key = raw.trim().removePrefix("Bearer ").trim()
        require(key.isNotEmpty()) { "Paste your Ollama API key first." }
        require(key.none { it.isWhitespace() }) { "That does not look like an API key (it contains spaces)." }
        val cipher = Cipher.getInstance(TRANSFORM)
        cipher.init(Cipher.ENCRYPT_MODE, secretKey())
        val data = cipher.doFinal(key.toByteArray(Charsets.UTF_8))
        sp.edit()
            .putString(DATA, Base64.encodeToString(data, Base64.NO_WRAP))
            .putString(IV, Base64.encodeToString(cipher.iv, Base64.NO_WRAP))
            .apply()
        cached = key
        loaded = true
    }

    fun clear() {
        sp.edit().remove(DATA).remove(IV).apply()
        cached = null
        loaded = true
    }

    private fun secretKey(): SecretKey {
        val store = KeyStore.getInstance(KEYSTORE).apply { load(null) }
        (store.getEntry(ALIAS, null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE)
        generator.init(
            KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build(),
        )
        return generator.generateKey()
    }

    companion object {
        private const val TAG = "KeyVault"
        private const val KEYSTORE = "AndroidKeyStore"
        private const val ALIAS = "ytd_ollama_key"
        private const val TRANSFORM = "AES/GCM/NoPadding"
        private const val DATA = "data"
        private const val IV = "iv"
    }
}

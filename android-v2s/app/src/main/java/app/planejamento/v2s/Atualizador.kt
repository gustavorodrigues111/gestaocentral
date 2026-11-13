package app.planejamento.v2s

import android.app.Activity
import android.app.AlertDialog
import android.app.PendingIntent
import android.content.Intent
import android.content.pm.PackageInstaller
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.widget.Toast
import org.json.JSONObject
import java.io.BufferedInputStream
import java.net.HttpURLConnection
import java.net.URL

/**
 * Atualização do app pela internet, sem reinstalar na mão.
 *
 * Lê um manifesto JSON no Storage (apks/latest.json) com a versão mais nova e,
 * se for maior que a instalada, oferece baixar e instalar via PackageInstaller
 * (o Android mostra a confirmação de instalação). O site (telas/lógica) já
 * atualiza sozinho pela Vercel — isto cobre só a casca nativa.
 *
 *   latest.json: {"versionCode":5,"versionName":"0.2.3-piloto","url":"<apk>","notas":"..."}
 */
object Atualizador {
    private const val MANIFESTO =
        "https://firebasestorage.googleapis.com/v0/b/gestaocentral-85b13.firebasestorage.app/o/apks%2Flatest.json?alt=media&token=7f3a9c21-4b6d-4e18-9a2c-9d5b1e0f8a44"
    private val ui = Handler(Looper.getMainLooper())
    @Volatile private var ocupado = false

    /** silencioso=true (checagem no launch): só fala se houver atualização. */
    fun verificar(act: Activity, silencioso: Boolean) {
        if (ocupado) return
        Thread {
            try {
                val j = JSONObject(baixarTexto(MANIFESTO))
                val code = j.optInt("versionCode", 0)
                val nome = j.optString("versionName", "")
                val url = j.optString("url", "")
                val notas = j.optString("notas", "")
                if (code > BuildConfig.VERSION_CODE && url.isNotEmpty()) {
                    ui.post { perguntar(act, nome, notas, url) }
                } else if (!silencioso) {
                    ui.post { Toast.makeText(act, "App já está na versão mais recente (${BuildConfig.VERSION_NAME}).", Toast.LENGTH_SHORT).show() }
                }
            } catch (e: Exception) {
                if (!silencioso) ui.post { Toast.makeText(act, "Não consegui verificar atualização: ${e.message}", Toast.LENGTH_LONG).show() }
            }
        }.start()
    }

    private fun perguntar(act: Activity, nome: String, notas: String, url: String) {
        if (act.isFinishing) return
        val msg = buildString {
            append("Nova versão $nome disponível.")
            if (notas.isNotBlank()) { append("\n\n"); append(notas) }
            append("\n\nAtualizar agora?")
        }
        AlertDialog.Builder(act)
            .setTitle("Atualização do app")
            .setMessage(msg)
            .setPositiveButton("Atualizar") { _, _ -> baixarEInstalar(act, url) }
            .setNegativeButton("Agora não", null)
            .show()
    }

    private fun baixarEInstalar(act: Activity, url: String) {
        if (ocupado) return
        ocupado = true
        Toast.makeText(act, "Baixando atualização…", Toast.LENGTH_SHORT).show()
        Thread {
            try {
                val bytes = baixarBytes(url)
                val pi = act.packageManager.packageInstaller
                val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL)
                val sessionId = pi.createSession(params)
                pi.openSession(sessionId).use { session ->
                    session.openWrite("apk", 0, bytes.size.toLong()).use { out ->
                        out.write(bytes)
                        session.fsync(out)
                    }
                    val intent = Intent(act, MainActivity::class.java).setAction("app.planejamento.v2s.INSTALL_RESULT")
                    val flags = PendingIntent.FLAG_UPDATE_CURRENT or
                        (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) PendingIntent.FLAG_MUTABLE else 0)
                    val pending = PendingIntent.getActivity(act, 555, intent, flags)
                    session.commit(pending.intentSender)
                }
            } catch (e: Exception) {
                ui.post { Toast.makeText(act, "Falha ao atualizar: ${e.message}", Toast.LENGTH_LONG).show() }
            } finally {
                ocupado = false
            }
        }.start()
    }

    private fun abrirConexao(u: String): HttpURLConnection {
        val c = URL(u).openConnection() as HttpURLConnection
        c.connectTimeout = 15000
        c.readTimeout = 30000
        c.instanceFollowRedirects = true
        return c
    }

    private fun baixarTexto(u: String): String {
        val c = abrirConexao(u)
        try { return c.inputStream.bufferedReader().use { it.readText() } } finally { c.disconnect() }
    }

    private fun baixarBytes(u: String): ByteArray {
        val c = abrirConexao(u)
        try { return BufferedInputStream(c.inputStream).use { it.readBytes() } } finally { c.disconnect() }
    }
}

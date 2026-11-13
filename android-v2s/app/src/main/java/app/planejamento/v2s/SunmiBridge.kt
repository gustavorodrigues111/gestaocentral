package app.planejamento.v2s

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.Base64
import android.webkit.JavascriptInterface
import com.sunmi.peripheral.printer.InnerPrinterCallback
import com.sunmi.peripheral.printer.InnerPrinterManager
import com.sunmi.peripheral.printer.InnerResultCallback
import com.sunmi.peripheral.printer.SunmiPrinterService
import org.json.JSONObject

/**
 * Ponte exposta ao planejamento.app como `window.SunmiBridge`.
 * Contrato do lado web: src/core/impressao/impressora.ts
 *
 *  status()                          → JSON síncrono {conectada, estado, modo, modelo}
 *  imprimirEtiqueta(id, png, copias) → responde via window.__sunmiRetorno(id, json)
 *  lerQr(id)                         → idem, com {ok, valor}
 */
class SunmiBridge(
    private val context: Context,
    private val responder: (id: String, json: JSONObject) -> Unit,
    private val abrirLeitor: (id: String) -> Unit,
    private val aoVerificarAtualizacao: () -> Unit,
) {
    @Volatile private var impressora: SunmiPrinterService? = null
    @Volatile private var erroConexao: String? = null

    private val conexao = object : InnerPrinterCallback() {
        override fun onConnected(service: SunmiPrinterService) { impressora = service; erroConexao = null }
        override fun onDisconnected() { impressora = null }
    }

    fun conectar() {
        try {
            val ok = InnerPrinterManager.getInstance().bindService(context, conexao)
            if (!ok) erroConexao = "Serviço de impressão da Sunmi não encontrado neste aparelho."
        } catch (e: Exception) {
            erroConexao = "Falha ao conectar na impressora: ${e.message}"
        }
    }

    fun desconectar() {
        try { InnerPrinterManager.getInstance().unBindService(context, conexao) } catch (_: Exception) { }
    }

    @JavascriptInterface
    fun status(): String {
        val p = impressora
        val j = JSONObject()
        if (p == null) {
            j.put("conectada", false)
            j.put("erro", erroConexao ?: "Conectando na impressora…")
            return j.toString()
        }
        j.put("conectada", true)
        try { j.put("estado", p.updatePrinterState()) } catch (_: Exception) { }
        try { j.put("modo", p.printerMode) } catch (_: Exception) { }
        try { j.put("modelo", p.printerModal) } catch (_: Exception) { }
        return j.toString()
    }

    @JavascriptInterface
    fun imprimirEtiqueta(id: String, pngBase64: String, copias: Int) {
        val p = impressora
        if (p == null) { falha(id, erroConexao ?: "Impressora interna não conectada."); return }
        val bmp: Bitmap = try {
            val bytes = Base64.decode(pngBase64, Base64.DEFAULT)
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size) ?: run { falha(id, "Imagem da etiqueta inválida."); return }
        } catch (e: Exception) { falha(id, "Imagem da etiqueta inválida: ${e.message}"); return }

        try {
            // Transação: tudo vai para o buffer e o resultado chega num único callback.
            p.enterPrinterBuffer(true)
            repeat(copias.coerceIn(1, 50)) {
                p.labelLocate()            // avança até o início da etiqueta (sensor de gap)
                p.printBitmap(bmp, null)
                p.labelOutput()            // empurra a etiqueta até a serrilha para destacar
            }
            p.exitPrinterBufferWithCallback(true, object : InnerResultCallback() {
                override fun onRunResult(isSuccess: Boolean) { }
                override fun onReturnString(result: String?) { }
                override fun onRaiseException(code: Int, msg: String?) { falha(id, "Erro $code: ${msg ?: ""}") }
                override fun onPrintResult(code: Int, msg: String?) {
                    if (code == 0) ok(id) else falha(id, "Impressão falhou ($code): ${msg ?: ""}")
                }
            })
        } catch (e: Exception) {
            falha(id, "Erro ao imprimir: ${e.message}")
        }
    }

    @JavascriptInterface
    fun lerQr(id: String) = abrirLeitor(id)

    @JavascriptInterface
    fun verificarAtualizacao() = aoVerificarAtualizacao()

    private fun ok(id: String, valor: String? = null) {
        val j = JSONObject().put("ok", true)
        if (valor != null) j.put("valor", valor)
        responder(id, j)
    }

    fun falha(id: String, erro: String) = responder(id, JSONObject().put("ok", false).put("erro", erro))

    fun valorLido(id: String, valor: String?) {
        if (valor.isNullOrBlank()) responder(id, JSONObject().put("ok", false).put("erro", "Leitura cancelada"))
        else ok(id, valor)
    }
}

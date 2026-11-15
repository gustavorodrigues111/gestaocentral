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
            // MODO RECIBO (contínuo), SEM labelLocate/labelOutput — que, em modo
            // rótulo, faziam o recuo (Velocidade de reversão) e saía a etiqueta
            // ANTERIOR. O avanço por etiqueta NÃO é mais um lineWrap em "linhas"
            // (medida solta que descasava do passo e ia escorregando): o bitmap já
            // vem com a altura exata do passo (rótulo + gap, envelopado no lado web),
            // então cada printBitmap anda exatamente uma etiqueta.
            p.enterPrinterBuffer(true)
            repeat(copias.coerceIn(1, 50)) {
                p.printBitmap(bmp, null)
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

    // Diagnóstico do "sai a etiqueta anterior": imprime o mesmo bitmap com
    // sequências de comandos diferentes pra descobrir qual sai certa no aparelho.
    @JavascriptInterface
    fun imprimirSeq(id: String, pngBase64: String, seq: Int) {
        val p = impressora
        if (p == null) { falha(id, erroConexao ?: "Impressora interna não conectada."); return }
        val bmp: Bitmap = try {
            val bytes = Base64.decode(pngBase64, Base64.DEFAULT)
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size) ?: run { falha(id, "Imagem inválida."); return }
        } catch (e: Exception) { falha(id, "Imagem inválida: ${e.message}"); return }
        val cb = object : InnerResultCallback() {
            override fun onRunResult(isSuccess: Boolean) { }
            override fun onReturnString(result: String?) { }
            override fun onRaiseException(code: Int, msg: String?) { falha(id, "Erro $code: ${msg ?: ""}") }
            override fun onPrintResult(code: Int, msg: String?) { if (code == 0) ok(id) else falha(id, "Falhou ($code)") }
        }
        try {
            // Seq 9/10: commitPrinterBuffer (imprime na hora). 11/12: DRENA a fila
            // (commita 2x) porque o buffer parece FIFO e sobra sempre um.
            if (seq in 9..12) {
                p.enterPrinterBuffer(true)
                if (seq == 10) { p.printBitmap(bmp, null); p.labelLocate(); p.labelOutput() }
                else { p.labelLocate(); p.printBitmap(bmp, null); p.labelOutput() }
                p.commitPrinterBufferWithCallback(cb)        // imprime agora
                if (seq == 11) { try { p.commitPrinterBuffer() } catch (_: Exception) { } }                 // dreno extra
                if (seq == 12) { try { p.commitPrinterBuffer(); p.commitPrinterBuffer() } catch (_: Exception) { } } // dreno duplo
                try { p.exitPrinterBuffer(false) } catch (_: Exception) { }
                return
            }
            // Seq 16/17: MODO RECIBO (contínuo, sem recuo). Imprime "puro", sem
            // labelLocate/labelOutput (que são de etiqueta e causam o recuo).
            // Testar com a impressora em modo RECIBO nas configurações.
            if (seq == 16 || seq == 17) {
                p.enterPrinterBuffer(true)
                p.printBitmap(bmp, null)
                if (seq == 17) { p.lineWrap(3, null) }   // avança um pouco (gap)
                p.exitPrinterBufferWithCallback(true, cb)
                return
            }
            // Seq 13/14: DRENO por ciclos completos de enter/exit (o buffer é FIFO e
            // sobra 1; cada exit-commit esvazia 1). 13 = 2 ciclos, 14 = 3 ciclos.
            if (seq == 13 || seq == 14) {
                p.enterPrinterBuffer(true)
                p.labelLocate(); p.printBitmap(bmp, null); p.labelOutput()
                p.exitPrinterBuffer(true)                     // commit 1
                p.enterPrinterBuffer(true); p.exitPrinterBuffer(true)   // commit 2 (dreno)
                if (seq == 14) { p.enterPrinterBuffer(true); p.exitPrinterBuffer(true) }  // commit 3
                p.enterPrinterBuffer(true)
                p.exitPrinterBufferWithCallback(true, cb)     // fecha + callback
                return
            }
            p.enterPrinterBuffer(true)
            when (seq) {
                1 -> { p.labelLocate(); p.printBitmap(bmp, null); p.labelOutput() }                 // atual
                2 -> { p.printBitmap(bmp, null); p.labelOutput() }                                    // sem locate
                3 -> { p.labelLocate(); p.printBitmap(bmp, null) }                                    // sem output
                4 -> { p.printBitmap(bmp, null); p.labelLocate(); p.labelOutput() }                   // locate depois
                5 -> { p.labelOutput(); p.labelLocate(); p.printBitmap(bmp, null); p.labelOutput() }  // ejeta a da câmara antes
                6 -> { p.labelLocate(); p.printBitmap(bmp, null); p.labelOutput(); p.labelOutput() }     // output duplo
                7 -> { p.labelLocate(); p.printBitmap(bmp, null); p.labelOutput(); p.exitPrinterBuffer(true); p.enterPrinterBuffer(true) } // commit duplo
                8 -> { p.printBitmap(bmp, null); p.exitPrinterBuffer(true); p.enterPrinterBuffer(true); p.labelLocate(); p.labelOutput() } // imprime, flush, posiciona/ejeta
                else -> { p.labelLocate(); p.printBitmap(bmp, null); p.labelOutput() }
            }
            p.exitPrinterBufferWithCallback(true, cb)
        } catch (e: Exception) { falha(id, "Erro: ${e.message}") }
    }

    // TSPL bruto via sendRAWData: pula o buffer do SDK (que imprime o job
    // anterior). Converte o bitmap pra 1bpp e manda SIZE/GAP/BITMAP/PRINT.
    @JavascriptInterface
    fun imprimirTspl(id: String, pngBase64: String, larguraMm: Int, alturaMm: Int, gapMm: Int) {
        val p = impressora
        if (p == null) { falha(id, erroConexao ?: "Impressora interna não conectada."); return }
        val bmp: Bitmap = try {
            val bytes = Base64.decode(pngBase64, Base64.DEFAULT)
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size) ?: run { falha(id, "Imagem inválida."); return }
        } catch (e: Exception) { falha(id, "Imagem inválida: ${e.message}"); return }
        try {
            val w = bmp.width; val h = bmp.height
            val wb = (w + 7) / 8
            val data = ByteArray(wb * h)
            for (y in 0 until h) {
                for (xb in 0 until wb) {
                    var b = 0
                    for (bit in 0 until 8) {
                        val x = xb * 8 + bit
                        // bit 1 = branco (não imprime); 0 = preto (imprime)
                        val branco = if (x < w) {
                            val px = bmp.getPixel(x, y)
                            val lum = (0.299 * ((px shr 16) and 0xFF) + 0.587 * ((px shr 8) and 0xFF) + 0.114 * (px and 0xFF))
                            lum > 128
                        } else true
                        if (branco) b = b or (0x80 shr bit)
                    }
                    data[y * wb + xb] = b.toByte()
                }
            }
            val header = "SIZE $larguraMm mm,$alturaMm mm\r\nGAP $gapMm mm,0 mm\r\nDIRECTION 1\r\nREFERENCE 0,0\r\nCLS\r\nBITMAP 0,0,$wb,$h,0,".toByteArray(Charsets.US_ASCII)
            val footer = "\r\nPRINT 1,1\r\n".toByteArray(Charsets.US_ASCII)
            val out = header + data + footer
            p.sendRAWData(out, object : InnerResultCallback() {
                override fun onRunResult(isSuccess: Boolean) { if (isSuccess) ok(id) else falha(id, "RAW falhou") }
                override fun onReturnString(result: String?) { }
                override fun onRaiseException(code: Int, msg: String?) { falha(id, "Erro $code: ${msg ?: ""}") }
                override fun onPrintResult(code: Int, msg: String?) { }
            })
        } catch (e: Exception) { falha(id, "Erro TSPL: ${e.message}") }
    }

    // Avança/ejeta uma etiqueta — empurra pra fora a que ficou "presa" na câmara
    // por causa do recuo. Operador toca quando quer soltar a última.
    @JavascriptInterface
    fun avancarEtiqueta(id: String) {
        val p = impressora
        if (p == null) { falha(id, erroConexao ?: "Impressora interna não conectada."); return }
        val cb = object : InnerResultCallback() {
            override fun onRunResult(isSuccess: Boolean) { }
            override fun onReturnString(result: String?) { }
            override fun onRaiseException(code: Int, msg: String?) { falha(id, "Erro $code: ${msg ?: ""}") }
            override fun onPrintResult(code: Int, msg: String?) { if (code == 0) ok(id) else falha(id, "Falhou ($code)") }
        }
        try {
            p.enterPrinterBuffer(true)
            p.labelLocate()
            p.labelOutput()
            p.exitPrinterBufferWithCallback(true, cb)
        } catch (e: Exception) { falha(id, "Erro: ${e.message}") }
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

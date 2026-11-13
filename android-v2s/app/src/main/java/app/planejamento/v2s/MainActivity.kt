package app.planejamento.v2s

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageInstaller
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.view.KeyEvent
import android.view.WindowManager
import android.webkit.CookieManager
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import org.json.JSONObject

/**
 * Casca do planejamento.app para a maquininha: um WebView em tela cheia que
 * carrega o site de produção (sempre a versão mais nova, sem reinstalar) e
 * injeta window.SunmiBridge para a impressora interna e o leitor de QR.
 */
class MainActivity : Activity() {

    private lateinit var web: WebView
    private lateinit var ponte: SunmiBridge
    private var arquivoCallback: ValueCallback<Array<Uri>>? = null
    private var pedidoCamera: PermissionRequest? = null
    private var leituraPendente: String? = null

    companion object {
        private const val REQ_ARQUIVO = 10
        private const val REQ_QR = 11
        private const val REQ_PERM_CAMERA = 12
        private val HOSTS_INTERNOS = listOf("planejamento.app")
    }

    @SuppressLint("SetJavaScriptEnabled", "JavascriptInterface")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        web = WebView(this)
        setContentView(web)

        with(web.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true          // Firebase Auth / Firestore offline
            databaseEnabled = true
            mediaPlaybackRequiresUserGesture = false
            cacheMode = WebSettings.LOAD_DEFAULT
            userAgentString = "$userAgentString PlanejamentoV2s/${BuildConfig.VERSION_NAME}"
        }
        CookieManager.getInstance().setAcceptCookie(true)
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, true)

        ponte = SunmiBridge(applicationContext, ::responderJs, ::abrirLeitorQr) {
            Atualizador.verificar(this, false)   // menu "Buscar atualização" (avisa mesmo se já estiver na última)
        }
        ponte.conectar()
        web.addJavascriptInterface(ponte, "SunmiBridge")

        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, req: WebResourceRequest): Boolean {
                val host = req.url.host ?: return false
                val interno = HOSTS_INTERNOS.any { host == it || host.endsWith(".$it") } ||
                    host.endsWith("firebaseapp.com") || host.endsWith("googleapis.com")
                if (interno) return false
                // Links externos (WhatsApp, Drive, mapas…) abrem fora do app.
                try { startActivity(Intent(Intent.ACTION_VIEW, req.url)) } catch (_: Exception) { }
                return true
            }
        }

        web.webChromeClient = object : WebChromeClient() {
            // Câmera para o leitor de QR do próprio site (fallback do leitor Sunmi)
            override fun onPermissionRequest(request: PermissionRequest) {
                runOnUiThread {
                    if (checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
                        request.grant(request.resources)
                    } else {
                        pedidoCamera = request
                        requestPermissions(arrayOf(Manifest.permission.CAMERA), REQ_PERM_CAMERA)
                    }
                }
            }

            // <input type="file"> (foto de nota fiscal no Recebimento, por exemplo)
            override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
                arquivoCallback?.onReceiveValue(null)
                arquivoCallback = callback
                return try { startActivityForResult(params.createIntent(), REQ_ARQUIVO); true }
                catch (_: Exception) { arquivoCallback = null; false }
            }
        }

        if (savedInstanceState != null) web.restoreState(savedInstanceState)
        else web.loadUrl(BuildConfig.URL_INICIAL)

        // Checa atualização do app pouco depois de abrir (silencioso: só avisa se houver).
        web.postDelayed({ Atualizador.verificar(this, true) }, 4000)
        tratarResultadoInstalacao(intent)
    }

    // PackageInstaller devolve o pedido de confirmação de instalação aqui.
    @Deprecated("Activity simples, sem AndroidX")
    override fun onNewIntent(novo: Intent?) {
        super.onNewIntent(novo)
        setIntent(novo)
        tratarResultadoInstalacao(novo)
    }

    private fun tratarResultadoInstalacao(i: Intent?) {
        if (i?.action != "app.planejamento.v2s.INSTALL_RESULT") return
        val status = i.getIntExtra(PackageInstaller.EXTRA_STATUS, Int.MIN_VALUE)
        if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
            @Suppress("DEPRECATION")
            val confirmar = i.getParcelableExtra<Intent>(Intent.EXTRA_INTENT)
            confirmar?.let {
                it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                try { startActivity(it) } catch (_: Exception) { }
            }
        } else if (status == PackageInstaller.STATUS_FAILURE || status == PackageInstaller.STATUS_FAILURE_ABORTED) {
            val msg = i.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE)
            if (!msg.isNullOrBlank()) Toast.makeText(this, "Atualização não concluída: $msg", Toast.LENGTH_LONG).show()
        }
    }

    private fun responderJs(id: String, json: JSONObject) {
        val js = "window.__sunmiRetorno && window.__sunmiRetorno(${JSONObject.quote(id)}, ${JSONObject.quote(json.toString())})"
        runOnUiThread { web.evaluateJavascript(js, null) }
    }

    // Leitor de QR nativo da Sunmi (app "com.sunmi.sunmiqrcodescanner").
    private fun abrirLeitorQr(id: String) {
        runOnUiThread {
            leituraPendente = id
            try {
                val i = Intent("com.summi.scan").setPackage("com.sunmi.sunmiqrcodescanner")
                startActivityForResult(i, REQ_QR)
            } catch (_: Exception) {
                leituraPendente = null
                ponte.falha(id, "Leitor da Sunmi indisponível")
            }
        }
    }

    @Deprecated("Activity simples, sem AndroidX")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        when (requestCode) {
            REQ_ARQUIVO -> {
                arquivoCallback?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data))
                arquivoCallback = null
            }
            REQ_QR -> {
                val id = leituraPendente ?: return
                leituraPendente = null
                var valor: String? = null
                try {
                    @Suppress("UNCHECKED_CAST", "DEPRECATION")
                    val lista = data?.extras?.getSerializable("data") as? ArrayList<HashMap<String, String>>
                    valor = lista?.firstOrNull()?.get("VALUE")
                } catch (_: Exception) { }
                ponte.valorLido(id, if (resultCode == RESULT_OK) valor else null)
            }
        }
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == REQ_PERM_CAMERA) {
            val req = pedidoCamera ?: return
            pedidoCamera = null
            if (grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED) req.grant(req.resources)
            else { req.deny(); Toast.makeText(this, "Sem permissão de câmera", Toast.LENGTH_SHORT).show() }
        }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        web.saveState(outState)
    }

    // Botão físico de leitura da maquininha: avisa a tela ativa (via
    // window.__sunmiTeclaScan), que abre o leitor nativo e roteia o código.
    // A tecla de scan da Sunmi chega como keycode (520/521, F1-F4, …) — num
    // kiosk sem teclado, qualquer tecla de função F1+ ou FOCUS/CAMERA é o
    // gatilho; teclas de digitação e de sistema (volume/voltar/etc.) passam.
    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (event.action == KeyEvent.ACTION_DOWN && event.repeatCount == 0 && ehTeclaScan(event)) {
            runOnUiThread { web.evaluateJavascript("window.__sunmiTeclaScan && window.__sunmiTeclaScan()", null) }
            return true
        }
        return super.dispatchKeyEvent(event)
    }

    private fun ehTeclaScan(e: KeyEvent): Boolean {
        if (e.isPrintingKey) return false
        val kc = e.keyCode
        return kc >= KeyEvent.KEYCODE_F1 || kc == KeyEvent.KEYCODE_FOCUS || kc == KeyEvent.KEYCODE_CAMERA
    }

    @Deprecated("Activity simples, sem AndroidX")
    override fun onBackPressed() {
        if (web.canGoBack()) web.goBack() else @Suppress("DEPRECATION") super.onBackPressed()
    }

    override fun onDestroy() {
        ponte.desconectar()
        web.destroy()
        super.onDestroy()
    }
}

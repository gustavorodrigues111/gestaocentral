package app.planejamento.v2s

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageInstaller
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Color
import android.net.ConnectivityManager
import android.net.Network
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.view.KeyEvent
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.FrameLayout
import android.webkit.CookieManager
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
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

    // Economia de tela: após 45s sem toque, "apaga" a tela (cobre com preto e
    // zera o brilho) pra não gastar/queimar o painel ligado o dia todo. Qualquer
    // toque acorda na hora (e o toque que acorda não clica em nada).
    private lateinit var telaOverlay: View
    private var telaApagada = false
    private val TELA_OCIOSA_MS = 45_000L
    private val apagarRun = Runnable { apagarTela() }

    // Resiliência de rede: se a carga do site falhar (queda de internet), não
    // deixa o WebView preso na tela de erro — mostra uma tela amigável, tenta
    // sozinho a cada 6s e recarrega assim que a conexão voltar.
    private var ultimaFalha = false
    private var erroNestaCarga = false
    private val retry = Runnable { if (ultimaFalha) web.loadUrl(BuildConfig.URL_INICIAL) }
    private val netCallback = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) { runOnUiThread { if (ultimaFalha) web.loadUrl(BuildConfig.URL_INICIAL) } }
    }

    private fun mostrarOffline() {
        val html = """<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>
            body{font-family:system-ui,sans-serif;margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f6f6f5;color:#333;text-align:center;padding:24px}
            h1{font-size:20px;margin:0 0 8px}p{color:#777;font-size:14px;line-height:1.5;margin:0}
            a{display:inline-block;margin-top:20px;background:#4f46e5;color:#fff;text-decoration:none;padding:14px 28px;border-radius:14px;font-weight:600;font-size:16px}
            </style></head><body><div><h1>Sem internet</h1><p>A maquininha está sem conexão.<br>Tentando reconectar sozinho…</p>
            <a href="${BuildConfig.URL_INICIAL}">Tentar de novo</a></div></body></html>"""
        web.loadDataWithBaseURL(null, html, "text/html", "utf-8", null)
    }

    // Leitor a laser/imager (versão Scanner): o SO manda o código já decodificado
    // por broadcast. Encaminha pro site sem abrir câmera. Requer "saída por
    // broadcast" ligada em Configurações > Scanner da maquininha.
    private val scanReceiver = object : BroadcastReceiver() {
        override fun onReceive(c: Context?, i: Intent?) {
            val code = i?.getStringExtra("data")
            if (!code.isNullOrBlank()) {
                val js = "window.__sunmiCodigoScan && window.__sunmiCodigoScan(${org.json.JSONObject.quote(code)})"
                runOnUiThread { web.evaluateJavascript(js, null) }
            }
        }
    }

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
        // Raiz = WebView + overlay preto (a "tela apagada") por cima.
        val root = FrameLayout(this)
        root.addView(web)
        telaOverlay = View(this).apply {
            setBackgroundColor(Color.BLACK)
            visibility = View.GONE
            isClickable = true   // enquanto visível, segura o toque (não vaza pro site)
        }
        root.addView(telaOverlay, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        setContentView(root)

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
            override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) { erroNestaCarga = false }
            override fun onReceivedError(view: WebView, req: WebResourceRequest, err: WebResourceError) {
                if (!req.isForMainFrame) return
                erroNestaCarga = true; ultimaFalha = true
                mostrarOffline()
                web.removeCallbacks(retry); web.postDelayed(retry, 6000)
            }
            override fun onPageFinished(view: WebView, url: String) {
                if (!erroNestaCarga && url.startsWith("http")) { ultimaFalha = false; web.removeCallbacks(retry) }
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
        agendarApagar()
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
    // Na V2s base os únicos botões são Liga/Desliga + Volume (+/−); os DOIS de
    // volume viram o gatilho do leitor (o app consome a tecla, então o volume
    // não muda). Também cobre a tecla de scan dedicada (F1+/FOCUS/CAMERA) nas
    // versões Scanner. Liga/Desliga e digitação passam normalmente.
    // ── Economia de tela (ociosidade) ────────────────────────────────────────
    private fun agendarApagar() {
        if (!::web.isInitialized) return
        web.removeCallbacks(apagarRun)
        web.postDelayed(apagarRun, TELA_OCIOSA_MS)
    }
    private fun apagarTela() {
        if (telaApagada) return
        telaApagada = true
        telaOverlay.visibility = View.VISIBLE
        val lp = window.attributes; lp.screenBrightness = 0f; window.attributes = lp
    }
    private fun acordar() {
        if (telaApagada) {
            telaApagada = false
            telaOverlay.visibility = View.GONE
            val lp = window.attributes
            lp.screenBrightness = WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_NONE   // -1 = volta ao brilho do sistema
            window.attributes = lp
        }
        agendarApagar()
    }

    override fun dispatchTouchEvent(ev: MotionEvent): Boolean {
        if (telaApagada) {
            if (ev.action == MotionEvent.ACTION_DOWN) acordar()
            return true   // o toque que acorda não clica em nada
        }
        agendarApagar()
        return super.dispatchTouchEvent(ev)
    }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (telaApagada) {
            if (event.action == KeyEvent.ACTION_DOWN) acordar()
            return true
        }
        agendarApagar()
        if (ehTeclaScan(event)) {
            if (event.action == KeyEvent.ACTION_DOWN && event.repeatCount == 0) {
                runOnUiThread { web.evaluateJavascript("window.__sunmiTeclaScan && window.__sunmiTeclaScan()", null) }
            }
            return true   // consome down/up/repeat: volume não muda e não aparece a barra
        }
        return super.dispatchKeyEvent(event)
    }

    private fun ehTeclaScan(e: KeyEvent): Boolean {
        if (e.isPrintingKey) return false
        val kc = e.keyCode
        if (kc == KeyEvent.KEYCODE_VOLUME_UP || kc == KeyEvent.KEYCODE_VOLUME_DOWN) return true
        return kc >= KeyEvent.KEYCODE_F1 || kc == KeyEvent.KEYCODE_FOCUS || kc == KeyEvent.KEYCODE_CAMERA
    }

    @Deprecated("Activity simples, sem AndroidX")
    override fun onBackPressed() {
        if (web.canGoBack()) web.goBack() else @Suppress("DEPRECATION") super.onBackPressed()
    }

    override fun onStart() {
        super.onStart()
        val filtro = IntentFilter("com.sunmi.scanner.ACTION_DATA_CODE_RECEIVED")
        try {
            if (Build.VERSION.SDK_INT >= 33) registerReceiver(scanReceiver, filtro, Context.RECEIVER_EXPORTED)
            else @Suppress("UnspecifiedRegisterReceiverFlag") registerReceiver(scanReceiver, filtro)
        } catch (_: Exception) { }
        try { (getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager).registerDefaultNetworkCallback(netCallback) } catch (_: Exception) { }
        if (::telaOverlay.isInitialized) acordar()   // volta ligada e reinicia o cronômetro de ociosidade
    }

    override fun onStop() {
        try { unregisterReceiver(scanReceiver) } catch (_: Exception) { }
        try { (getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager).unregisterNetworkCallback(netCallback) } catch (_: Exception) { }
        super.onStop()
    }

    override fun onDestroy() {
        web.removeCallbacks(apagarRun)
        ponte.desconectar()
        web.destroy()
        super.onDestroy()
    }
}

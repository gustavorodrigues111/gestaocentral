// Renderiza uma Página hospedada em pages.planejamento.app/<slug>.
// Todo o acesso é decidido no servidor (/api/hosted-page): o HTML só chega aqui
// quando o acesso é liberado. Público abre direto; privado pede senha da página
// e/ou login com e-mail autorizado. O HTML roda num iframe isolado (sandbox).
import { useCallback, useEffect, useState } from "react";
import { signInWithEmailAndPassword } from "firebase/auth";
import { auth } from "../../core/firebase/config";

type Resp =
  | { ok: true; html: string; titulo?: string }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "inactive"; titulo?: string }
  | { ok: false; reason: "forbidden"; titulo?: string; precisa?: { email?: boolean; senha?: boolean } }
  | { ok: false; reason: "error" | "method" | "bad_request"; titulo?: string };

const wrap: React.CSSProperties = { minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f7f7f8", color: "#333", fontFamily: "system-ui, sans-serif", padding: 24 };
const card: React.CSSProperties = { width: "100%", maxWidth: 380, background: "#fff", border: "1px solid #e5e7eb", borderRadius: 16, padding: 24, boxShadow: "0 10px 40px -12px rgba(0,0,0,0.15)" };
const inputCss: React.CSSProperties = { width: "100%", padding: "10px 12px", fontSize: 14, borderRadius: 10, border: "1px solid #d1d5db", marginTop: 6, boxSizing: "border-box" };
const btnCss: React.CSSProperties = { width: "100%", padding: "10px 12px", fontSize: 14, fontWeight: 600, borderRadius: 10, border: "none", background: "#4f46e5", color: "#fff", cursor: "pointer", marginTop: 12 };

export function HostedPagePublic({ slug }: { slug: string }) {
  const [estado, setEstado] = useState<"carregando" | "ok" | "gate" | "erro">("carregando");
  const [html, setHtml] = useState("");
  const [titulo, setTitulo] = useState("");
  const [precisa, setPrecisa] = useState<{ email?: boolean; senha?: boolean }>({});
  const [msgErro, setMsgErro] = useState("");
  const [senha, setSenha] = useState("");
  const [loginEmail, setLoginEmail] = useState("");
  const [loginSenha, setLoginSenha] = useState("");
  const [enviando, setEnviando] = useState(false);

  const buscar = useCallback(async (extra?: { senha?: string; idToken?: string }) => {
    setEnviando(true); setMsgErro("");
    try {
      const r = await fetch("/api/hosted-page", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ slug, ...extra }) });
      const j = (await r.json()) as Resp;
      if (j.ok) { setHtml(j.html); setTitulo(j.titulo || ""); setEstado("ok"); return; }
      if (j.reason === "not_found") { setTitulo(""); setMsgErro("Página não encontrada."); setEstado("erro"); return; }
      if (j.reason === "inactive") { setTitulo(j.titulo || ""); setMsgErro("Esta página está indisponível no momento."); setEstado("erro"); return; }
      if (j.reason === "forbidden") { setTitulo(j.titulo || ""); setPrecisa(j.precisa || {}); if (extra) setMsgErro("Acesso negado — verifique a senha ou o e-mail."); setEstado("gate"); return; }
      setMsgErro("Não foi possível abrir a página."); setEstado("erro");
    } catch {
      setMsgErro("Falha de conexão."); setEstado("erro");
    } finally { setEnviando(false); }
  }, [slug]);

  useEffect(() => {
    if (!slug) { setMsgErro("Endereço inválido."); setEstado("erro"); return; }
    // Se já estiver logado, manda o token junto de cara (allowlist).
    const u = auth.currentUser;
    if (u) u.getIdToken().then((t) => void buscar({ idToken: t })).catch(() => void buscar());
    else void buscar();
  }, [slug, buscar]);

  async function tentarSenha(e: React.FormEvent) {
    e.preventDefault();
    await buscar({ senha });
  }
  async function tentarLogin(e: React.FormEvent) {
    e.preventDefault();
    setEnviando(true); setMsgErro("");
    try {
      await signInWithEmailAndPassword(auth, loginEmail.trim().toLowerCase(), loginSenha);
      const t = await auth.currentUser!.getIdToken();
      await buscar({ idToken: t });
    } catch {
      setMsgErro("E-mail ou senha incorretos."); setEnviando(false);
    }
  }

  if (estado === "carregando") return <div style={wrap}><span style={{ color: "#999", fontSize: 13 }}>Carregando…</span></div>;

  if (estado === "ok") {
    return (
      <iframe
        title={titulo || slug}
        srcDoc={html}
        sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals"
        style={{ border: "none", width: "100vw", height: "100vh", display: "block" }}
      />
    );
  }

  if (estado === "erro") {
    return <div style={wrap}><div style={{ ...card, textAlign: "center" }}><div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>{titulo || "planejamento.app"}</div><div style={{ fontSize: 13, color: "#666" }}>{msgErro}</div></div></div>;
  }

  // gate (privado)
  return (
    <div style={wrap}>
      <div style={card}>
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>{titulo || "Conteúdo restrito"}</div>
        <div style={{ fontSize: 13, color: "#666", marginBottom: 16 }}>Esta página é privada.</div>

        {precisa.senha && (
          <form onSubmit={tentarSenha} style={{ marginBottom: precisa.email ? 18 : 0 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: "#444" }}>Senha da página</label>
            <input type="password" value={senha} onChange={(e) => setSenha(e.target.value)} style={inputCss} autoFocus />
            <button type="submit" disabled={enviando} style={btnCss}>{enviando ? "…" : "Entrar"}</button>
          </form>
        )}

        {precisa.email && (
          <form onSubmit={tentarLogin}>
            {precisa.senha && <div style={{ textAlign: "center", fontSize: 11, color: "#999", margin: "4px 0 10px" }}>ou entre com seu e-mail autorizado</div>}
            <label style={{ fontSize: 12, fontWeight: 600, color: "#444" }}>E-mail</label>
            <input type="email" value={loginEmail} onChange={(e) => setLoginEmail(e.target.value)} style={inputCss} placeholder="voce@email.com" />
            <label style={{ fontSize: 12, fontWeight: 600, color: "#444", display: "block", marginTop: 10 }}>Senha</label>
            <input type="password" value={loginSenha} onChange={(e) => setLoginSenha(e.target.value)} style={inputCss} />
            <button type="submit" disabled={enviando} style={btnCss}>{enviando ? "…" : "Entrar com e-mail"}</button>
          </form>
        )}

        {msgErro && <div style={{ fontSize: 12, color: "#dc2626", marginTop: 12, textAlign: "center" }}>{msgErro}</div>}
      </div>
    </div>
  );
}

import { useState, type FormEvent } from "react";
import { House, Smartphone } from "lucide-react";
import { Link } from "react-router-dom";
import { sendPasswordResetEmail } from "firebase/auth";
import { auth } from "../firebase/config";
import { useAuth } from "./AuthContext";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { detectSubdomain, isEtiquetasKioskHost } from "../restaurant/subdomain";
import { iniciarPareamento } from "./pareamentoMaquina";

export function LoginScreen() {
  const { signIn } = useAuth();
  // Pre-auth: só temos o subdomain bruto. Pra ter o nome do restaurante
  // precisaria de auth ou regras permissivas. Mostra o subdomain como
  // pista visual, e após login o nome real aparece.
  const subdomain = detectSubdomain();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [resetMsg, setResetMsg] = useState("");
  const [resetting, setResetting] = useState(false);
  const ehKioskEtiq = isEtiquetasKioskHost();
  const [pareErro, setPareErro] = useState("");
  const [pareCodigo, setPareCodigo] = useState("");       // código mostrado na tela
  const [pareando, setPareando] = useState(false);        // aguardando aprovação
  const [cancelarPare, setCancelarPare] = useState<(() => void) | null>(null);
  async function iniciarPareamentoMaquina() {
    setPareErro(""); setPareCodigo(""); setPareando(true);
    const cancelar = await iniciarPareamento({
      onCodigo: (c) => setPareCodigo(c),
      onErro: (msg) => { setPareErro(msg); setPareando(false); setPareCodigo(""); setCancelarPare(null); },
      onSucesso: () => { /* a instância primária logou; o app troca de tela sozinho */ },
    });
    setCancelarPare(() => cancelar);
  }
  function pararPareamento() {
    cancelarPare?.(); setCancelarPare(null); setPareando(false); setPareCodigo(""); setPareErro("");
  }

  async function handleReset() {
    const alvo = email.trim().toLowerCase();
    setError(""); setResetMsg("");
    if (!alvo) { setError("Digite seu email acima primeiro, aí clico o reset."); return; }
    setResetting(true);
    try {
      await sendPasswordResetEmail(auth, alvo);
      setResetMsg(`Enviei um link de redefinição pra ${alvo}. Confira a caixa de entrada e o spam.`);
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code;
      // Não revela se o email existe (privacidade): trata user-not-found como sucesso.
      if (code === "auth/user-not-found") setResetMsg(`Se ${alvo} tiver conta, o link de redefinição chega em instantes.`);
      else if (code === "auth/invalid-email") setError("Email inválido.");
      else if (code === "auth/too-many-requests") setError("Muitas tentativas — aguarde alguns minutos.");
      else setError(err instanceof Error ? err.message : "Não consegui enviar o email de redefinição.");
    } finally { setResetting(false); }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await signIn(email, password);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Erro ao entrar";
      const code = (err as { code?: string })?.code;
      if (code === "auth/invalid-credential" || code === "auth/wrong-password" || code === "auth/user-not-found") {
        setError("Email ou senha incorretos");
      } else if (code === "auth/too-many-requests") {
        setError("Muitas tentativas — aguarde alguns minutos");
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-gray-50 dark:bg-gray-950">
      <form onSubmit={handleSubmit} className="w-full max-w-sm bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-8 shadow-sm">
        <div className="text-center mb-6">
          <div className="flex justify-center mb-2 text-indigo-500"><House size={30} /></div>
          {subdomain ? (
            <>
              <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">
                {capitalize(subdomain)}
              </h1>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                {subdomain}.planejamento.app
              </p>
              <p className="text-sm text-gray-600 dark:text-gray-300 mt-2">Entre com seu email e senha</p>
            </>
          ) : (
            <>
              <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">planejamento.app</h1>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Entre com seu email e senha</p>
            </>
          )}
        </div>

        <div className="flex flex-col gap-3">
          <Input
            label="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="voce@exemplo.com"
            autoComplete="email"
            required
            autoFocus
          />
          <Input
            label="Senha"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            autoComplete="current-password"
            required
          />

          {error && (
            <div className="text-sm text-red-600 bg-red-50 dark:bg-red-900/30 dark:text-red-400 border border-red-200 dark:border-red-900 rounded-lg px-3 py-2">
              {error}
            </div>
          )}
          {resetMsg && (
            <div className="text-sm text-emerald-700 bg-emerald-50 dark:bg-emerald-900/30 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-900 rounded-lg px-3 py-2">
              {resetMsg}
            </div>
          )}

          <Button type="submit" disabled={loading || !email || !password} size="lg" className="mt-2">
            {loading ? "Entrando..." : "Entrar"}
          </Button>

          {ehKioskEtiq && (
            <>
              <div className="flex items-center gap-2 my-1"><div className="flex-1 border-t border-gray-200 dark:border-gray-800" /><span className="text-[11px] text-gray-400">ou</span><div className="flex-1 border-t border-gray-200 dark:border-gray-800" /></div>
              {pareCodigo ? (
                <div className="text-center rounded-xl border border-indigo-200 dark:border-indigo-900 bg-indigo-50/60 dark:bg-indigo-950/30 p-4">
                  <div className="text-xs text-gray-600 dark:text-gray-300 mb-1">No planejamento.app, digite este código pra vincular esta máquina:</div>
                  <div className="text-4xl font-black tracking-[0.2em] text-indigo-700 dark:text-indigo-300 my-1 tabular-nums">{pareCodigo}</div>
                  <div className="text-[11px] text-gray-500 inline-flex items-center justify-center gap-1.5"><span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" /> Aguardando aprovação…</div>
                  <button type="button" onClick={pararPareamento} className="block mx-auto mt-2 text-xs text-gray-400">cancelar</button>
                </div>
              ) : (
                <button type="button" onClick={() => void iniciarPareamentoMaquina()} disabled={pareando}
                  className="w-full h-12 rounded-xl bg-indigo-600 text-white font-semibold inline-flex items-center justify-center gap-2 active:scale-[.99] disabled:opacity-60">
                  <Smartphone size={18} /> {pareando ? "Gerando código…" : "Parear esta maquininha"}
                </button>
              )}
              {pareErro && <div className="text-sm text-red-600 bg-red-50 dark:bg-red-900/30 dark:text-red-400 border border-red-200 dark:border-red-900 rounded-lg px-3 py-2">{pareErro}</div>}
              {!pareCodigo && <p className="text-[11px] text-gray-400 text-center">Gera um código aqui; você digita ele no planejamento.app (Etiquetas › Cadastro › Máquinas › a máquina › Vincular aparelho).</p>}
            </>
          )}

          <button
            type="button"
            onClick={handleReset}
            disabled={resetting}
            className="text-xs text-gray-500 dark:text-gray-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:underline disabled:opacity-60"
          >
            {resetting ? "Enviando…" : "Esqueci minha senha"}
          </button>

          <div className="text-center mt-4 pt-4 border-t border-gray-200 dark:border-gray-800">
            <p className="text-xs text-gray-500 dark:text-gray-500 mb-2">
              Primeiro acesso?
            </p>
            <Link
              to="/signup"
              className="inline-block text-sm font-semibold text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 hover:underline"
            >
              Criar minha senha →
            </Link>
            <p className="text-[11px] text-gray-400 dark:text-gray-600 mt-2 leading-snug">
              Acesso só por convite. Você precisa ter sido cadastrado pelo administrador antes.
            </p>
          </div>
        </div>
      </form>
    </div>
  );
}

function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

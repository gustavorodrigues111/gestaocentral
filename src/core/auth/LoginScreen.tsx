import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "./AuthContext";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { detectSubdomain } from "../restaurant/subdomain";

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
          <div className="text-3xl mb-2">🏠</div>
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

          <Button type="submit" disabled={loading || !email || !password} size="lg" className="mt-2">
            {loading ? "Entrando..." : "Entrar"}
          </Button>

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

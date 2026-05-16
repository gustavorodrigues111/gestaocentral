import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { collection, query, where, limit, getDocs } from "firebase/firestore";
import { auth, db } from "../firebase/config";
import { useAuth } from "./AuthContext";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { detectSubdomain } from "../restaurant/subdomain";

export function SignupScreen() {
  const { signUp } = useAuth();
  const subdomain = detectSubdomain();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (password !== password2) {
      setError("Senhas não conferem");
      return;
    }
    if (password.length < 6) {
      setError("Senha precisa ter pelo menos 6 caracteres");
      return;
    }
    setLoading(true);
    const emailNorm = email.trim().toLowerCase();
    try {
      // 1) Cria conta no Firebase Auth primeiro — Firebase Auth não depende
      //    das Firestore Rules. Antes a consulta a pessoas vinha primeiro,
      //    mas como o user ainda não está autenticado, as Rules bloqueavam
      //    com "Missing or insufficient permissions".
      await signUp(emailNorm, password);
      // 2) Já autenticado → agora consegue ler pessoas. Verifica vínculo.
      const q = query(
        collection(db, "pessoas"),
        where("email", "==", emailNorm),
        limit(1)
      );
      const qsnap = await getDocs(q);
      if (qsnap.empty) {
        // Não existe pessoa pra esse email → desfaz a criação da conta
        // (não queremos Firebase Auth órfão sem vínculo)
        try {
          await auth.currentUser?.delete();
        } catch (delErr) {
          console.warn("Não consegui deletar a conta órfã:", delErr);
        }
        setError("Email não está cadastrado no sistema. Peça pro administrador te cadastrar primeiro com este email, e tente de novo.");
        setLoading(false);
        return;
      }
      // 3) Pessoa existe → AuthContext detecta e vincula automaticamente
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code;
      if (code === "auth/email-already-in-use") {
        setError("Esse email já tem conta criada. Use 'Entrar' em vez de 'Criar conta'.");
      } else if (code === "auth/weak-password") {
        setError("Senha fraca demais. Use pelo menos 6 caracteres com mistura.");
      } else {
        setError(err instanceof Error ? err.message : "Erro ao criar conta");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-gray-50 dark:bg-gray-950">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-8 shadow-sm"
      >
        <div className="text-center mb-6">
          <div className="text-3xl mb-2">🔐</div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">Primeiro acesso</h1>
          {subdomain && (
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              {subdomain}.planejamento.app
            </p>
          )}
          <p className="text-sm text-gray-600 dark:text-gray-300 mt-2">
            Defina sua senha pra começar
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-500 mt-2">
            Use exatamente o email que o admin cadastrou pra você.
          </p>
        </div>

        <div className="flex flex-col gap-3">
          <Input
            label="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="voce@exemplo.com"
            required
            autoFocus
          />
          <Input
            label="Senha (mín 6 caracteres)"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            required
          />
          <Input
            label="Confirmar senha"
            type="password"
            value={password2}
            onChange={(e) => setPassword2(e.target.value)}
            placeholder="••••••••"
            required
          />

          {error && (
            <div className="text-sm text-red-600 bg-red-50 dark:bg-red-900/30 dark:text-red-400 border border-red-200 dark:border-red-900 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          <Button type="submit" disabled={loading} size="lg" className="mt-2">
            {loading ? "Criando..." : "Criar conta"}
          </Button>

          <div className="text-center text-sm mt-2">
            <Link to="/login" className="text-indigo-600 dark:text-indigo-400 hover:underline">
              Já tem conta? Entrar
            </Link>
          </div>
        </div>
      </form>
    </div>
  );
}

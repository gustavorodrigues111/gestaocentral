import { useState, type FormEvent } from "react";
import { Button } from "../ui/Button";
import { isValidSubdomain } from "../restaurant/subdomain";

const ADMIN_HOST = "admin.planejamento.app";

export function WelcomePage() {
  const [sub, setSub] = useState("");
  const [err, setErr] = useState("");

  function go(e: FormEvent) {
    e.preventDefault();
    setErr("");
    const s = sub.trim().toLowerCase();
    if (!s) return;
    if (!isValidSubdomain(s)) {
      setErr("Use só letras minúsculas, números e hífen (3-30 caracteres).");
      return;
    }
    window.location.href = `https://${s}.planejamento.app`;
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 bg-gradient-to-br from-gray-50 to-indigo-50 dark:from-gray-950 dark:to-indigo-950">
      <div className="w-full max-w-md bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-8 shadow-sm">
        <div className="text-center mb-6">
          <div className="text-4xl mb-3">🏠</div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">planejamento.app</h1>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-2">
            Gestão de restaurantes simplificada
          </p>
        </div>

        <form onSubmit={go} className="space-y-3">
          <div>
            <label htmlFor="sub" className="text-xs font-semibold text-gray-600 dark:text-gray-400 mb-1 block uppercase tracking-wider">
              Endereço do seu restaurante
            </label>
            <div className="flex items-stretch">
              <input
                id="sub"
                type="text"
                value={sub}
                onChange={(e) => setSub(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                placeholder="seurestaurante"
                autoFocus
                autoComplete="off"
                className="flex-1 min-w-0 px-3 py-2.5 text-sm rounded-l-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:border-indigo-500"
              />
              <span className="px-3 py-2.5 text-sm rounded-r-lg border border-l-0 border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 text-gray-500 dark:text-gray-400 whitespace-nowrap">
                .planejamento.app
              </span>
            </div>
          </div>

          {err && (
            <div className="text-sm text-red-600 bg-red-50 dark:bg-red-900/30 dark:text-red-400 border border-red-200 dark:border-red-900 rounded-lg px-3 py-2">
              {err}
            </div>
          )}

          <Button type="submit" disabled={!sub} size="lg" className="w-full">
            Acessar →
          </Button>
        </form>

        <div className="text-center text-xs text-gray-500 dark:text-gray-500 mt-5 pt-5 border-t border-gray-100 dark:border-gray-800">
          <p>
            Cada restaurante tem seu próprio endereço (ex: <strong>seurestaurante.planejamento.app</strong>).
          </p>
          <p className="mt-1.5">
            Não sabe o seu? Peça pro administrador do restaurante.
          </p>
        </div>
      </div>

      <a
        href={`https://${ADMIN_HOST}`}
        className="text-xs text-gray-400 dark:text-gray-600 hover:text-gray-700 dark:hover:text-gray-300 mt-4 transition-colors"
      >
        Acesso administrativo →
      </a>
    </div>
  );
}

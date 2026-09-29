// Aba "Conexão do site" — conecta o domínio próprio do restaurante PELA TELA
// (config-driven): grava os domínios em sitesConfig.dominios e o boot do app
// (resolveSlugFromHost) passa a reconhecer o host e servir este site. Sem mexer
// em código (customDomain.ts / vercel.json) a cada novo domínio.
//
// Passos que continuam manuais (fora do app): adicionar o domínio no painel do
// Vercel e apontar o DNS no registrador. As instruções ficam aqui na tela.
import { useMemo, useState } from "react";
import { Globe, Check, Copy, ExternalLink, Trash2, Plus, Lock } from "lucide-react";
import { useAuth } from "../../core/auth/AuthContext";
import { useSiteConfig } from "./useSiteConfig";

// Extrai o host limpo de um input (aceita "https://x.com/y", "X.COM ", etc).
function normalizeHost(input: string): string | null {
  let s = (input || "").trim().toLowerCase();
  if (!s) return null;
  s = s.replace(/^https?:\/\//, "").replace(/^www\./, "www.");
  s = s.split("/")[0].split("?")[0].split("#")[0].trim();
  s = s.replace(/\/+$/, "");
  // validação simples de domínio
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(s)) return null;
  return s;
}
function apexDe(host: string): string { return host.replace(/^www\./, ""); }

export function ConexaoTab({ rid, nomeRestaurante, podeEditar }: { rid: string; nomeRestaurante: string; podeEditar: boolean }) {
  const { pessoa: me } = useAuth();
  const { config, loading, save } = useSiteConfig(rid, nomeRestaurante);
  const [novo, setNovo] = useState("");
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [copiado, setCopiado] = useState("");

  const dominios = useMemo(() => config?.dominios || [], [config]);
  const slug = config?.slug || "";
  const publicado = !!config?.publicado;
  // Agrupa por apex pra mostrar "dominio.com.br (+ www)" numa linha só.
  const grupos = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const h of dominios) { const a = apexDe(h); map.set(a, [...(map.get(a) || []), h]); }
    return [...map.entries()].sort((x, y) => x[0].localeCompare(y[0]));
  }, [dominios]);

  async function conectar() {
    setErro("");
    const host = normalizeHost(novo);
    if (!host) { setErro("Digite um domínio válido (ex.: sororocaparaty.com.br)."); return; }
    const apex = apexDe(host);
    const add = [apex, `www.${apex}`];
    const jaTem = new Set(dominios);
    const merged = [...dominios];
    for (const h of add) if (!jaTem.has(h)) merged.push(h);
    setSalvando(true);
    try { await save({ dominios: merged }, me?.id || ""); setNovo(""); }
    catch (e) { setErro("Falha ao salvar: " + (e instanceof Error ? e.message : "erro")); }
    finally { setSalvando(false); }
  }
  async function remover(apex: string, hosts: string[]) {
    if (!confirm(`Desconectar ${apex}? O site deixa de responder nesse domínio (o DNS/Vercel você remove por fora, se quiser).`)) return;
    const rm = new Set(hosts);
    await save({ dominios: dominios.filter((h) => !rm.has(h)) }, me?.id || "");
  }
  function copiar(txt: string, tag: string) { navigator.clipboard?.writeText(txt).then(() => { setCopiado(tag); setTimeout(() => setCopiado(""), 1500); }); }

  if (loading) return <div className="text-gray-400 text-sm py-8">Carregando…</div>;

  const inp = "w-full h-10 px-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-sm";
  const card = "bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-5 shadow-sm";

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-4 items-start">
      {/* Coluna principal */}
      <div className={card}>
        <div className="flex items-center gap-2 mb-1"><Globe size={18} className="text-indigo-500" /><h3 className="font-extrabold text-[15px]">Conexão do site</h3></div>
        <p className="text-[13px] text-gray-500 mb-4">Ligue o domínio próprio por aqui. O sistema passa a reconhecer o endereço e servir este site — sem precisar de deploy a cada domínio.</p>

        {/* Endereço interno (slug) */}
        <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wide">Endereço no sistema</label>
        <div className="flex items-center gap-2 mt-1 mb-4 flex-wrap">
          <span className="text-[13px] text-gray-500">planejamento.app/site/<b className="text-gray-800 dark:text-gray-100">{slug || "—"}</b></span>
          {slug && publicado && <a href={`/site/${slug}`} target="_blank" rel="noreferrer" className="text-indigo-600 dark:text-indigo-400 text-[12px] inline-flex items-center gap-1">abrir <ExternalLink size={11} /></a>}
          {!publicado && <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">não publicado</span>}
        </div>
        <p className="text-[11px] text-gray-400 -mt-2 mb-4">O slug é editado na aba <b>Geral</b>. Publique o site lá pra ele responder nos domínios.</p>

        {/* Domínios conectados */}
        <label className="text-[11px] font-bold text-gray-500 uppercase tracking-wide">Domínios próprios</label>
        <div className="mt-2 space-y-2">
          {grupos.length === 0 && <div className="text-[13px] text-gray-400">Nenhum domínio conectado ainda.</div>}
          {grupos.map(([apex, hosts]) => (
            <div key={apex} className="flex items-center gap-2 rounded-xl border border-gray-200 dark:border-gray-700 px-3 py-2">
              <Globe size={14} className="text-emerald-500 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-[13.5px] font-semibold truncate">{apex}</div>
                <div className="text-[11px] text-gray-400">{hosts.includes(`www.${apex}`) ? "com www" : "sem www"} · {hosts.length} host(s)</div>
              </div>
              <a href={`https://${apex}`} target="_blank" rel="noreferrer" className="text-gray-400 hover:text-indigo-600" title="Testar no navegador"><ExternalLink size={15} /></a>
              {podeEditar && <button onClick={() => void remover(apex, hosts)} className="text-gray-400 hover:text-rose-500" title="Desconectar"><Trash2 size={15} /></button>}
            </div>
          ))}
        </div>

        {podeEditar ? (
          <div className="mt-3">
            <div className="flex items-center gap-2">
              <input value={novo} onChange={(e) => setNovo(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void conectar(); }} placeholder="sororocaparaty.com.br" className={inp} />
              <button onClick={() => void conectar()} disabled={salvando || !novo.trim()} className="h-10 px-4 rounded-lg bg-indigo-600 text-white text-sm font-bold disabled:opacity-50 inline-flex items-center gap-1 shrink-0"><Plus size={15} /> Conectar</button>
            </div>
            <div className="text-[11px] text-gray-400 mt-1">Adicionamos o <b>www</b> automaticamente. Depois aponte o DNS (ao lado) e adicione o domínio no Vercel.</div>
            {erro && <div className="text-[12px] text-rose-600 mt-1">{erro}</div>}
          </div>
        ) : (
          <div className="mt-3 text-[12px] text-gray-400 inline-flex items-center gap-1"><Lock size={13} /> Sem permissão pra conectar domínios.</div>
        )}
      </div>

      {/* Coluna lateral: DNS + passos */}
      <div className="space-y-4">
        <div className={card}>
          <div className="text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-2">Configure no registro.br</div>
          <table className="w-full text-[13px] border-collapse">
            <thead><tr className="text-[10px] uppercase tracking-wide text-gray-400"><th className="text-left py-1">Host</th><th className="text-left py-1">Tipo</th><th className="text-left py-1">Valor</th></tr></thead>
            <tbody>
              <tr className="border-t border-gray-100 dark:border-gray-800"><td className="py-2"><code className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800">@</code></td><td>A</td><td className="flex items-center gap-1"><code className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800">76.76.21.21</code><button onClick={() => copiar("76.76.21.21", "a")} className="text-gray-400 hover:text-indigo-600">{copiado === "a" ? <Check size={13} className="text-emerald-500" /> : <Copy size={13} />}</button></td></tr>
              <tr className="border-t border-gray-100 dark:border-gray-800"><td className="py-2"><code className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800">www</code></td><td>CNAME</td><td className="flex items-center gap-1"><code className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800">cname.vercel-dns.com</code><button onClick={() => copiar("cname.vercel-dns.com", "c")} className="text-gray-400 hover:text-indigo-600">{copiado === "c" ? <Check size={13} className="text-emerald-500" /> : <Copy size={13} />}</button></td></tr>
            </tbody>
          </table>
          <p className="text-[11px] text-gray-400 mt-2">O registro.br não aceita CNAME na raiz — por isso <b>A</b> na raiz e <b>CNAME</b> no www. Propaga em minutos a algumas horas.</p>
        </div>

        <div className={card}>
          <div className="text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-2">Passos</div>
          <ol className="text-[12.5px] text-gray-600 dark:text-gray-300 space-y-2 list-decimal pl-4">
            <li>Conecte o domínio aqui (ao lado).</li>
            <li>No painel do <b>Vercel</b> → Settings → Domains → adicione o domínio e o www.</li>
            <li>No <b>registro.br</b>, aponte o DNS (tabela acima).</li>
            <li>Publique o site na aba <b>Geral</b> (se ainda não).</li>
          </ol>
          <p className="text-[11px] text-emerald-700 dark:text-emerald-300 mt-3 bg-emerald-50 dark:bg-emerald-950/20 rounded-lg p-2">Novo: o reconhecimento do domínio é config — não precisa mais editar código a cada site.</p>
        </div>
      </div>
    </div>
  );
}

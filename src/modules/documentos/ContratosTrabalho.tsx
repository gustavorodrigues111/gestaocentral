// ════════════════════════════════════════════════════════════════════════════
//  Novos contratos de trabalho — fluxo: TRIAGEM (qual modelo) → DADOS (empresa/
//  cargo dos catálogos + empregado) → GERAR (DOCX pelo /api/contrato-preencher,
//  que roda a lógica da skill contratos-trabalho). PDF fica pra depois.
// ════════════════════════════════════════════════════════════════════════════
import { useEffect, useMemo, useState } from "react";
import { authHeader } from "../../core/firebase/idToken";
import { Button } from "../../core/ui/Button";
import { Input } from "../../core/ui/Input";
import type { Empregado } from "../../core/types";

type EmpresaCat = Record<string, { nome?: string; cnpj?: string; endereco?: string; cidade?: string; cct?: string }>;
type CargoCat = Record<string, { funcao?: string; cbo?: string; salario?: number; regime?: string; horario?: string; descricao?: string; gorjeta_texto?: string }>;
type Modelo = { id: string; descricao: string };

// Triagem → chave do modelo (espelha references/escolha-modelo da skill).
function decidirModelo(t: { casa: string; ponto: string; vinculo: string }): { modelo: string; motivo: string } {
  if (t.vinculo === "autonomo") return { modelo: "contrato-autonomo", motivo: "Prestador sem subordinação (RPA)." };
  if (t.vinculo === "transitorio") return { modelo: "contrato-prazo-determinado", motivo: "Necessidade transitória (art. 443 §2º 'a')." };
  if (t.casa === "totalmente" && t.ponto === "nao") return { modelo: "contrato-atividade-externa", motivo: "Trabalho externo sem controle de jornada (art. 62, I)." };
  if (t.casa === "alguns" || t.casa === "totalmente") return { modelo: "contrato-hibrido", motivo: "Trabalha de casa em algum dia → híbrido (arts. 75-A a 75-F)." };
  return { modelo: "contrato-padrao", motivo: "CLT presencial com jornada/escala." };
}

const TRAP: Record<string, string> = {
  "contrato-autonomo": "⚠️ Autônomo para garçom, cozinheiro ou função de escala é fraude de vínculo. Só use para quem não tem horário, uniforme e chefe.",
  "contrato-atividade-externa": "⚠️ Art. 62 só vale para quem realmente não tem como ter horário controlado. Quem bate ponto é teletrabalho por jornada, não art. 62.",
  "contrato-hibrido": "⚠️ Híbrido tem que estar escrito, com ajuda de custo/equipamento previstos. Registrar como presencial e deixar em casa gera passivo.",
};

export function ContratosTrabalho({ empregados }: { empregados: Empregado[] }) {
  const [cat, setCat] = useState<{ modelos: Modelo[]; empresas: EmpresaCat; cargos: CargoCat } | null>(null);
  const [erroCat, setErroCat] = useState("");
  const [passo, setPasso] = useState<"triagem" | "dados">("triagem");

  // Triagem
  const [tr, setTr] = useState({ casa: "", ponto: "", vinculo: "" });
  const decisao = tr.casa && tr.vinculo ? decidirModelo(tr) : null;
  const [modelo, setModelo] = useState("");   // pode sobrescrever a sugestão

  // Dados
  const [empresaKey, setEmpresaKey] = useState("");
  const [cargoKey, setCargoKey] = useState("");
  const [salario, setSalario] = useState("");        // override opcional
  const [emp, setEmp] = useState({ nome: "", cpf: "", rg: "", endereco: "", email: "", whatsapp: "" });
  const [buscaEmp, setBuscaEmp] = useState("");
  const [dataInicio, setDataInicio] = useState("");
  const [cidade, setCidade] = useState("São Paulo");
  const [dataAssin, setDataAssin] = useState("");
  const [gerando, setGerando] = useState(false);
  const [erro, setErro] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/contrato-preencher", { method: "POST", headers: { "Content-Type": "application/json", ...(await authHeader()) }, body: JSON.stringify({ action: "listar" }) });
        const j = await r.json();
        if (!r.ok) { setErroCat(j.error || "Falha ao carregar catálogos."); return; }
        setCat({ modelos: j.modelos || [], empresas: j.empresas || {}, cargos: j.cargos || {} });
      } catch (e) { setErroCat(e instanceof Error ? e.message : "Erro de rede."); }
    })();
  }, []);

  const empresasList = useMemo(() => Object.entries(cat?.empresas || {}).filter(([k]) => !k.startsWith("_")), [cat]);
  const cargosList = useMemo(() => Object.entries(cat?.cargos || {}).filter(([k]) => !k.startsWith("_")), [cat]);
  const cargoSel = cargoKey ? cat?.cargos?.[cargoKey] : null;

  const empSug = useMemo(() => {
    const s = buscaEmp.trim().toLowerCase();
    if (!s) return [];
    return empregados.filter(e => (e.nome || "").toLowerCase().includes(s)).slice(0, 6);
  }, [buscaEmp, empregados]);

  function irParaDados() {
    if (!decisao) return;
    setModelo(modelo || decisao.modelo);
    setPasso("dados");
  }

  async function gerar() {
    setErro("");
    if (!modelo) { setErro("Escolha o modelo (triagem)."); return; }
    const ehAutonomo = modelo === "contrato-autonomo";
    if (!emp.nome.trim() || !emp.cpf.trim()) { setErro("Nome e CPF são obrigatórios."); return; }
    if (!empresaKey && !ehAutonomo) { setErro("Escolha a empresa."); return; }
    setGerando(true);
    try {
      const dados: Record<string, unknown> = {
        empresaKey: empresaKey || undefined,
        cargoKey: cargoKey || undefined,
        empregado: { nome: emp.nome.trim(), cpf: emp.cpf.trim(), ...(emp.rg ? { rg: emp.rg.trim() } : {}), endereco: emp.endereco.trim(), ...(emp.email ? { email: emp.email.trim() } : {}), ...(emp.whatsapp ? { whatsapp: emp.whatsapp.trim() } : {}) },
        contrato: { ...(dataInicio ? { data_inicio: dataInicio } : {}), cidade: cidade.trim(), ...(dataAssin ? { data_assinatura: dataAssin } : {}) },
        ...(salario.trim() ? { cargo: { salario: Number(salario.replace(/[^\d]/g, "")) } } : {}),
      };
      const r = await fetch("/api/contrato-preencher", { method: "POST", headers: { "Content-Type": "application/json", ...(await authHeader()) }, body: JSON.stringify({ action: "gerar", modelo, dados }) });
      const j = await r.json();
      if (!r.ok) { setErro(j.error || "Falha ao gerar."); setGerando(false); return; }
      const bin = atob(j.docxBase64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const blob = new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = j.filename || "contrato.docx";
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e) { setErro(e instanceof Error ? e.message : "Erro de rede."); }
    finally { setGerando(false); }
  }

  if (erroCat) return <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{erroCat}</div>;
  if (!cat) return <div className="text-sm text-gray-400 py-8 text-center">Carregando modelos…</div>;

  const q = (label: string, val: string, set: (v: string) => void, opts: [string, string][]) => (
    <div className="mb-4">
      <div className="text-sm font-semibold mb-2">{label}</div>
      <div className="flex flex-wrap gap-2">
        {opts.map(([v, lb]) => (
          <button key={v} type="button" onClick={() => set(v)}
            className={`text-[13px] px-3 py-1.5 rounded-lg border ${val === v ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 font-medium" : "border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300"}`}>
            {lb}
          </button>
        ))}
      </div>
    </div>
  );

  const modeloDesc = (id: string) => cat.modelos.find(m => m.id === id)?.descricao || id;

  return (
    <div className="max-w-3xl">
      {/* Passos */}
      <div className="flex items-center gap-2 text-xs mb-5">
        <span className={`px-2.5 py-1 rounded-full font-medium ${passo === "triagem" ? "bg-indigo-600 text-white" : "bg-gray-100 dark:bg-gray-800 text-gray-500"}`}>1 · Triagem</span>
        <span className="text-gray-300">→</span>
        <span className={`px-2.5 py-1 rounded-full font-medium ${passo === "dados" ? "bg-indigo-600 text-white" : "bg-gray-100 dark:bg-gray-800 text-gray-500"}`}>2 · Dados e geração</span>
      </div>

      {passo === "triagem" && (
        <div>
          <p className="text-sm text-gray-500 mb-4">Poucas perguntas escolhem o modelo certo entre os {cat.modelos.filter(m => m.id.startsWith("contrato")).length} de contrato.</p>
          {q("A pessoa vai trabalhar de casa em algum dia?", tr.casa, v => setTr(s => ({ ...s, casa: v })), [["nao", "Não, presencial"], ["alguns", "Sim, alguns dias"], ["totalmente", "Totalmente em casa/rua"]])}
          {q("Tem controle de jornada (bate ponto)?", tr.ponto, v => setTr(s => ({ ...s, ponto: v })), [["sim", "Sim"], ["nao", "Não — por produção"]])}
          {q("Que tipo de vínculo?", tr.vinculo, v => setTr(s => ({ ...s, vinculo: v })), [["clt", "CLT permanente"], ["transitorio", "Necessidade transitória"], ["autonomo", "Prestador (RPA)"]])}

          {decisao && (
            <div className="mt-5 rounded-xl border border-indigo-300 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-900/20 p-4">
              <div className="text-[11px] uppercase tracking-wider text-indigo-600 dark:text-indigo-300 font-semibold">Modelo recomendado</div>
              <div className="font-semibold text-lg text-indigo-900 dark:text-indigo-200 mt-0.5">{modeloDesc(decisao.modelo)}</div>
              <div className="text-[12px] text-gray-600 dark:text-gray-300 mt-1">{decisao.motivo} <span className="font-mono text-gray-400">· {decisao.modelo}</span></div>
              {TRAP[decisao.modelo] && <div className="text-[12.5px] text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-900/40 rounded-lg px-3 py-2 mt-3">{TRAP[decisao.modelo]}</div>}
              <div className="mt-3 flex items-center gap-2 flex-wrap">
                <label className="text-[12px] text-gray-500">Trocar modelo:</label>
                <select value={modelo || decisao.modelo} onChange={e => setModelo(e.target.value)} className="text-xs rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-2 py-1.5">
                  {cat.modelos.map(m => <option key={m.id} value={m.id}>{m.descricao}</option>)}
                </select>
                <Button onClick={irParaDados} className="ml-auto">Continuar →</Button>
              </div>
            </div>
          )}
        </div>
      )}

      {passo === "dados" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="text-sm"><span className="text-gray-400">Modelo:</span> <strong>{modeloDesc(modelo)}</strong></div>
            <button type="button" onClick={() => setPasso("triagem")} className="text-xs text-indigo-600 hover:underline">← Trocar modelo</button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">Empresa</label>
              <select value={empresaKey} onChange={e => setEmpresaKey(e.target.value)} className="w-full mt-1 px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900">
                <option value="">— escolher —</option>
                {empresasList.map(([k, v]) => <option key={k} value={k}>{v.nome || k}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">Cargo (do catálogo)</label>
              <select value={cargoKey} onChange={e => setCargoKey(e.target.value)} className="w-full mt-1 px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900">
                <option value="">— escolher —</option>
                {cargosList.map(([k, v]) => <option key={k} value={k}>{v.funcao || k}</option>)}
              </select>
            </div>
          </div>
          {cargoSel && (
            <div className="text-[12px] text-gray-500 -mt-1">
              {cargoSel.funcao}{cargoSel.cbo ? ` · CBO ${cargoSel.cbo}` : ""}{cargoSel.salario ? ` · R$ ${cargoSel.salario.toLocaleString("pt-BR")}` : ""}{cargoSel.regime ? ` · ${cargoSel.regime}` : ""}
              <Input placeholder="Sobrescrever salário desta pessoa (opcional)" value={salario} onChange={e => setSalario(e.target.value)} className="mt-2 max-w-xs" />
            </div>
          )}

          {/* Empregado */}
          <div className="border-t border-gray-200 dark:border-gray-800 pt-3">
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-bold uppercase tracking-wider text-gray-600 dark:text-gray-400">Empregado</label>
              <div className="relative">
                <input value={buscaEmp} onChange={e => setBuscaEmp(e.target.value)} placeholder="🔎 puxar de um empregado…"
                  className="text-xs px-2.5 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 w-56" />
                {empSug.length > 0 && (
                  <div className="absolute right-0 z-10 mt-1 w-64 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg shadow-lg max-h-56 overflow-y-auto">
                    {empSug.map(e => (
                      <button key={e.id} type="button" onClick={() => { setEmp(p => ({ ...p, nome: e.nome || "", cpf: (e as { cpf?: string }).cpf || "", endereco: (e as { endereco?: string }).endereco || p.endereco })); setBuscaEmp(""); }}
                        className="w-full text-left px-3 py-1.5 text-sm hover:bg-gray-50 dark:hover:bg-gray-800/50">{e.nome}</button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Input label="Nome completo *" value={emp.nome} onChange={e => setEmp(p => ({ ...p, nome: e.target.value }))} />
              <Input label="CPF *" value={emp.cpf} onChange={e => setEmp(p => ({ ...p, cpf: e.target.value }))} />
              <Input label="RG" value={emp.rg} onChange={e => setEmp(p => ({ ...p, rg: e.target.value }))} />
              <Input label="E-mail (assinatura)" value={emp.email} onChange={e => setEmp(p => ({ ...p, email: e.target.value }))} />
              <Input label="WhatsApp" value={emp.whatsapp} onChange={e => setEmp(p => ({ ...p, whatsapp: e.target.value }))} />
              <Input label="Endereço completo (c/ CEP)" value={emp.endereco} onChange={e => setEmp(p => ({ ...p, endereco: e.target.value }))} className="sm:col-span-2" />
            </div>
          </div>

          {/* Contrato */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Input label="Início" type="date" value={dataInicio} onChange={e => setDataInicio(e.target.value)} />
            <Input label="Cidade" value={cidade} onChange={e => setCidade(e.target.value)} />
            <Input label="Data de assinatura" type="date" value={dataAssin} onChange={e => setDataAssin(e.target.value)} />
          </div>
          <p className="text-[11px] text-gray-400">Experiência 45+45 e pagamento no 5º dia útil são o padrão do script. Plano de saúde não se aplica (cláusula removida automaticamente).</p>

          {erro && <div className="text-sm text-rose-600">{erro}</div>}
          <div className="flex justify-end gap-2 pt-2 border-t border-gray-200 dark:border-gray-800">
            <Button onClick={() => void gerar()} disabled={gerando}>{gerando ? "Gerando…" : "📄 Gerar contrato (DOCX)"}</Button>
          </div>
        </div>
      )}
    </div>
  );
}

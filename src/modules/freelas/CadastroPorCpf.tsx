import { useState } from "react";
import {
  addDoc, arrayUnion, collection, doc, getDocs, limit, query, updateDoc, where,
} from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { Button } from "../../core/ui/Button";
import { Input } from "../../core/ui/Input";
import type { Pessoa } from "../../core/types";
import { onlyDigits } from "./helpers";

type Props = {
  restaurantId: string;
  // Quando termina, devolve a Pessoa pronta pra ser usada (cadastrada ou
  // vinculada). O caller fecha o sub-modal e seleciona ela.
  onConcluido: (pessoa: Pessoa) => void;
  onCancelar: () => void;
};

type EstadoBusca =
  | { tipo: "vazio" }
  | { tipo: "buscando" }
  | { tipo: "existe_aqui"; pessoa: Pessoa }
  | { tipo: "existe_outro"; pessoa: Pessoa }
  | { tipo: "novo" };

// Sub-modal de cadastro rápido começando pelo CPF. Ao completar 11 dígitos,
// busca em /pessoas e ajusta o fluxo:
//   - já está nesse rid → bloqueia novo cadastro, oferece selecionar
//   - existe em outro rid → oferece vincular (puxa nome/whats/pix)
//   - não existe → mostra form completo
export function CadastroPorCpf({ restaurantId, onConcluido, onCancelar }: Props) {
  const [cpf, setCpf] = useState("");
  const [busca, setBusca] = useState<EstadoBusca>({ tipo: "vazio" });
  const [nome, setNome] = useState("");
  const [pix, setPix] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  function fmtCpfMasked(d: string) {
    const x = d.replace(/\D/g, "").slice(0, 11);
    if (x.length <= 3) return x;
    if (x.length <= 6) return `${x.slice(0, 3)}.${x.slice(3)}`;
    if (x.length <= 9) return `${x.slice(0, 3)}.${x.slice(3, 6)}.${x.slice(6)}`;
    return `${x.slice(0, 3)}.${x.slice(3, 6)}.${x.slice(6, 9)}-${x.slice(9)}`;
  }

  async function onChangeCpf(v: string) {
    setCpf(fmtCpfMasked(v));
    setErr("");
    const d = onlyDigits(v);
    if (d.length < 11) {
      setBusca({ tipo: "vazio" });
      return;
    }
    setBusca({ tipo: "buscando" });
    try {
      const snap = await getDocs(
        query(collection(db, "pessoas"), where("cpf", "==", d), limit(1)),
      );
      if (snap.empty) {
        setBusca({ tipo: "novo" });
        // Pré-preenche o foco no nome — campos limpos
        setNome(""); setPix(""); setWhatsapp("");
        return;
      }
      const p = { id: snap.docs[0].id, ...snap.docs[0].data() } as Pessoa;
      if (p.restaurantIds.includes(restaurantId)) {
        setBusca({ tipo: "existe_aqui", pessoa: p });
      } else {
        setBusca({ tipo: "existe_outro", pessoa: p });
        // Pré-preenche o que tem
        setNome(p.nome || "");
        setPix(p.pix || "");
        setWhatsapp(p.whatsapp || "");
      }
    } catch (e) {
      console.error(e);
      setErr("Erro buscando CPF. Tente de novo.");
      setBusca({ tipo: "vazio" });
    }
  }

  async function salvarNovo() {
    setErr("");
    const d = onlyDigits(cpf);
    if (d.length !== 11) { setErr("CPF inválido."); return; }
    const nomeT = nome.trim();
    const pixT = pix.trim();
    const whatsT = onlyDigits(whatsapp);
    if (!nomeT) { setErr("Nome obrigatório."); return; }
    if (!pixT)  { setErr("Chave PIX obrigatória."); return; }
    if (whatsT.length < 10) { setErr("WhatsApp inválido."); return; }
    setSaving(true);
    try {
      const now = new Date().toISOString();
      const ref = await addDoc(collection(db, "pessoas"), {
        email: "",
        nome: nomeT,
        cpf: d,
        whatsapp: whatsT,
        pix: pixT,
        isMaster: false,
        restaurantIds: [restaurantId],
        permissions: { [restaurantId]: {} },
        ativa: true,
        createdAt: now,
      });
      onConcluido({
        id: ref.id,
        email: "", nome: nomeT, cpf: d, whatsapp: whatsT, pix: pixT,
        isMaster: false, restaurantIds: [restaurantId],
        permissions: { [restaurantId]: {} }, ativa: true, createdAt: now,
      });
    } catch (e) {
      console.error(e);
      setErr("Erro ao cadastrar.");
      setSaving(false);
    }
  }

  async function vincularExistente() {
    if (busca.tipo !== "existe_outro") return;
    setErr("");
    const pixT = pix.trim();
    const nomeT = nome.trim();
    const whatsT = onlyDigits(whatsapp);
    if (!pixT)  { setErr("Chave PIX obrigatória pra usar como freela."); return; }
    if (!nomeT) { setErr("Nome obrigatório."); return; }
    if (whatsT.length < 10) { setErr("WhatsApp inválido."); return; }
    setSaving(true);
    try {
      const updates: Record<string, unknown> = {
        restaurantIds: arrayUnion(restaurantId),
        nome: nomeT,
        pix: pixT,
        whatsapp: whatsT,
      };
      // Garante que entra com permissions vazias no rid novo, sem sobrescrever outros
      updates[`permissions.${restaurantId}`] = {};
      await updateDoc(doc(db, "pessoas", busca.pessoa.id), updates);
      const final: Pessoa = {
        ...busca.pessoa,
        nome: nomeT, pix: pixT, whatsapp: whatsT,
        restaurantIds: Array.from(new Set([...busca.pessoa.restaurantIds, restaurantId])),
        permissions: { ...busca.pessoa.permissions, [restaurantId]: {} },
      };
      onConcluido(final);
    } catch (e) {
      console.error(e);
      setErr("Erro ao vincular.");
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-1">
        <label className="text-xs font-semibold text-gray-600 dark:text-gray-400">
          CPF *
        </label>
        <Input
          value={cpf}
          onChange={(e) => onChangeCpf(e.target.value)}
          placeholder="000.000.000-00"
          inputMode="numeric"
          autoFocus
          maxLength={14}
        />
      </div>

      {busca.tipo === "buscando" && (
        <div className="text-xs text-gray-500 dark:text-gray-400">Buscando…</div>
      )}

      {busca.tipo === "existe_aqui" && (
        <div className="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 p-3 space-y-2">
          <div className="text-sm text-gray-800 dark:text-gray-100">
            ⚠️ Já cadastrado neste restaurante: <strong>{busca.pessoa.nome}</strong>
          </div>
          <Button size="sm" onClick={() => onConcluido(busca.pessoa)}>
            Selecionar {busca.pessoa.nome}
          </Button>
        </div>
      )}

      {busca.tipo === "existe_outro" && (
        <div className="rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20 p-3 space-y-3">
          <div className="text-sm text-gray-800 dark:text-gray-100">
            ✅ Encontrei <strong>{busca.pessoa.nome}</strong> cadastrad{busca.pessoa.nome.endsWith("a") ? "a" : "o"} em outro restaurante.
            <div className="text-[11px] text-gray-600 dark:text-gray-400 mt-1">
              Vou vincular este cadastro ao restaurante atual. Confirme/complete os dados:
            </div>
          </div>
          <Input
            label="Nome *"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
          />
          <Input
            label="Chave PIX *"
            value={pix}
            onChange={(e) => setPix(e.target.value)}
            placeholder="CPF, email, telefone ou chave aleatória"
          />
          <Input
            label="WhatsApp *"
            value={whatsapp}
            onChange={(e) => setWhatsapp(e.target.value)}
            inputMode="tel"
            placeholder="(11) 99999-9999"
          />
          {err && <div className="text-xs text-red-600 dark:text-red-400">{err}</div>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onCancelar} disabled={saving}>Cancelar</Button>
            <Button onClick={vincularExistente} disabled={saving}>
              {saving ? "Vinculando…" : "Vincular e usar"}
            </Button>
          </div>
        </div>
      )}

      {busca.tipo === "novo" && (
        <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/40 p-3 space-y-3">
          <div className="text-[11px] text-gray-600 dark:text-gray-400">
            CPF novo — vamos cadastrar.
          </div>
          <Input
            label="Nome completo *"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            placeholder="Nome e sobrenome"
            autoFocus
          />
          <Input
            label="Chave PIX *"
            value={pix}
            onChange={(e) => setPix(e.target.value)}
            placeholder="CPF, email, telefone ou chave aleatória"
          />
          <Input
            label="WhatsApp *"
            value={whatsapp}
            onChange={(e) => setWhatsapp(e.target.value)}
            inputMode="tel"
            placeholder="(11) 99999-9999"
          />
          {err && <div className="text-xs text-red-600 dark:text-red-400">{err}</div>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onCancelar} disabled={saving}>Cancelar</Button>
            <Button onClick={salvarNovo} disabled={saving}>
              {saving ? "Salvando…" : "Cadastrar"}
            </Button>
          </div>
        </div>
      )}

      {busca.tipo === "vazio" && (
        <div className="flex justify-end pt-1">
          <Button variant="secondary" onClick={onCancelar}>Cancelar</Button>
        </div>
      )}
    </div>
  );
}

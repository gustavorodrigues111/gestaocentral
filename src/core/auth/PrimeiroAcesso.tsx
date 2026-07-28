// Tela de PRIMEIRO ACESSO — mostrada quando a pessoa entrou com a senha inicial
// (mustTrocarSenha=true). Obriga: CPF + nova senha (Pix opcional). Ao concluir,
// troca a senha no Firebase Auth, salva os dados e libera o app.
import { useState } from "react";
import { updatePassword, signOut } from "firebase/auth";
import { doc, updateDoc, deleteField } from "firebase/firestore";
import { auth, db } from "../firebase/config";
import { Button } from "../ui/Button";
import type { Pessoa } from "../types";

const soDigitos = (s: string) => s.replace(/\D/g, "");

export function PrimeiroAcesso({ pessoa }: { pessoa: Pessoa }) {
  const [cpf, setCpf] = useState(pessoa.cpf || "");
  const [pix, setPix] = useState(pessoa.pix || "");
  const [senha, setSenha] = useState("");
  const [senha2, setSenha2] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  async function concluir() {
    setErro("");
    const cpfD = soDigitos(cpf);
    if (cpfD.length !== 11) { setErro("CPF inválido — precisa de 11 dígitos."); return; }
    if (senha.length < 6) { setErro("A nova senha precisa de pelo menos 6 caracteres."); return; }
    if (senha !== senha2) { setErro("As senhas não conferem."); return; }
    if (!auth.currentUser) { setErro("Sessão expirada. Entre de novo."); return; }
    setSalvando(true);
    try {
      await updatePassword(auth.currentUser, senha);
      // IMPORTANTE: deleteField() é um sentinel do Firestore — NÃO pode passar
      // por sanitizeForFirestore (que reconstrói objetos e o transformaria num
      // {} truthy, deixando mustTrocarSenha "ligado" pra sempre → loop no 1º
      // acesso). Monta o patch direto.
      const patch: Record<string, unknown> = {
        cpf: cpfD,
        mustTrocarSenha: deleteField(),
        primeiroAcessoEm: new Date().toISOString(),
      };
      const pixTrim = pix.trim();
      if (pixTrim) patch.pix = pixTrim;
      await updateDoc(doc(db, "pessoas", pessoa.id), patch);
      // Recarrega pra o AuthContext reler a pessoa (flag limpo → entra no app).
      window.location.reload();
    } catch (e) {
      const code = (e as { code?: string })?.code || "";
      if (code === "auth/requires-recent-login") setErro("Por segurança, entre de novo e repita — sua sessão é antiga.");
      else setErro("Não foi possível concluir: " + (e instanceof Error ? e.message : "?"));
      setSalvando(false);
    }
  }

  const inp = "w-full h-11 px-3 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 text-[15px]";

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-gray-50 dark:bg-gray-950">
      <div className="w-full max-w-sm bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl shadow-sm p-6">
        <div className="text-3xl mb-2">👋</div>
        <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">Bem-vindo(a), {pessoa.nome.split(" ")[0]}!</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 mb-5">Pra concluir seu acesso, confirme seu CPF e crie uma nova senha.</p>

        <div className="space-y-3">
          <div>
            <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-1">CPF *</label>
            <input className={inp} inputMode="numeric" value={cpf} onChange={(e) => setCpf(e.target.value)} placeholder="000.000.000-00" />
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-1">Chave Pix <span className="text-gray-400 font-normal">(opcional)</span></label>
            <input className={inp} value={pix} onChange={(e) => setPix(e.target.value)} placeholder="CPF, email, telefone ou chave aleatória" />
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-1">Nova senha *</label>
            <input className={inp} type="password" value={senha} onChange={(e) => setSenha(e.target.value)} placeholder="mínimo 6 caracteres" />
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-600 dark:text-gray-400 block mb-1">Confirmar nova senha *</label>
            <input className={inp} type="password" value={senha2} onChange={(e) => setSenha2(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void concluir()} />
          </div>
        </div>

        {erro && <div className="text-sm text-rose-600 dark:text-rose-400 mt-3">{erro}</div>}

        <Button className="w-full mt-5" onClick={() => void concluir()} disabled={salvando}>
          {salvando ? "Concluindo…" : "Concluir e entrar"}
        </Button>
        <button onClick={() => void signOut(auth)} className="w-full text-center text-xs text-gray-400 hover:text-gray-600 mt-3">Sair</button>
      </div>
    </div>
  );
}

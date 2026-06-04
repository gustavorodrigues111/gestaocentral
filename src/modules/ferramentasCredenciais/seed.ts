// ════════════════════════════════════════════════════════════════════════════
//  Seed Lobozó — 8 ferramentas iniciais do briefing.
//
//  IDs determinísticos por slug → idempotente (rodar 2x não duplica).
//  Pode ser chamado pelo botão "Carregar seed Lobozó" na página admin.
// ════════════════════════════════════════════════════════════════════════════

import { doc, setDoc, getDoc } from "firebase/firestore";
import { db } from "../../core/firebase/config";
import { sanitizeForFirestore } from "../../core/firebase/sanitize";
import type { Tool } from "../../core/types";

type SeedItem = Omit<Tool, "id" | "restaurantId" | "criadoEm" | "criadoPor" | "usuariosAutorizados" | "status"> & {
  slug: string;
};

const SEED_LOBOZO: SeedItem[] = [
  {
    slug: "ifood",
    nome: "iFood",
    icone: "device-mobile",
    necessidade: "Receber e gerenciar pedidos de delivery",
    tags: ["ifood","pedido","delivery","entrega"],
    categoria: "delivery",
    metodoAcesso: "login_proprio",
    instrucoesAcesso: "Solicitar acesso de operador no Portal do Parceiro ao responsável.",
  },
  {
    slug: "lalamove",
    nome: "Lalamove",
    icone: "motorbike",
    necessidade: "Chamar motoboy para entrega avulsa",
    tags: ["motoboy","entregador","chamar","entrega"],
    categoria: "delivery",
    metodoAcesso: "senha_compartilhada",
    bitwardenCollection: "Operação – Lobozó",
  },
  {
    slug: "bees-ambev",
    nome: "BEES / Ambev",
    icone: "bottle",
    necessidade: "Fazer pedido de bebidas Ambev",
    tags: ["bebida","cerveja","ambev","fornecedor","pedido"],
    categoria: "fornecedores",
    metodoAcesso: "senha_compartilhada",
    bitwardenCollection: "Operação – Lobozó",
  },
  {
    slug: "heishop-heineken",
    nome: "Heishop / Heineken",
    icone: "bottle",
    necessidade: "Fazer pedido de bebidas Heineken",
    tags: ["bebida","heineken","fornecedor","pedido"],
    categoria: "fornecedores",
    metodoAcesso: "senha_compartilhada",
  },
  {
    slug: "get-in",
    nome: "GET IN",
    icone: "calendar-event",
    necessidade: "Gerenciar reservas de mesa",
    tags: ["reserva","mesa","salao","cliente"],
    categoria: "operacao",
    metodoAcesso: "login_proprio",
    instrucoesAcesso: "GET IN é multiusuário — pedir cadastro do seu login ao responsável.",
  },
  {
    slug: "email-checklists",
    nome: "Email Checklists",
    icone: "checklist",
    necessidade: "Caixa de e-mail dos checklists da operação",
    tags: ["checklist","operacao","conferencia","email"],
    categoria: "operacao",
    metodoAcesso: "senha_oculta",
  },
  {
    slug: "caixa-madeira",
    nome: "Caixa de Madeira",
    icone: "box",
    necessidade: "Guardar valores e itens da casa",
    tags: ["valores","dinheiro","cadeado","guardar"],
    categoria: "operacao",
    metodoAcesso: "fisico",
    localFisico: "Cadeado · gaveta do caixa · combinação no Bitwarden",
  },
  {
    slug: "sp-regula",
    nome: "SP Regula",
    icone: "building-bank",
    necessidade: "Licenças e alvarás da prefeitura",
    tags: ["licenca","prefeitura","alvara","fiscal"],
    categoria: "restrito",
    metodoAcesso: "restrito",
    responsavel: "Gustavo",
  },
];

export async function seedLobozo(
  rid: string,
  pessoaId: string,
): Promise<{ criadas: number; jaExistiam: number }> {
  let criadas = 0;
  let jaExistiam = 0;
  const now = new Date().toISOString();
  for (const item of SEED_LOBOZO) {
    const id = `tool_seed_${rid}_${item.slug}`;
    const ref = doc(db, "tools", id);
    const snap = await getDoc(ref);
    if (snap.exists()) {
      jaExistiam++;
      continue;
    }
    const tool: Tool = {
      id,
      restaurantId: rid,
      nome: item.nome,
      icone: item.icone,
      necessidade: item.necessidade,
      tags: item.tags,
      categoria: item.categoria,
      metodoAcesso: item.metodoAcesso,
      usuariosAutorizados: [],
      status: "ativo",
      criadoEm: now,
      criadoPor: pessoaId,
      ...(item.bitwardenItemUrl ? { bitwardenItemUrl: item.bitwardenItemUrl } : {}),
      ...(item.bitwardenCollection ? { bitwardenCollection: item.bitwardenCollection } : {}),
      ...(item.localFisico ? { localFisico: item.localFisico } : {}),
      ...(item.instrucoesAcesso ? { instrucoesAcesso: item.instrucoesAcesso } : {}),
      ...(item.responsavel ? { responsavel: item.responsavel } : {}),
    };
    await setDoc(ref, sanitizeForFirestore(tool));
    criadas++;
  }
  return { criadas, jaExistiam };
}

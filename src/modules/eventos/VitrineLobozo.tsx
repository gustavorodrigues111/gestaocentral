// Vitrine de eventos do Lobozó — reconstrução em React/Tailwind do HTML de
// pacotes (menus + espaços/valores). Só apresentação (o site SÓ COLETA; o
// preço vive no orçamento do app). Renderizada acima do formulário na
// EventosPublicaPage quando o restaurante é o Lobózó (slug "lobozo").
import { useEffect } from "react";

const RED = "#782827";
const INK = "#0A0A0A";
const INK_SOFT = "#4A4A4A";
const serif = "'Fraunces', Georgia, serif";
const sans = "'Inter', system-ui, sans-serif";

export const MENUS: { nome: string; tagline: string; blocos: { label: string; itens: string[]; nota?: string }[] }[] = [
  {
    nome: "Menu Aberto",
    tagline: "Seleção do balcão de frios e dos petiscos à vontade, servidos para compartilhar. Sem prato principal.",
    blocos: [
      { label: "Do Balcão de Frios", itens: ["Língua de boi defumada, mostarda Dijon e picles de pepino", "Babaganoush caipira de jiló com amendoim e queijo de cabra", "Queijo brasileiro do dia"] },
      { label: "Petiscos", itens: ["Pastéis de angu — carne com umbigo de bananeira ou queijo colonial", "Croquetas do Lobozó — frango caipira com curry ou costela com mandioca", "Jiló recheado de canjiquinha, empanado, com molho de paçoca", "Frango frito, molho de tamarindo e maionese de pequi", "Polenta frita com páprica e maionese de pimenta de cheiro", "Porchetta caipira aperitivo", "Pururuca de porco", "Pão de fermentação natural"] },
      { label: "Sanduíches", itens: ["Frango frito no brioche, tomate, alface e maionese de pimenta de cheiro", "Porchetta na ciabatta, salada de repolho, mostarda e tomate"], nota: "A seleção final é definida com o cliente na confirmação da reserva, considerando o cardápio da temporada e o perfil do evento." },
    ],
  },
  {
    nome: "Menu Sequência",
    tagline: "Servido em tempos: duas entradas, um principal e uma sobremesa por pessoa. Menu curado pela casa, com opções pra escolher.",
    blocos: [
      { label: "Entradas · 2 por pessoa, à escolha", itens: ["Língua de boi defumada, mostarda Dijon e picles", "Babaganoush caipira de jiló", "Queijo brasileiro do dia", "Pastéis de angu, com recheios da casa", "Croquetas do Lobozó", "Jiló recheado de canjiquinha", "Frango frito com tamarindo e maionese de pequi", "Polenta frita com páprica", "Porchetta caipira aperitivo"] },
      { label: "Principal · 1 por pessoa, à escolha", itens: ["Peixe frito, purê de banana e quiabo", "Frango orgânico assado, salada de batata e farofa de milho", "Porchetta caipira assada, tutu de feijão e salada de repolho", "Copa lombo à cavalo, quibebe de abóbora e verduras", "Lobozó de vegetais, ovo e queijo (vegetariano)"] },
      { label: "Sobremesa · 1 por pessoa, à escolha", itens: ["Sorvete de doce de leite e paçoca", "Tarta de queso Canastra, mel de abelhas nativas e limão", "Queijo brasileiro do dia e compota à escolha", "Sorvetes do Lobozó, duas bolas à escolha"], nota: "A composição final é ajustada com o cliente na confirmação da reserva." },
    ],
  },
];

const ESPACOS: { nome: string; meta: string; taxa: string; descontos: string[]; nota?: string }[] = [
  { nome: "Laje", meta: "Até 40 pessoas · Qualquer dia da semana", taxa: "R$ 1.500", descontos: ["Consumo a partir de R$ 5.000: 50% de desconto na locação", "Consumo a partir de R$ 7.500: locação gratuita"] },
  { nome: "Salão · Jantar Dom a Qui", meta: "Até 40 pessoas", taxa: "R$ 1.500", descontos: ["Consumo a partir de R$ 5.000: 50% de desconto na locação", "Consumo a partir de R$ 7.500: locação gratuita"] },
  { nome: "Salão · Jantar Sex/Sáb ou Almoço", meta: "Até 40 pessoas · Restaurante fechado para o evento", taxa: "R$ 3.500", descontos: ["Consumo a partir de R$ 10.000: 50% de desconto na locação", "Consumo a partir de R$ 15.000: locação gratuita"], nota: "Nesta configuração o restaurante fecha para atender o evento com exclusividade." },
];

const PACOTES = [
  { janela: "Domingo a Quinta", linhas: [["Menu Sequência", "R$ 240", "R$ 370"], ["Menu Aberto", "R$ 270", "R$ 400"]] },
  { janela: "Sexta e Sábado", linhas: [["Menu Sequência", "R$ 260", "R$ 390"], ["Menu Aberto", "R$ 290", "R$ 420"]] },
];

// Bebidas inclusas nos pacotes (pro PDF do orçamento).
export const BEBIDAS_LOBOZO = {
  soft: {
    title: "Sem álcool",
    items: [
      "Água Mamba sem gás e com gás",
      "Sucos da Mata Atlântica (uvaia, cambuci, pitanga, goiaba ou amora)",
      "Mate gelado da casa (natural, com pitanga ou com cambuci)",
      "Baer-Mate",
      "Água tônica FYS e FYS Zero",
    ],
  },
  alcohol: {
    title: "Com álcool",
    tagline: "Inclui tudo do pacote sem álcool, mais:",
    items: [
      "Cervejas Praya Lager sem glúten, Praya Clássica e Heineken",
      "Caipirinhas do Lobozó (caju com limão, um-dois-três limões, fruta do dia)",
      "Drinks: Rabo de Galo, Jabuticaba Amiga, Jurubeba Sour, Batidinha de Frutas e Tônico de Uvaia",
    ],
  },
  note: "Vinhos e outras bebidas podem ser incluídos no pacote, mediante ajuste no valor final. Condições negociadas diretamente com o cliente.",
};
// Menu por chave (sequencia/aberto) — pro cardápio do PDF.
export function menuLobozoPorChave(k: "sequencia" | "aberto") {
  return MENUS.find((m) => (k === "sequencia" ? /sequ/i : /aberto/i).test(m.nome)) || null;
}

// ── Preços do Lobozó pra puxar no editor de orçamento (mesma fonte da vitrine) ──
export const PACOTES_LOBOZO_PP: Record<"dom-qui" | "sex-sab", Record<"sequencia" | "aberto", { soft: number; alcohol: number }>> = {
  "dom-qui": { sequencia: { soft: 240, alcohol: 370 }, aberto: { soft: 270, alcohol: 400 } },
  "sex-sab": { sequencia: { soft: 260, alcohol: 390 }, aberto: { soft: 290, alcohol: 420 } },
};
export const LOCACAO_LOBOZO: { nome: string; valor: number }[] = [
  { nome: "Locação Laje", valor: 1500 },
  { nome: "Locação Salão (Dom–Qui)", valor: 1500 },
  { nome: "Locação Salão (Sex/Sáb ou almoço)", valor: 3500 },
];
// Janela de preço a partir da data: Sex/Sáb = alta; resto = Dom–Qui.
export function janelaLobozo(dataYmd: string): "dom-qui" | "sex-sab" {
  if (!dataYmd) return "dom-qui";
  const dow = new Date(dataYmd + "T12:00:00").getDay(); // 0 dom … 6 sáb
  return dow === 5 || dow === 6 ? "sex-sab" : "dom-qui";
}

export function VitrineLobozo() {
  // Injeta Fraunces/Inter uma vez.
  useEffect(() => {
    const id = "fonts-lobozo-vitrine";
    if (document.getElementById(id)) return;
    const l = document.createElement("link");
    l.id = id; l.rel = "stylesheet";
    l.href = "https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,500;0,9..144,600;1,9..144,400;1,9..144,500&family=Inter:wght@400;500;600;700&display=swap";
    document.head.appendChild(l);
  }, []);

  const secHeader = (num: string, label: string) => (
    <div className="flex items-baseline gap-4 mb-8 pb-3" style={{ borderBottom: "1px solid rgba(10,10,10,.28)" }}>
      <span style={{ fontFamily: serif, fontStyle: "italic", fontWeight: 500, fontSize: 30, color: RED, lineHeight: 1 }}>{num}</span>
      <span style={{ fontFamily: sans, fontWeight: 700, fontSize: 12, letterSpacing: "0.28em", textTransform: "uppercase", color: INK }}>{label}</span>
    </div>
  );

  return (
    <div style={{ fontFamily: sans, color: INK }} className="max-w-3xl mx-auto px-1">
      {/* Título */}
      <div className="text-center mb-10">
        <div style={{ fontFamily: sans, fontWeight: 700, fontSize: 11, letterSpacing: "0.3em", textTransform: "uppercase", color: RED }} className="mb-3">Pacotes de Eventos</div>
        <h1 style={{ fontFamily: serif, fontWeight: 600, fontSize: 46, lineHeight: 1.02, letterSpacing: "-0.025em" }}>
          Eventos no <em style={{ color: RED, fontWeight: 500 }}>Lobozó</em>
        </h1>
        <p style={{ fontFamily: serif, fontStyle: "italic", fontSize: 17, color: INK_SOFT }} className="max-w-xl mx-auto mt-4">
          Cozinha caipira da Paulistânia, na Vila Madalena. Dois espaços para eventos privados — o salão e a laje. Formatos personalizáveis, do consumo em comanda ao pacote com comida e bebida.
        </p>
      </div>

      {/* I. Os Menus */}
      {secHeader("I", "Os Menus")}
      <div className="space-y-5 mb-14">
        {MENUS.map((m) => (
          <div key={m.nome} className="relative bg-white p-6 sm:p-8" style={{ border: "1px solid rgba(10,10,10,.1)", boxShadow: "0 2px 6px rgba(0,0,0,.04)" }}>
            <div style={{ position: "absolute", top: 0, left: 0, width: 3, height: "100%", background: RED }} />
            <div style={{ fontFamily: serif, fontWeight: 600, fontSize: 28, letterSpacing: "-0.015em" }}>{m.nome}</div>
            <div style={{ fontFamily: serif, fontStyle: "italic", fontSize: 16, color: INK_SOFT }} className="mt-1 pb-4 mb-4" >{m.tagline}</div>
            {m.blocos.map((b) => (
              <div key={b.label} className="mt-4 first:mt-0">
                <div style={{ fontFamily: sans, fontWeight: 600, fontSize: 10, letterSpacing: "0.28em", textTransform: "uppercase", color: RED }} className="mb-2">{b.label}</div>
                <ul className="space-y-1">
                  {b.itens.map((it, i) => <li key={i} style={{ fontSize: 14.5, lineHeight: 1.5 }}>{it}</li>)}
                </ul>
                {b.nota && <div style={{ fontFamily: serif, fontStyle: "italic", fontSize: 13.5, color: INK_SOFT, borderLeft: `2px solid rgba(10,10,10,.28)` }} className="mt-3 pl-3.5 py-1">{b.nota}</div>}
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* II. Espaços e Valores */}
      {secHeader("II", "Espaços e Valores")}
      <div style={{ fontFamily: serif, fontWeight: 600, fontSize: 20 }} className="mb-5">Locação apenas <span style={{ fontStyle: "italic", fontWeight: 400, fontSize: 15, color: INK_SOFT }}>— consumo em comanda no evento</span></div>
      <div className="space-y-4 mb-10">
        {ESPACOS.map((e) => (
          <div key={e.nome} className="bg-white p-6" style={{ border: "1px solid rgba(10,10,10,.1)", borderLeft: `4px solid ${RED}`, boxShadow: "0 6px 20px rgba(0,0,0,.05)" }}>
            <div className="flex justify-between items-start gap-4 flex-wrap pb-3 mb-3" style={{ borderBottom: "1px solid rgba(10,10,10,.1)" }}>
              <div style={{ fontFamily: serif, fontWeight: 600, fontSize: 24, letterSpacing: "-0.015em" }}>{e.nome}</div>
              <div style={{ fontFamily: sans, fontSize: 10, letterSpacing: "0.18em", textTransform: "uppercase", color: INK_SOFT }} className="text-right pt-1.5">{e.meta}</div>
            </div>
            <div className="flex items-baseline gap-3 py-2">
              <span style={{ fontFamily: serif, fontWeight: 500, fontSize: 25 }}>{e.taxa}</span>
              <span style={{ fontFamily: sans, fontSize: 10, letterSpacing: "0.22em", textTransform: "uppercase", color: INK_SOFT }}>taxa de locação</span>
            </div>
            <div className="mt-3 p-4" style={{ background: "rgba(120,40,39,.05)", borderLeft: `2px solid ${RED}` }}>
              <div style={{ fontFamily: sans, fontWeight: 600, fontSize: 11, letterSpacing: "0.2em", textTransform: "uppercase", color: RED }} className="mb-2">Desconto progressivo sobre a locação</div>
              <ul className="space-y-1">
                {e.descontos.map((d, i) => <li key={i} style={{ fontFamily: serif, fontSize: 15, lineHeight: 1.5 }}>{d}</li>)}
              </ul>
              {e.nota && <div style={{ fontFamily: serif, fontStyle: "italic", fontSize: 13, color: INK_SOFT, borderTop: "1px dotted rgba(0,0,0,.15)" }} className="mt-2.5 pt-2.5">{e.nota}</div>}
            </div>
          </div>
        ))}
      </div>

      <div style={{ fontFamily: serif, fontWeight: 600, fontSize: 20 }} className="mb-5">Pacote com comida e bebida <span style={{ fontStyle: "italic", fontWeight: 400, fontSize: 15, color: INK_SOFT }}>— valor por pessoa, em qualquer espaço</span></div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
        {PACOTES.map((p) => (
          <div key={p.janela} className="bg-white p-5" style={{ border: "1px solid rgba(10,10,10,.1)" }}>
            <div style={{ fontFamily: sans, fontWeight: 600, fontSize: 11, letterSpacing: "0.2em", textTransform: "uppercase", color: RED }} className="mb-3 pb-2" >{p.janela}</div>
            <table className="w-full" style={{ borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={{ fontFamily: sans, fontSize: 9, letterSpacing: "0.16em", textTransform: "uppercase", color: INK_SOFT, textAlign: "left", paddingBottom: 8 }}>Por pessoa</th>
                  <th style={{ fontFamily: sans, fontSize: 9, letterSpacing: "0.16em", textTransform: "uppercase", color: INK_SOFT, textAlign: "right", paddingBottom: 8 }}>Sem álcool</th>
                  <th style={{ fontFamily: sans, fontSize: 9, letterSpacing: "0.16em", textTransform: "uppercase", color: INK_SOFT, textAlign: "right", paddingBottom: 8 }}>Com álcool</th>
                </tr>
              </thead>
              <tbody>
                {p.linhas.map((l, i) => (
                  <tr key={i} style={{ borderTop: "1px solid rgba(10,10,10,.1)" }}>
                    <td style={{ fontFamily: sans, fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: INK_SOFT, padding: "10px 0" }}>{l[0]}</td>
                    <td style={{ fontFamily: serif, fontWeight: 600, fontSize: 18, textAlign: "right" }}>{l[1]}</td>
                    <td style={{ fontFamily: serif, fontWeight: 600, fontSize: 18, textAlign: "right", color: RED }}>{l[2]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
      <div style={{ fontFamily: serif, fontStyle: "italic", fontSize: 13.5, color: INK_SOFT, border: "1px dashed rgba(10,10,10,.28)" }} className="p-3.5 mb-12">
        Todos os pacotes incluem <strong style={{ fontStyle: "normal", color: INK }}>3h30 de consumo</strong>. Vinhos e outras bebidas podem ser incluídos mediante ajuste no valor. Condições negociadas diretamente com o cliente.
      </div>

      <div className="text-center" style={{ fontFamily: serif, fontStyle: "italic", fontSize: 16, color: INK_SOFT }}>
        Preencha abaixo pra a gente verificar a disponibilidade e montar seu orçamento. 👇
      </div>
    </div>
  );
}

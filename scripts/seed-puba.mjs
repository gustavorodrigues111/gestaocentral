// Input inicial dos cardápios do Puba (Comidas, Bebidas, Vinhos) direto no
// Firestore. Acha o restaurante pelo nome (/puba/i), faz login de admin (a regra
// do Firestore exige auth pra escrever) e grava `cardapioEstruturado/{rid}.cardapios`.
//
// USO (na raiz do projeto):
//   node scripts/seed-puba.mjs
//   → ele pergunta o e-mail e a SENHA na hora (senha não aparece e não passa
//     pelo shell, então não tem problema de aspas/caractere especial).
//   As chaves do Firebase ele lê do .env.local / .env sozinho.
//   Já existe cardápio e quer sobrescrever? Rode com FORCE=1.
//
// Idempotente: IDs determinísticos — rodar de novo re-grava no mesmo lugar.

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import readline from "node:readline";
import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import { getFirestore, collection, getDocs, doc, getDoc, setDoc } from "firebase/firestore";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// ── carrega .env.local / .env (sem dep) ──────────────────────────────────────
async function carregarEnv() {
  for (const nome of [".env.local", ".env"]) {
    try {
      const txt = await fs.readFile(path.join(ROOT, nome), "utf8");
      for (const linha of txt.split("\n")) {
        const m = linha.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
        if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
      }
    } catch { /* arquivo pode não existir */ }
  }
}

// ── perguntas no terminal ────────────────────────────────────────────────────
function pergunta(label, padrao = "") {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((res) => rl.question(`${label}${padrao ? ` [${padrao}]` : ""}: `, (a) => { rl.close(); res((a || padrao).trim()); }));
}
// Senha SEM eco: escreve o prompt, muta a saída e lê a linha via readline.
function perguntaSenha(label) {
  return new Promise((res) => {
    process.stdout.write(label + ": ");
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = () => {}; // não ecoa o que for digitado
    rl.question("", (ans) => { rl.close(); process.stdout.write("\n"); res(ans); });
  });
}

// ── dados dos cardápios (seção = [nome, [[titulo, subtitulo, preco], ...]]) ───
const COMIDAS = [
  ["Tapas", [
    ["Pão de Maniva e Manteiga de Cupuaçu", "produzido pela @nautapadariaartesanal para nós", "26"],
    ["Beijus Cica Assados", "com manteiga de cupuaçu", "26"],
    ["Babaganoush de Berinjela com Pasta de Amendoim", "hortelã, dill e beijus com zaatar · troque beijus por pão de maniva +$ 11", "42"],
    ["Ceviche Thai-Paraense de Atum", "atum cru, molho à base de tucupi, namplá, chuchu, castanha do pará, gengibre e limão", "72"],
    ["Tostada de Lula com Chouriço Marajoara", "no pão de maniva da Nauta Padaria", "60"],
    ["Copa Lombo Defumada com Tucupi Preto", "+ picles de maxixe e mostarda fermentada com tucupi", "44"],
    ["Guioza de Porco no Vapor", "servido no tucupi temperado, chilly oil e gergelim", "64"],
    ["Tacos de Mandioca com Brisket", "dupla de tacos recheada de peito de boi assado lentamente + coalhada, picles de cebola e coentro", "46"],
    ["Bao de Barriga de Porco", "com teriyaki de tucupi preto, picles de pepino e maionese de gochujang", "56"],
  ]],
  ["Pratos", [
    ["Polvo com Bolo de Macaxeira", "polvo grelhado, bolo de macaxeira salgado com queijo curado, aioli e páprica defumada", "129"],
    ["Bobó Curry de Caranguejo", "com leite de coco, amendoim, coentro e gohan", "99"],
    ["Arroz de Cupim de Forno", "com linguiça Marajoara, tucupi e agrião", "99"],
  ]],
  ["Sobremesas", [
    ["Bolo de Macaxeira & Bacuri", "com chocolate branco, bacuri fresco e tapioca caramelizada", "38"],
    ["Mousse de Chocolate com Cachaça Lobozó", "gel de taperebá, paçoca de amendoim com farinha", "38"],
  ]],
];

const BEBIDAS = [
  ["Drinks Clássicos", [
    ["Caipirinha de Limão Mexerica", "", "42"],
    ["Negroni", "gin | vermute | campari | laranja", "42"],
    ["Rabo de Galo", "cachaça | vermute tinto | limão", "40"],
    ["Vermutônica", "vermute | água tônica | laranja", "38"],
    ["Aperol Spritz", "aperol | espumante | laranja", "40"],
    ["Dry Martini", "gin | vermouth | azeitona siciliana", "42"],
    ["Bee's Knees", "gin | xarope de mel | limão", "42"],
  ]],
  ["Drinks Autorais", [
    ["Jambunaíma", "cachaça de jambu | fernet | limão", "42"],
    ["Cupuaçu Spritz", "shrub de cupuaçu | aperol | vermute | espumante", "46"],
    ["Tiquira Smash", "tiquira | vermute dry | hortelã", "46"],
    ["Jacá Highball", "gin | taperebá | água tônica | gengibre · opção sem álcool $ 39", "46"],
    ["Daiquiri de Limão Mexerica", "rum | xarope de limão mexerica", "46"],
  ]],
  ["Cervejas", [
    ["Heineken 330ml", "", "15"],
    ["Heineken Zero 350ml", "", "14"],
  ]],
  ["Não Alcoólicos", [
    ["Água com ou sem Gás", "", "9"],
    ["Água Tônica", "", "9"],
    ["Suco de Cupuaçu ou Taperebá", "", "12"],
  ]],
  ["Após a Refeição", [
    ["Café Espresso", "", "10"],
    ["Licor Bergamoncello", "", "32"],
  ]],
];

const VINHOS = [
  ["Vinhos Brancos", [
    ["Heiderer-Mayer", "uva: grüner veltliner / Wagram, Áustria. Seco, direto e refrescante — maçã verde, pera e ervas frescas.", "210"],
    ["Klet Brda, Avia", "uva: pinot grigio / Goriška Brda, Eslovênia. Leve, com notas cítricas, de abacaxi e pêssego.", "185"],
    ["Puba Riesling", "uva: riesling itálico / Serra Gaúcha, Brasil. Edição especial com a Don Guerino — cítrico, floral, leve e mineral.", "149"],
    ["Torrederos, 2022", "uva: verdejo / Rueda, Espanha. Refrescante, floral e frutado, com erva-doce e anis.", "190"],
    ["Beyra Branco", "uva: síria, fonte cal, roupeiro / Beira Interior, Portugal. Frutas brancas, cítrico e leve toque mineral.", "215"],
    ["Leth, Duett", "uva: riesling, grüner veltliner / Wagram, Áustria. Floral, pera e maçã verde — fresco e vibrante.", "280"],
    ["Krya Branco", "uva: pecorino / Abruzzo, Itália. Frutas brancas maduras, pera e toque cítrico, com boa acidez.", "220"],
    ["Alento Branco", "uva: arinto, antão vaz, roupeiro / Alentejo, Portugal. Cítrico, mineral e equilibrado.", "200"],
  ]],
  ["Vinho Rosé", [
    ["Vamos de Parranda Rosé", "uva: criolla / Mendoza, Argentina. Frutas vermelhas frescas e toque floral — leve e seco.", "230"],
  ]],
  ["Vinhos Tintos", [
    ["Il Mantile Rosso Toscana", "uva: sangiovese, canaiolo, ciliegiolo / Toscana, Itália. Frutas vermelhas maduras, ervas e leve toque especiado.", "248"],
    ["Y Tu de Quién Eres", "uva: bobal e autóctones / Castilla-La Mancha, Espanha. Frutas vermelhas, notas florais e toque terroso.", "242"],
    ["Beyra Tinto", "uva: tinta roriz, jaen, touriga nacional / Beira Interior, Portugal. Frutado e mineral, com frutos silvestres.", "200"],
    ["Els Nanos Tinto", "uva: tempranillo, trepat, cabernet / Conca de Barberá, Espanha. Jovem, fresco e frutado.", "235"],
    ["Alento Tinto", "uva: aragonez, trincadeira, touriga nacional / Alentejo, Portugal. Frutos vermelhos, equilibrado e fresco.", "200"],
  ]],
  ["Espumantes", [
    ["Puba Brut Rosé", "uva: malbec / Serra Gaúcha, Brasil. Edição especial com a Don Guerino — frutas vermelhas, cremoso e seco, borbulhas finas.", "149"],
    ["Nero Brutt", "corte de uvas brancas / Brasil. Frutas frescas e flores — leve, cremoso e refrescante.", "180"],
  ]],
];

// ── monta os cardápios com IDs determinísticos ───────────────────────────────
function montarCardapio(menuId, nome, secoesRaw) {
  return {
    id: menuId,
    nome,
    temCapa: true,
    tituloCapa: nome.toUpperCase(),
    secoes: secoesRaw.map(([secNome, pratos], si) => ({
      id: `${menuId}_s${si}`,
      nome: secNome,
      pratos: pratos.map(([titulo, subtitulo, preco], pi) => ({
        id: `${menuId}_s${si}_p${pi}`,
        titulo,
        ...(subtitulo ? { subtitulo } : {}),
        ...(preco ? { preco } : {}),
      })),
    })),
  };
}

// Tira espaços e um par de aspas em volta (retas OU curvas — editores trocam " por “”).
function unquote(v) {
  let s = (v || "").trim();
  for (const [a, b] of [['"', '"'], ["'", "'"], ["“", "”"], ["‘", "’"]]) {
    if (s.length >= 2 && s[0] === a && s[s.length - 1] === b) { s = s.slice(1, -1); break; }
  }
  return s.trim();
}

async function main() {
  await carregarEnv();
  const cfg = {
    apiKey: process.env.VITE_FIREBASE_API_KEY,
    authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.VITE_FIREBASE_PROJECT_ID || "gestaocentral-85b13",
    storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.VITE_FIREBASE_APP_ID,
  };
  if (!cfg.apiKey) throw new Error("VITE_FIREBASE_API_KEY ausente — rode na raiz do projeto (que tem .env.local).");

  // E-mail e senha: do ambiente, senão pergunta na hora.
  const email = unquote(process.env.SEED_EMAIL) || await pergunta("E-mail do admin", "gustavo@quibebe.com.br");
  const senha = unquote(process.env.SEED_PASSWORD) || await perguntaSenha("Senha do admin");
  if (!email || !senha) throw new Error("E-mail/senha vazios.");

  const app = initializeApp(cfg);
  const auth = getAuth(app);
  const db = getFirestore(app);

  console.log("→ login como", email);
  const cred = await signInWithEmailAndPassword(auth, email, senha);
  const uid = cred.user.uid;

  console.log("→ procurando o restaurante Puba…");
  const snap = await getDocs(collection(db, "restaurants"));
  const puba = snap.docs.find((d) => /puba/i.test((d.data().nome || "")));
  if (!puba) {
    console.error("Restaurantes encontrados:", snap.docs.map((d) => d.data().nome));
    throw new Error("Não achei nenhum restaurante com 'puba' no nome.");
  }
  const rid = puba.id;
  console.log("✓ Puba =", puba.data().nome, "| id =", rid);

  const cardapios = [
    montarCardapio("puba_comidas", "Comidas", COMIDAS),
    montarCardapio("puba_bebidas", "Bebidas", BEBIDAS),
    montarCardapio("puba_vinhos", "Vinhos", VINHOS),
  ];
  const totalItens = cardapios.reduce((a, c) => a + c.secoes.reduce((b, s) => b + s.pratos.length, 0), 0);

  // Guarda: não sobrescreve edições já feitas, a não ser com FORCE=1.
  const ref = doc(db, "cardapioEstruturado", rid);
  const atual = await getDoc(ref);
  const jaTem = atual.exists() && Array.isArray(atual.data().cardapios) && atual.data().cardapios.length > 0;
  if (jaTem && !process.env.FORCE) {
    console.error(`\n⚠ O Puba já tem ${atual.data().cardapios.length} cardápio(s) gravado(s).`);
    console.error("  Pra sobrescrever (apaga edições feitas no app), rode de novo com FORCE=1.\n");
    process.exit(1);
  }

  await setDoc(ref, {
    id: rid, restaurantId: rid, cardapios,
    pubaSeed: true, atualizadoEm: new Date().toISOString(), atualizadoPor: uid,
  }, { merge: true });

  console.log(`\n✓ Gravado em cardapioEstruturado/${rid}`);
  console.log(`  ${cardapios.length} cardápios · ${totalItens} itens. Abra o módulo Cardápio do Puba e edite à vontade.`);
  process.exit(0);
}

main().catch((e) => {
  const code = e?.code || "";
  console.error("\n✗ Erro:", e.message || e);
  if (code.includes("invalid-credential") || code.includes("wrong-password") || code.includes("user-not-found")) {
    console.error("  → Senha ou e-mail não conferem. Teste o MESMO login no /adm do app pra confirmar.");
  } else if (code.includes("app-check")) {
    console.error("  → App Check está bloqueando. Me avise que eu troco pra outra abordagem.");
  }
  process.exit(1);
});

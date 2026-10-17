// ════════════════════════════════════════════════════════════════════════════
//  /pdv-update/<arquivo> — feed de AUTO-UPDATE do app de caixa (electron-updater).
//
//  A política da organização bloqueia bucket público no GCS, então NÃO dá pra
//  servir o feed direto de um bucket público. Aqui a gente serve o feed pelo
//  próprio domínio e REDIRECIONA (302) pros arquivos no Firebase Storage, que
//  são acessíveis por TOKEN (não é acesso público — respeita a política).
//
//  Os arquivos de update (latest.yml, latest-mac.yml, instaladores, blockmaps)
//  ficam em /pdv-updates/ no bucket, todos com o MESMO token (SHARED_TOKEN).
//
//  Rewrite no vercel.json: /pdv-update/(.*) -> /api/pdv-update?file=$1
// ════════════════════════════════════════════════════════════════════════════
const BUCKET = "gestaocentral-85b13.firebasestorage.app";
const SHARED_TOKEN = "87522B2C-9534-4645-B0E0-F5348BB246C6";

type VercelReq = { query?: Record<string, string | string[] | undefined> };
type VercelRes = { status: (c: number) => VercelRes; setHeader: (k: string, v: string) => void; end: (b?: string) => void };

export default function handler(req: VercelReq, res: VercelRes) {
  let file = req.query?.file;
  if (Array.isArray(file)) file = file[0];
  file = (file || "").toString();
  try { file = decodeURIComponent(file); } catch { /* já estava decodificado */ }
  // Só nome de arquivo simples (sem path traversal / subpastas).
  if (!file || file.includes("..") || file.includes("/") || file.includes("\\")) {
    res.status(400).end("arquivo inválido");
    return;
  }
  const objeto = encodeURIComponent("pdv-updates/" + file);
  const url = `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/${objeto}?alt=media&token=${SHARED_TOKEN}`;
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Location", url);
  res.status(302).end();
}

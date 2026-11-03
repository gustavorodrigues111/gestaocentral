# Painel do Salão — app de parede (desktop)

App Electron que abre a rota **`/painel-estacao`** do planejamento.app em **tela
cheia (kiosk)**, sempre ligado numa TV/monitor do salão. Mostra, só pra ver:
música ambiente (com controle), reservas do turno, freelas & turnos, checklists
(% + aviso de atraso) e o WhatsApp a responder. **Só visualização** — qualquer
ação cai no portão "use seu login no celular/navegador".

## Como funciona
- A estação se identifica por um **código de estação** (token), gerado no admin
  em **Download de Apps → Estações do Painel** (um por restaurante).
- O código é digitado **uma vez** na própria tela do app (fica salvo) ou
  pré-preenchido no `config.json`. O app lê tudo do servidor (`/api/painel-feed`),
  **read-only**, escopado a 1 restaurante. Revogar = desligar o código no admin.
- Não há login de pessoa na parede, nem acesso direto ao banco.

## Configurar (`config.json`)
```json
{
  "url": "https://admin.planejamento.app/painel-estacao",
  "token": "",        // opcional: cole o código p/ já abrir ativado
  "kiosk": true        // true = tela cheia travada (Ctrl+Shift+Q sai)
}
```
Atalhos na parede: **Ctrl+R / F5** recarrega · **Ctrl+Shift+Q** sai do kiosk.

## Rodar (desenvolvimento)
```bash
cd desktop-painel
npm install
npm start
```

## Gerar o instalador (Windows)
```bash
cd desktop-painel
npm install
npm run dist:win   # electron-builder --win --x64  → dist/
```
> **Use --x64, nunca arm64** (as máquinas de parede são Intel/AMD). Sem
> assinatura, o Windows pede pra liberar no SmartScreen na 1ª instalação.

## Publicar (auto-update)
O `electron-builder` gera em `dist/`: `Painel do Salao Setup <versão>.exe`,
`latest.yml` e um `.blockmap`. Suba os três pra `painel-updates/` no bucket, com
o token de download compartilhado (mesma mecânica do PDV):

```bash
TOKEN=87522B2C-9534-4645-B0E0-F5348BB246C6
BUCKET=gs://gestaocentral-85b13.firebasestorage.app/painel-updates
cd desktop-painel/dist
for f in "Painel do Salao Setup"*.exe latest.yml *.blockmap; do
  gsutil -h "x-goog-meta-firebaseStorageDownloadTokens:$TOKEN" cp "$f" "$BUCKET/"
done
```
O feed fica em `https://admin.planejamento.app/painel-update/latest.yml` (o app
checa ao abrir e a cada 2h; instala a versão nova ao reabrir).

## Entrada no "Download de Apps"
No admin (master): **Download de Apps → Novo app** → nome "Painel do Salão",
versão, arquivo Windows apontando pro `.exe`:
`https://admin.planejamento.app/painel-update/Painel%20do%20Salao%20Setup%20<versão>.exe`
(a entrada do catálogo é só o atalho de download; o auto-update é pelo feed).

## Primeiro uso na parede
1. Instale o `.exe`. O app abre em tela cheia e pede o **código de estação**.
2. Cole o código gerado no admin pra aquele restaurante → **Ativar painel**.
3. Fica salvo; nas próximas aberturas já entra direto no painel.

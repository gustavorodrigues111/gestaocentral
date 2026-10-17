# Planejamento PDV — app de caixa (desktop)

App Electron que abre o módulo **Comandas** numa janela dedicada (sem Chrome) e
**imprime direto na Epson por IP** (ESC/POS: corte de papel + QR do DANFCe),
dispensando o truque do `--kiosk-printing`.

## Como funciona
- A janela carrega `comandas.planejamento.app` (login normal).
- Quando o site roda dentro do app, ele detecta `window.pdvBridge` e manda os
  jobs de impressão pra cá; o app imprime via TCP no IP da impressora.
- Fora do app (navegador comum), nada muda — segue a impressão pela Estação.

## Configurar
Edite `config.json`:
```json
{
  "url": "https://comandas.planejamento.app",
  "caixaNome": "Caixa 1",
  "printerIp": "192.168.0.50",   // IP da Epson (fixe por reserva de DHCP)
  "printerPort": 9100,
  "kiosk": false,                 // true = tela cheia travada
  "larguraColunas": 48            // 48 p/ 80mm; 32 p/ 58mm
}
```

## Rodar (desenvolvimento)
```bash
cd desktop
npm install
npm start
```

## Gerar o instalador
```bash
npm run dist:mac    # .dmg (Mac)
npm run dist:win    # .exe/NSIS (Windows)
```
> **Assinatura/notarização** (pra distribuir sem alerta de "app não verificado")
> e **auto-update** exigem conta Apple Developer / certificado Windows — passo
> seguinte, quando você tiver as contas. Sem assinar, dá pra instalar liberando
> manualmente no Gatekeeper (Mac) / SmartScreen (Windows).

## Multi-impressora (futuro)
Hoje imprime tudo num IP. Pra bar/cozinha separados, evoluir `print.js` pra
rotear por `job.estacaoId` → IP da estação (mapa no config.json).

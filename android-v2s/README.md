# App da maquininha (Sunmi V2s Label)

Casca Android do planejamento.app. Abre https://planejamento.app em tela cheia e
expõe `window.SunmiBridge` para a impressora interna (etiqueta com sensor de gap)
e para o leitor de QR da Sunmi. Toda a lógica e as telas continuam no site:
publicou na Vercel, a maquininha já está na versão nova.

## Gerar o APK

**Pelo GitHub (sem instalar nada):** mova `android-v2s/ci/android-v2s.yml` para
`.github/workflows/`, faça o push e rode em Actions > "APK maquininha V2s" > Run
workflow. Ao terminar, baixe o artefato `planejamento-v2s-apk`.

**Pelo Android Studio:** File > Open > pasta `android-v2s`. Espere sincronizar e
use Build > Build APK(s).

## Instalar na maquininha

1. Copie o APK para o aparelho (cabo USB, Drive ou WhatsApp) e abra o arquivo.
   Permita "instalar apps desconhecidos" quando o Android pedir.
2. Em Configurações > Impressora (nome varia no SUNMI OS), troque o modo de
   impressão para **Etiqueta** e coloque o rolo de etiqueta.
3. Abra o app "Planejamento", faça login e vá em Controles de Validades >
   Etiquetas.

## Checklist do piloto

- [ ] Status no topo da aba mostra "Maquininha (impressora interna)" sem aviso
- [ ] Etiqueta sai inteira dentro da área, sem invadir o espaço entre etiquetas
- [ ] Após imprimir, a etiqueta para na serrilha para destacar
- [ ] 5 cópias seguidas saem alinhadas (sem desvio acumulado)
- [ ] QR da etiqueta é lido pelo celular
- [ ] Botão "Ler QR" na aba Baixa abre o leitor da Sunmi
- [ ] Login continua salvo depois de fechar e abrir o app

## Pontos a confirmar no aparelho

- Versão do `com.sunmi:printerlibrary` (build.gradle.kts). Se a sincronização
  falhar, use a última publicada no Maven Central.
- Nome do pacote do leitor de QR (`com.sunmi.sunmiqrcodescanner`). Se não abrir,
  a aba cai na leitura pela câmera do próprio site.

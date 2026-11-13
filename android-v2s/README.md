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

## Atualização automática (não precisa reinstalar a cada versão)

O app é uma casca do site: **telas e lógica atualizam sozinhas** a cada deploy
na Vercel. Só a **casca nativa** (impressora, leitor, botão físico) precisa de
APK novo — e isso agora também atualiza pela internet:

- Ao abrir, o app lê `apks/latest.json` no Storage. Se o `versionCode` de lá for
  maior que o instalado, oferece **"Atualizar agora"** (baixa o APK e instala via
  PackageInstaller — o Android pede confirmação). Há também **Menu → Buscar
  atualização**.
- **Para publicar uma versão nativa nova:**
  1. Suba `versionCode`/`versionName` em `app/build.gradle.kts` e gere o APK.
  2. Upload do APK em `apks/planejamento-v2s.apk` (mantendo o mesmo token).
  3. Edite `apks/latest.json` com o novo `versionCode`/`versionName` (o campo
     `url` aponta sempre pro mesmo APK). As maquininhas pegam na próxima abertura.
- A primeira instalação do app **com** o atualizador ainda é manual (uma vez).

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
- [ ] Botão FÍSICO lateral abre o leitor (na aba Baixa / Etiquetas emitidas)
- [ ] Login continua salvo depois de fechar e abrir o app
- [ ] Menu > Buscar atualização responde (e atualiza quando há versão nova)

## Pontos a confirmar no aparelho

- Versão do `com.sunmi:printerlibrary` (build.gradle.kts). Se a sincronização
  falhar, use a última publicada no Maven Central.
- Nome do pacote do leitor de QR (`com.sunmi.sunmiqrcodescanner`). Se não abrir,
  a aba cai na leitura pela câmera do próprio site.

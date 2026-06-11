// ════════════════════════════════════════════════════════════════════════════
//  Cloud Functions — Planner / Google Calendar
//
//  v1 (F1): conectar a conta Google (OAuth) e guardar o refresh_token.
//  Single-user: só o dono (OWNER_UID) conecta; o token é privado (Firestore com
//  regras que negam leitura ao cliente — só Admin SDK acessa).
//
//  Próximas etapas (F1b+): sync inicial (events.list + syncToken) → espelho no
//  Firestore; webhook (events.watch); escrita (insert/patch/delete).
// ════════════════════════════════════════════════════════════════════════════

import * as functions from "firebase-functions/v1";
import * as admin from "firebase-admin";
import { google } from "googleapis";

admin.initializeApp();
const db = admin.firestore();

// ── Config ──────────────────────────────────────────────────────────────────
const OWNER_UID = "Z7SQHCz4koNbLfiRCh7Hb7PpOau2"; // gustavo@quibebe.com.br
const CLIENT_ID = "777358299957-ojakrj15eaefgr8s6vmsrnj9p5nm8aca.apps.googleusercontent.com";
const REGION = "southamerica-east1";
const APP_URL = "https://admin.planejamento.app/planner";
const SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/calendar",
];

function oauthClient(redirectUri: string, clientSecret: string) {
  return new google.auth.OAuth2(CLIENT_ID, clientSecret, redirectUri);
}

// Endpoint único de OAuth:
//   • sem ?code  → START: valida que é o dono (idToken) e redireciona pro Google.
//   • com ?code  → CALLBACK: troca code→tokens, guarda refresh_token, volta pro app.
export const plannerGoogleAuth = functions
  .region(REGION)
  .runWith({ secrets: ["GOOGLE_CLIENT_SECRET"] })
  .https.onRequest(async (req, res) => {
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET || "";
    if (!clientSecret) { res.status(500).send("Secret GOOGLE_CLIENT_SECRET não configurado."); return; }
    // O redirect_uri tem que ser IDÊNTICO ao cadastrado no OAuth client.
    const redirectUri = `https://${req.get("host")}${req.path}`;
    const oauth2 = oauthClient(redirectUri, clientSecret);

    const code = typeof req.query.code === "string" ? req.query.code : undefined;

    // ── START ──────────────────────────────────────────────────────────────
    if (!code) {
      const idToken = typeof req.query.idToken === "string" ? req.query.idToken : undefined;
      if (!idToken) { res.status(401).send("Faltou idToken."); return; }
      try {
        const decoded = await admin.auth().verifyIdToken(idToken);
        if (decoded.uid !== OWNER_UID) { res.status(403).send("Planner é pessoal."); return; }
      } catch {
        res.status(401).send("Token inválido.");
        return;
      }
      // nonce anti-CSRF (validado no callback)
      const nonceRef = db.collection("plannerOAuthState").doc();
      await nonceRef.set({ criadoEm: admin.firestore.FieldValue.serverTimestamp() });
      const url = oauth2.generateAuthUrl({
        access_type: "offline",
        prompt: "consent", // garante refresh_token sempre
        include_granted_scopes: true,
        scope: SCOPES,
        state: nonceRef.id,
      });
      res.redirect(url);
      return;
    }

    // ── CALLBACK ─────────────────────────────────────────────────────────────
    const state = typeof req.query.state === "string" ? req.query.state : undefined;
    if (!state) { res.status(400).send("state ausente."); return; }
    const stateRef = db.collection("plannerOAuthState").doc(state);
    const stateSnap = await stateRef.get();
    if (!stateSnap.exists) { res.status(400).send("state inválido ou expirado."); return; }
    await stateRef.delete();

    try {
      const { tokens } = await oauth2.getToken(code);
      oauth2.setCredentials(tokens);

      // Descobre o e-mail da conta conectada (escopo email).
      let email: string | null = null;
      try {
        const oauth2api = google.oauth2({ version: "v2", auth: oauth2 });
        const me = await oauth2api.userinfo.get();
        email = me.data.email || null;
      } catch (e) {
        console.warn("[plannerGoogleAuth] não consegui ler userinfo:", e);
      }

      // Guarda o refresh_token (PRIVADO — regras negam leitura ao cliente).
      if (tokens.refresh_token) {
        await db.collection("plannerPrivate").doc(OWNER_UID).set({
          refreshToken: tokens.refresh_token,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
      }

      // Status legível pelo dono (front mostra "Conectado: email").
      await db.collection("plannerStatus").doc(OWNER_UID).set({
        connected: true,
        email,
        connectedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });

      res.redirect(`${APP_URL}?google=connected`);
    } catch (e) {
      console.error("[plannerGoogleAuth] callback falhou:", e);
      res.redirect(`${APP_URL}?google=error`);
    }
  });

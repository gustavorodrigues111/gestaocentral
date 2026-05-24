// Firebase configuration
// Lê do .env (.env.local pra dev, env vars do Vercel pra produção).
// Todas as vars começam com VITE_ pra serem expostas no bundle (padrão Vite).
//
// Importante: as chaves Firebase web são PÚBLICAS por design. A segurança vem
// das Firestore Rules (versionadas no firestore.rules) + Firebase App Check.

import { initializeApp } from "firebase/app";
import { getFirestore, type Firestore } from "firebase/firestore";
import { getAuth, type Auth } from "firebase/auth";
import { getStorage, type FirebaseStorage } from "firebase/storage";
import { initializeAppCheck, ReCaptchaV3Provider } from "firebase/app-check";

const firebaseConfig = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId:             import.meta.env.VITE_FIREBASE_APP_ID,
};

// Valida presença das chaves antes de inicializar
function validateConfig() {
  const missing = Object.entries(firebaseConfig).filter(([, v]) => !v).map(([k]) => k);
  if (missing.length > 0) {
    console.error("Firebase config faltando:", missing);
    throw new Error(
      `Firebase config faltando. Crie um arquivo .env.local na raiz com:\n` +
      `VITE_FIREBASE_API_KEY, VITE_FIREBASE_AUTH_DOMAIN, VITE_FIREBASE_PROJECT_ID, VITE_FIREBASE_STORAGE_BUCKET, VITE_FIREBASE_MESSAGING_SENDER_ID, VITE_FIREBASE_APP_ID\n` +
      `Veja .env.example.`
    );
  }
}

let app: ReturnType<typeof initializeApp>;
let db: Firestore;
let auth: Auth;
let storage: FirebaseStorage;

try {
  validateConfig();
  app = initializeApp(firebaseConfig);
  db = getFirestore(app);
  auth = getAuth(app);
  storage = getStorage(app);

  // App Check (opcional — só ativa se a env var estiver setada)
  const recaptchaSiteKey = import.meta.env.VITE_RECAPTCHA_SITE_KEY;
  if (recaptchaSiteKey) {
    try {
      initializeAppCheck(app, {
        provider: new ReCaptchaV3Provider(recaptchaSiteKey),
        isTokenAutoRefreshEnabled: true,
      });
    } catch (e) {
      console.warn("App Check falhou ao iniciar:", e);
    }
  }
} catch (e) {
  // Em dev, deixa propagar a mensagem clara. Em produção, mostra fallback.
  if (import.meta.env.DEV) throw e;
  console.error("Firebase init falhou:", e);
}

export { app, db, auth, storage };

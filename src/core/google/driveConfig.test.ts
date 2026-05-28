// Testes da config da integração Google Drive.
//
// Rodar:
//   npm test           — uma vez (CI)
//   npm run test:watch — modo watch (dev)

import { describe, expect, it } from "vitest";
import {
  GOOGLE_CLIENT_ID,
  DRIVE_SCOPE,
  isDriveConfigured,
  driveFolderUrl,
} from "./driveConfig";

describe("driveConfig", () => {
  it("usa o fallback público quando VITE_GOOGLE_CLIENT_ID não está setado", () => {
    // Em teste não há env var → cai no fallback versionado.
    expect(GOOGLE_CLIENT_ID).toMatch(/\.apps\.googleusercontent\.com$/);
  });

  it("escopo é o mínimo (drive.file), nunca o drive completo", () => {
    expect(DRIVE_SCOPE).toBe("https://www.googleapis.com/auth/drive.file");
  });

  it("isDriveConfigured reconhece um client id válido", () => {
    expect(isDriveConfigured()).toBe(true);
  });

  it("driveFolderUrl monta a URL pública da pasta", () => {
    expect(driveFolderUrl("ABC123")).toBe(
      "https://drive.google.com/drive/folders/ABC123",
    );
  });
});

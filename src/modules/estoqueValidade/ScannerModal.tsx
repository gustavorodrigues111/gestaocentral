// Leitor de QR pela câmera. Usa o BarcodeDetector nativo (Chrome/Android) e,
// quando ele não existe (ex.: Safari no iPhone), cai pro jsQR decodificando os
// frames do vídeo num canvas. A câmera (getUserMedia) funciona no iOS via HTTPS;
// só a decodificação precisava da lib. Fallback final: digitar o código.
import { useEffect, useRef, useState } from "react";
import jsQR from "jsqr";
import { Modal } from "../../core/ui/Modal";
import { Button } from "../../core/ui/Button";

type BarcodeDetectorLike = { detect: (s: CanvasImageSource) => Promise<Array<{ rawValue: string }>> };

export function ScannerModal({ onDetect, onClose, titulo = "Ler QR do produto", placeholder = "qr_…" }: {
  onDetect: (code: string) => void; onClose: () => void; titulo?: string; placeholder?: string;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [erro, setErro] = useState("");
  const [manual, setManual] = useState("");
  useEffect(() => {
    let stream: MediaStream | null = null; let raf = 0; let parar = false;
    const Ctor = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => BarcodeDetectorLike }).BarcodeDetector;
    (async () => {
      // 1) Abre a câmera primeiro — funciona em todo navegador com HTTPS (inclui iPhone).
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play(); }
      } catch {
        setErro("Não consegui abrir a câmera. Permita o acesso ou digite o código do QR.");
        return;
      }
      // 2) Decodificação: BarcodeDetector nativo quando existe; senão jsQR no canvas.
      const det = Ctor ? new Ctor({ formats: ["qr_code"] }) : null;
      let canvas: HTMLCanvasElement | null = null;
      let ctx: CanvasRenderingContext2D | null = null;
      const tick = async () => {
        if (parar) return;
        const vid = videoRef.current;
        if (!vid) return;
        try {
          if (det) {
            const codes = await det.detect(vid);
            const v = codes[0]?.rawValue;
            if (v) { onDetect(v); return; }
          } else if (vid.videoWidth) {
            // jsQR (iPhone/Safari): reduz o frame p/ no máx. 480px e decodifica.
            const esc = Math.min(1, 480 / vid.videoWidth);
            const w = Math.round(vid.videoWidth * esc);
            const h = Math.round(vid.videoHeight * esc);
            if (!canvas) { canvas = document.createElement("canvas"); ctx = canvas.getContext("2d", { willReadFrequently: true }); }
            if (canvas && ctx) {
              canvas.width = w; canvas.height = h;
              ctx.drawImage(vid, 0, 0, w, h);
              const img = ctx.getImageData(0, 0, w, h);
              const r = jsQR(img.data, w, h, { inversionAttempts: "dontInvert" });
              if (r?.data) { onDetect(r.data); return; }
            }
          }
        } catch { /* frame ruim */ }
        // jsQR é mais pesado: espaça os frames pra não travar o celular.
        if (det) raf = requestAnimationFrame(tick);
        else raf = window.setTimeout(() => { void tick(); }, 120) as unknown as number;
      };
      void tick();
    })();
    return () => { parar = true; if (raf) { cancelAnimationFrame(raf); clearTimeout(raf); } if (stream) stream.getTracks().forEach((t) => t.stop()); };
  }, [onDetect]);
  return (
    <Modal title={titulo} onClose={onClose} maxWidth="max-w-sm">
      <div className="space-y-3">
        {!erro ? (
          <div className="rounded-xl overflow-hidden bg-black aspect-square"><video ref={videoRef} className="w-full h-full object-cover" muted playsInline /></div>
        ) : (
          <p className="text-sm text-amber-600 dark:text-amber-400">{erro}</p>
        )}
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <label className="text-xs text-gray-500 block mb-1">Ou digite o código</label>
            <input value={manual} onChange={(e) => setManual(e.target.value)} placeholder={placeholder}
              className="w-full h-9 px-2.5 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 dark:text-gray-100" />
          </div>
          <Button onClick={() => manual.trim() && onDetect(manual.trim())} disabled={!manual.trim()}>OK</Button>
        </div>
      </div>
    </Modal>
  );
}

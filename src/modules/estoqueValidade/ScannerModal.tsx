// Leitor de QR pela câmera (BarcodeDetector nativo). Fallback: digitar o código.
// Na maquininha Sunmi, quem chama tenta antes o leitor nativo (lerQrNativo).
import { useEffect, useRef, useState } from "react";
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
      if (!Ctor) { setErro("Leitura por câmera não suportada aqui. Digite o código do QR."); return; }
      try {
        const det = new Ctor({ formats: ["qr_code"] });
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play(); }
        const tick = async () => {
          if (parar || !videoRef.current) return;
          try { const codes = await det.detect(videoRef.current); const v = codes[0]?.rawValue; if (v) { onDetect(v); return; } } catch { /* frame ruim */ }
          raf = requestAnimationFrame(tick);
        };
        void tick();
      } catch { setErro("Não consegui abrir a câmera. Digite o código do QR."); }
    })();
    return () => { parar = true; if (raf) cancelAnimationFrame(raf); if (stream) stream.getTracks().forEach((t) => t.stop()); };
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

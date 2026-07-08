// Ditado por voz (Web Speech API, pt-BR) reaproveitável. Auto-restart no onend
// enquanto grava (Chrome/Edge cortam após silêncio). Fallback: se o navegador
// não suportar, `iniciar` seta erroMic e o caller cai no digitar/colar.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useRef, useState } from "react";

export function useDitado() {
  const [gravando, setGravando] = useState(false);
  const [transcricao, setTranscricao] = useState("");
  const [parcial, setParcial] = useState("");
  const [erroMic, setErroMic] = useState("");
  const recRef = useRef<any>(null);
  const querGravarRef = useRef(false);
  const SR = typeof window !== "undefined" ? ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition) : null;

  useEffect(() => () => { querGravarRef.current = false; try { recRef.current?.stop(); } catch { /* noop */ } }, []);

  function iniciar() {
    setErroMic("");
    if (!SR) { setErroMic("Seu navegador não suporta ditado por voz. Use o Chrome/Edge no computador — ou digite/cole o texto."); return; }
    const rec = new SR();
    rec.lang = "pt-BR"; rec.continuous = true; rec.interimResults = true;
    rec.onresult = (ev: any) => {
      let fim = ""; let interim = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) { const t = ev.results[i][0].transcript; if (ev.results[i].isFinal) fim += t; else interim += t; }
      if (fim) setTranscricao(prev => (prev + " " + fim).replace(/\s+/g, " ").trimStart());
      setParcial(interim);
    };
    rec.onerror = (ev: any) => { if (ev.error !== "no-speech" && ev.error !== "aborted") setErroMic("Erro no microfone: " + ev.error); };
    rec.onend = () => { if (querGravarRef.current) { try { rec.start(); } catch { /* noop */ } } else { setGravando(false); setParcial(""); } };
    recRef.current = rec; querGravarRef.current = true;
    try { rec.start(); setGravando(true); } catch { setErroMic("Não consegui acessar o microfone."); }
  }
  function parar() { querGravarRef.current = false; try { recRef.current?.stop(); } catch { /* noop */ } setGravando(false); setParcial(""); }

  return { gravando, transcricao, setTranscricao, parcial, setParcial, erroMic, setErroMic, iniciar, parar, SR };
}

import { useCallback, useEffect, useRef, useState } from "react";

// The browser's own recogniser (Chrome, Edge, Safari): free, live, and
// good enough for practice. Final phrases are handed to onFinal as they
// settle; the interim text is shown but never committed, so the user
// edits a clean transcript. Chrome ends a continuous session after a
// pause, so onend restarts it while the user still wants to listen.

export function speechSupported() {
  return typeof window !== "undefined" && !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}

export function useSpeechRecognition({ onFinal, lang = "en-US" } = {}) {
  const supported = speechSupported();
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState(null);
  const recRef = useRef(null);
  const wantRef = useRef(false);
  const onFinalRef = useRef(onFinal);
  onFinalRef.current = onFinal;

  const stop = useCallback(() => {
    wantRef.current = false;
    try { recRef.current?.stop(); } catch { /* already stopped */ }
    setListening(false);
    setInterim("");
  }, []);

  const start = useCallback(() => {
    if (!supported) return;
    const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = lang;
    rec.onresult = (e) => {
      let pending = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        const text = r[0]?.transcript || "";
        if (r.isFinal) onFinalRef.current?.(text.trim());
        else pending += text;
      }
      setInterim(pending);
    };
    rec.onerror = (e) => {
      if (e.error === "no-speech" || e.error === "aborted") return;
      setError(e.error === "not-allowed" || e.error === "service-not-allowed"
        ? "Microphone access was blocked. Allow it in the address bar and try again."
        : `Speech recognition error: ${e.error}`);
      wantRef.current = false;
      setListening(false);
    };
    rec.onend = () => {
      if (wantRef.current) {
        try { rec.start(); } catch { setListening(false); }
      } else {
        setListening(false);
      }
    };
    recRef.current = rec;
    wantRef.current = true;
    setError(null);
    setInterim("");
    try {
      rec.start();
      setListening(true);
    } catch (e) {
      setError(e.message);
    }
  }, [supported, lang]);

  useEffect(() => () => {
    wantRef.current = false;
    try { recRef.current?.stop(); } catch { /* unmounting */ }
  }, []);

  const toggle = useCallback(() => (listening ? stop() : start()), [listening, start, stop]);
  return { supported, listening, interim, error, start, stop, toggle };
}

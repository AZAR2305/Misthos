"use client";

import { useEffect, useRef, useState } from "react";
import { CONFIG } from "@/lib/config";

interface GoogleId {
  initialize(cfg: { client_id: string; callback: (r: { credential: string }) => void; auto_select?: boolean; ux_mode?: "popup" }): void;
  renderButton(el: HTMLElement, opts: Record<string, unknown>): void;
}
declare global {
  interface Window {
    google?: { accounts: { id: GoogleId } };
  }
}

const SRC = "https://accounts.google.com/gsi/client";
let loading: Promise<void> | null = null;
function loadGoogle(): Promise<void> {
  if (window.google?.accounts?.id) return Promise.resolve();
  loading ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = SRC;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      loading = null;
      reject(new Error("blocked"));
    };
    document.head.appendChild(s);
  });
  return loading;
}

/**
 * Google's own "Sign in with Google" button. It returns a signed ID token, which the Misthos server verifies; nothing is
 * trusted from the browser. Without a client id the button is replaced by an honest "unavailable" line.
 */
export function GoogleButton({ onCredential }: { onCredential(credential: string): void }) {
  const box = useRef<HTMLDivElement>(null);
  const cb = useRef(onCredential);
  cb.current = onCredential;
  const [state, setState] = useState<"loading" | "ready" | "blocked">("loading");

  useEffect(() => {
    if (!CONFIG.googleClientId) return;
    let live = true;
    loadGoogle()
      .then(() => {
        if (!live || !box.current || !window.google) return;
        window.google.accounts.id.initialize({ client_id: CONFIG.googleClientId!, callback: (r) => cb.current(r.credential), ux_mode: "popup" });
        window.google.accounts.id.renderButton(box.current, { theme: "outline", size: "large", shape: "pill", text: "continue_with", width: 300 });
        setState("ready");
      })
      .catch(() => live && setState("blocked"));
    return () => {
      live = false;
    };
  }, []);

  if (!CONFIG.googleClientId) {
    return <p className="field-error">Unavailable: Google sign-in is not turned on for this site yet.</p>;
  }
  return (
    <div className="google-slot">
      <div ref={box} aria-label="Sign in with Google" />
      {state === "loading" && <p className="muted tiny">Loading Google…</p>}
      {state === "blocked" && <p className="field-error">Unavailable: Google sign-in could not load. Check that nothing is blocking accounts.google.com, then reload.</p>}
    </div>
  );
}

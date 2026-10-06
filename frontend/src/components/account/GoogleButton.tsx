"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { CONFIG } from "@/lib/config";

interface GoogleId {
  initialize(cfg: { client_id: string; callback: (r: { credential: string }) => void; auto_select?: boolean; ux_mode?: "popup"; nonce?: string }): void;
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
    // Every sign-in needs a one-time nonce that Google signs into the token, so a captured token cannot be replayed.
    // It is spent by each attempt, so after a try (good or bad) the button is re-armed with a fresh one.
    const arm = async () => {
      const n = await api<{ nonce: string }>("/api/auth/nonce");
      if (!live || !box.current || !window.google) return;
      if (!n.ok) return setState("blocked");
      window.google.accounts.id.initialize({
        client_id: CONFIG.googleClientId!,
        nonce: n.data.nonce,
        ux_mode: "popup",
        callback: (r) => {
          cb.current(r.credential);
          void arm();
        },
      });
      box.current.replaceChildren();
      window.google.accounts.id.renderButton(box.current, { theme: "outline", size: "large", shape: "pill", text: "continue_with", width: 300 });
      setState("ready");
    };
    loadGoogle()
      .then(arm)
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

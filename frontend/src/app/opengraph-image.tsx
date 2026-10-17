import { ImageResponse } from "next/og";

export const alt = "Misthos: get paid days after approval, not weeks";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** The link preview card. Plain shapes and system type, so it needs nothing fetched at build time. */
export default function Image() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: "#fafaf9", padding: 72, color: "#1c1917" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <svg width="56" height="56" viewBox="0 0 240 240"><rect width="240" height="240" rx="52" fill="#122b16" /><path d="M60 170L100 70H118L88 170H60Z" fill="#ffffff" /><path d="M180 170L140 70H122L152 170H180Z" fill="#ffffff" /><ellipse cx="120" cy="125" rx="12" ry="24" fill="none" stroke="#82de91" strokeWidth="8" /></svg>
          <div style={{ fontSize: 40, fontWeight: 700 }}>Misthos</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          <div style={{ fontSize: 84, fontWeight: 700, lineHeight: 1.02, letterSpacing: -3, maxWidth: 980 }}>Get paid days after approval, not weeks</div>
          <div style={{ fontSize: 32, color: "#6b6560", maxWidth: 900 }}>Two agents agree the price of waiting. Arc settles it in USDC in under a second.</div>
        </div>
        <div style={{ display: "flex", gap: 14, fontSize: 24, color: "#146c32" }}>
          <div style={{ padding: "8px 18px", borderRadius: 999, background: "#e6f7ea" }}>Live on Arc testnet</div>
          <div style={{ padding: "8px 18px", borderRadius: 999, background: "#f5f5f4", color: "#6b6560" }}>Open source</div>
        </div>
      </div>
    ),
    size,
  );
}

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
          <div style={{ width: 56, height: 56, borderRadius: 14, background: "#82de91", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg width="34" height="34" viewBox="0 0 24 24"><path d="M3 20V12a9 9 0 0 1 18 0v8h-5v-8a4 4 0 0 0-8 0v8H3Z" fill="#122b16" /></svg>
          </div>
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

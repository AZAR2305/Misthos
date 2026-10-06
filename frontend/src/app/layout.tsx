import type { Metadata, Viewport } from "next";
import "@fontsource/plus-jakarta-sans/400.css";
import "@fontsource/plus-jakarta-sans/500.css";
import "@fontsource/plus-jakarta-sans/600.css";
import "@fontsource/bricolage-grotesque/500.css";
import "@fontsource/bricolage-grotesque/600.css";
import "@fontsource/bricolage-grotesque/700.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "../../design/tokens.css";
import "../../design/themes.css";
import "./globals.css";
import "./landing.css";
import "./app.css";
import "./shell.css";
import { Providers } from "@/components/Providers";
import { NO_FLASH_SCRIPT } from "@/lib/themes";
import { SITE_URL } from "@/lib/site";

const DESCRIPTION =
  "Two businesses' agents agree the price of waiting on an approved invoice, often 0%. A contract on Arc enforces the signed terms and settles in USDC in under a second.";

export const metadata: Metadata = {
  ...(SITE_URL ? { metadataBase: new URL(SITE_URL) } : {}),
  title: { default: "Misthos: get paid days after approval, not weeks", template: "%s · Misthos" },
  description: DESCRIPTION,
  applicationName: "Misthos",
  openGraph: { type: "website", siteName: "Misthos", title: "Misthos: get paid days after approval, not weeks", description: DESCRIPTION },
  twitter: { card: "summary_large_image", title: "Misthos: get paid days after approval, not weeks", description: DESCRIPTION },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fafaf9" },
    { media: "(prefers-color-scheme: dark)", color: "#100f0e" },
  ],
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: NO_FLASH_SCRIPT }} />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

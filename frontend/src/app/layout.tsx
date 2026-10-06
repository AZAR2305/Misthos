import type { Metadata, Viewport } from "next";
import "@fontsource/dm-sans/400.css";
import "@fontsource/dm-sans/500.css";
import "@fontsource/dm-sans/600.css";
import "@fontsource/chakra-petch/400.css";
import "@fontsource/chakra-petch/500.css";
import "@fontsource/chakra-petch/600.css";
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

export const metadata: Metadata = {
  title: "Misthos: get paid days after approval, not weeks",
  description:
    "Two businesses' agents agree the price of waiting on an approved invoice, often 0%. A contract on Arc enforces the signed terms and settles in under a second.",
};

export const viewport: Viewport = {
  themeColor: "#000000",
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

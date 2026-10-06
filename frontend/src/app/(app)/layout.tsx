import type { ReactNode } from "react";
import { AppShell } from "@/components/app/AppShell";
import { ChainDataProvider } from "@/components/app/ChainData";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <ChainDataProvider>
      <AppShell>{children}</AppShell>
    </ChainDataProvider>
  );
}

import { createPublicClient, defineChain, http, type PublicClient } from "viem";
import { CONFIG } from "../config";

export const appChain = defineChain({
  id: CONFIG.chainId,
  name: CONFIG.networkName,
  // Arc uses USDC as the native gas token (18 decimals on the native side; the ERC-20 interface is 6).
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [CONFIG.rpcUrl] } },
  blockExplorers: { default: { name: "Arc Explorer", url: CONFIG.explorer } },
});

let client: PublicClient | undefined;
/** One shared read client for the whole app. */
export function publicClient(): PublicClient {
  client ??= createPublicClient({ chain: appChain, transport: http(CONFIG.rpcUrl) }) as PublicClient;
  return client;
}

/**
 * Public runtime configuration. Everything here is baked in at build time from NEXT_PUBLIC_* variables (see
 * frontend/.env.example). Nothing is hard-coded to a deployment: an unset address means "not deployed yet" and the pages
 * say so instead of inventing values (CLAUDE.md 0.5).
 */
type Address = `0x${string}`;

const addr = (v: string | undefined): Address | undefined => (v && /^0x[0-9a-fA-F]{40}$/.test(v) ? (v as Address) : undefined);

const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 5042002);

export const CONFIG = {
  chainId,
  networkName: chainId === 5042002 ? "Arc testnet" : chainId === 31337 ? "Local chain" : `Chain ${chainId}`,
  isTestnet: chainId !== 5042,
  rpcUrl: process.env.NEXT_PUBLIC_RPC_URL ?? "https://rpc.testnet.arc.io",
  explorer: process.env.NEXT_PUBLIC_EXPLORER_URL ?? "https://explorer.testnet.arc.io",
  usdc: (addr(process.env.NEXT_PUBLIC_USDC_ADDRESS) ?? "0x3600000000000000000000000000000000000000") as Address,
  book: addr(process.env.NEXT_PUBLIC_INVOICE_BOOK_ADDRESS),
  /** Block the contract was deployed in, so event scans do not start at genesis. */
  deployBlock: BigInt(process.env.NEXT_PUBLIC_DEPLOY_BLOCK ?? 0),
  /** Where a person's own agent can be reached. Empty unless set: a visitor's browser never probes an address nobody configured. */
  supplierAgentUrl: process.env.NEXT_PUBLIC_SUPPLIER_AGENT_URL ?? "",
  buyerAgentUrl: process.env.NEXT_PUBLIC_BUYER_AGENT_URL ?? "",
  supplierAgentAddress: addr(process.env.NEXT_PUBLIC_SUPPLIER_AGENT_ADDRESS),
  buyerAgentAddress: addr(process.env.NEXT_PUBLIC_BUYER_AGENT_ADDRESS),
  /** The Misthos backend (backend/README.md). Unset means no accounts: the app works with just a wallet, as before. */
  apiUrl: (process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/$/, "") || undefined,
  /** OAuth web client id for "Sign in with Google" (public by design). Unset shows "unavailable". */
  googleClientId: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || undefined,
  repoUrl: "https://github.com/AZAR2305/Misthos",
  faucetUrl: "https://faucet.circle.com",
} as const;

export const txUrl = (hash: string) => `${CONFIG.explorer}/tx/${hash}`;
export const addressUrl = (a: string) => `${CONFIG.explorer}/address/${a}`;

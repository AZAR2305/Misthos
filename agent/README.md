# agent

The two independent agents (supplier and buyer) and the library under them (CLAUDE.md sections 5.3, 5.6, 8, 9.2).

| Folder | What it is |
|---|---|
| `src/core` | Pure, no I/O: bigint money, pricing, ladder, buyer policy, cash-path allocator, hash-chained decision log, EIP-712 payloads |
| `src/protocol` | Strict zod message schemas and signed accept, reject and withdraw messages |
| `src/wallets` | `WalletAdapter`, typed errors, `CircleCliAdapter` (Circle Agent Wallet through the Circle CLI) |
| `src/agents` | Supplier agent, buyer agent, the `AgentModel` interface (fails closed), decision store, chain reads |
| `src/runners` | The two processes and their HTTP routes (`pnpm supplier`, `pnpm buyer`) |
| `src/doctor.ts` | `pnpm doctor`: checks the real CLI, login, Arc RPC, USDC, contract, wallets, model key |

```bash
pnpm --filter @misthos/agent test        # 70 tests: Appendix B fixtures, protocol, negotiation, fail-closed paths, HTTP layer
pnpm --filter @misthos/agent doctor      # what is missing before the agents can run
```

Setup (steps only you can do, with the websites and commands): see docs/SETUP.md. In short: accept the Circle CLI terms (`circle wallet status` once, interactively),
your email OTP (`circle wallet login you@example.com --testnet`), copy the two agent wallet addresses into `.env`
(`circle wallet list --chain ARC-TESTNET --type agent`), fund them at https://faucet.circle.com, deploy the contract
(`contract/README.md`), and set `ANTHROPIC_API_KEY`. Copy `.env.example` to `.env`.

The model proposes; code decides. No model output reaches a signer or a contract call. With the model, the wallet or
the RPC unavailable, an agent takes no autonomous action and marks the item `needs_approval` with a reason code.

"use client";

import { Card, CodeBlock, Notice, PageHeader, AddressChip } from "@/components/ui/kit";
import { CONFIG } from "@/lib/config";

const ROOT = CONFIG.repoUrl;

export default function Kit() {
  return (
    <>
      <PageHeader
        title="Developer kit"
        lead="Run the whole thing yourself in ten minutes: the contract, the agents, and this site. Open source, MIT licensed, testnet only."
        actions={<a className="btn btn-ghost" href={ROOT} target="_blank" rel="noreferrer">Source on GitHub</a>}
        help={<p>Everything here is copy and paste. If a command fails, the doctor tells you what is missing: <span className="inline-code">pnpm --filter @misthos/agent doctor</span>. Nothing in the kit is simulated: it runs against a real chain, either Arc testnet or a local test chain on your machine.</p>}
      />

      <Card title="What is in the kit">
        <ul className="checklist">
          {[
            ["InvoiceBook", "The contract: verifies signed invoices and offers, enforces caps and the 50% rate ceiling, settles once. 40 tests."],
            ["Agent core", "Pure math in plain TypeScript: pricing, the offer ladder, the cash-aware allocator, the decision log. Tested on fixed examples."],
            ["Wallet adapter", "Signs and sends through a Circle Agent Wallet with the Circle CLI. Fails loudly and never falls back to another wallet."],
            ["Two agents", "Supplier and buyer, as separate processes talking over signed HTTP messages."],
            ["This app", "Invoices, offers, payments, ledger and live stats. It reads the chain directly."],
          ].map(([n, d]) => (
            <li key={n}><span className="check" data-done="true" aria-hidden="true">✓</span><span><b>{n}.</b> <span className="muted">{d}</span></span></li>
          ))}
        </ul>
      </Card>

      <div className="grid-2">
        <Card title="1. Get the code and run the tests">
          <CodeBlock>{`git clone ${ROOT}.git
cd Misthos
pnpm install
cd contract
forge install OpenZeppelin/openzeppelin-contracts foundry-rs/forge-std --no-git
forge test`}</CodeBlock>
          <p className="muted tiny">Needs Node 20+, pnpm and Foundry.</p>
        </Card>
        <Card title="2. Try it on a local test chain">
          <p className="muted">No wallet extension logins, no faucet. A local chain with funded test accounts, the contract and a test USDC deployed for you.</p>
          <CodeBlock>{`anvil                                   # terminal 1: a local chain
cd contract                             # terminal 2
forge script script/DeployLocal.s.sol --rpc-url http://127.0.0.1:8545 --broadcast`}</CodeBlock>
          <p className="muted tiny">It prints the addresses. Put them in <span className="inline-code">frontend/.env.local</span> (see <span className="inline-code">frontend/.env.example</span>), run <span className="inline-code">pnpm dev</span>, and add the local network to your wallet: RPC http://127.0.0.1:8545, chain id 31337.</p>
        </Card>
      </div>

      <Card title="3. Run it on Arc testnet">
        <p className="muted">You need two Circle Agent Wallets (supplier and buyer), test USDC, a deployed contract and a model key. The full walk-through, with every website and command:</p>
        <a className="btn btn-primary" href={`${ROOT}/blob/main/docs/SETUP.md`} target="_blank" rel="noreferrer">Open docs/SETUP.md</a>
        <CodeBlock>{`# connect an agent wallet (email code). Use a separate folder per agent.
CIRCLE_CLI_HOME=~/.misthos/circle-supplier pnpm --filter @misthos/agent exec circle wallet login you@example.com --testnet
pnpm --filter @misthos/agent exec circle wallet list --chain ARC-TESTNET --type agent

pnpm --filter @misthos/agent doctor     # shows exactly what is still missing
pnpm --filter @misthos/agent buyer      # then, in another terminal:
pnpm --filter @misthos/agent supplier`}</CodeBlock>
      </Card>

      <div className="grid-2">
        <Card title="The contract">
          <dl className="kv">
            <div><dt>Network</dt><dd>{CONFIG.networkName} (chain id {CONFIG.chainId})</dd></div>
            <div><dt>InvoiceBook</dt><dd>{CONFIG.book ? <AddressChip address={CONFIG.book} /> : <span className="muted">unavailable: not deployed yet</span>}</dd></div>
            <div><dt>USDC (ERC-20)</dt><dd><AddressChip address={CONFIG.usdc} /></dd></div>
            <div><dt>Source</dt><dd><a className="link" href={`${ROOT}/blob/main/contract/src/InvoiceBook.sol`} target="_blank" rel="noreferrer">InvoiceBook.sol</a></dd></div>
          </dl>
          <p className="muted tiny">Signatures use EIP-712 (domain “Misthos”, version 1). EOAs and contract wallets (ERC-1271) both verify.</p>
          <CodeBlock>{`Invoice(address supplier,address buyer,address token,
        uint256 amount,uint64 dueDate,bytes32 refHash,uint256 nonce)
EarlyPayOffer(bytes32 invoiceId,uint16 rateBps,
              uint64 expiry,uint256 nonce)`}</CodeBlock>
        </Card>
        <Card title="Use it from Claude">
          <Notice kind="info" title="The MCP server is not built yet">
            It is planned: it would let you ask Claude “what should we pay early this week?” and get the allocator&apos;s answer, with every write needing an explicit confirm. Until then, the buyer agent&apos;s <span className="inline-code">POST /plan</span> returns the same answer.
          </Notice>
        </Card>
      </div>

      <Card title="Honest limits">
        <ul className="checklist">
          {[
            "Testnet only, and the contract is unaudited. Do not use real funds.",
            "Paying early from your own cash is not a loan, but rules vary by country. This is not legal advice.",
            "Circle Agent Wallet spending policies exist only on mainnet, so the caps live in our contract.",
            "Reputation (ERC-8004) and claim links need the server and registry work that is not built yet.",
            "The mechanism, dynamic discounting, is old. What is new here is two independent agents, a cash-aware allocator, and signed offers enforced on chain.",
          ].map((t) => <li key={t}><span className="check" aria-hidden="true" /><span className="muted">{t}</span></li>)}
        </ul>
      </Card>
    </>
  );
}

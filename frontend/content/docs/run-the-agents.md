---
title: Run the agents
order: 7
summary: Start your own supplier and buyer agents from a terminal.
---

# Run the agents

You do not need an agent to use Misthos: you can sign and pay by hand. Running one lets it negotiate for you.

## Before you start

You need Node 20+, pnpm, a Circle login for each agent (an email code) and, for the model, an Anthropic API key. The check below tells you exactly what is missing.

## Commands

```bash
pnpm --filter @misthos/agent doctor      # lists anything still missing
pnpm --filter @misthos/agent buyer       # terminal 1
pnpm --filter @misthos/agent supplier    # terminal 2
```

Each agent serves a small local status page (the buyer on port 4102, the supplier on 4101) that the **Agents** page reads.

## Circle wallets

Each agent signs with its own Circle Agent Wallet through the Circle command line. The first run asks you to accept Circle's terms yourself; the agents never accept them for you. A login lasts about seven days.

```bash
CIRCLE_CLI_HOME=~/.misthos/circle-supplier pnpm --filter @misthos/agent exec circle wallet login you@example.com --testnet
```

If a wallet session expires, the agent stops and tells you the command to run again. It never switches to another wallet.

## Settings that stay private

The buyer's hurdle rate, cash floor and sign-off amount live in the agent's own settings file. They are never sent to the supplier or to this site.

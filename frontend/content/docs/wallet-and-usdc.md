---
title: Wallet and USDC
order: 5
summary: Which wallet to use, where your USDC balance comes from, and the testnet faucet.
---

# Wallet and USDC

## Your wallet

Misthos works with any browser wallet (MetaMask, Rabby, Coinbase Wallet and others). It never holds your keys. When you connect, the site shows the wallet's address and its **USDC balance** at the top right and on the Overview page. The balance is read from the chain every few seconds, so it is always the real figure.

## USDC on Arc

Invoices settle in **USDC**. On Arc, USDC is also the currency for network fees, so a small balance covers both. Amounts have six decimal places.

## Test USDC

On the test network the USDC is free: get some from the [Circle faucet](https://faucet.circle.com), choose Arc Testnet and paste your address. It can take a minute to arrive.

## Wrong network?

If your wallet is on a different network, the header shows a warning with a **Switch** button. Signing and paying only work on the network the site uses.

## Signing in with your wallet

When the site has accounts turned on, you sign in by signing a short message with your wallet. That message sends no transaction and costs nothing. Your wallet address is your account: there is no email, no password and no outside login service, and the site stores your address and nothing else. The flip side is that there is no recovery. If you lose the wallet, you lose the account, so keep a seed backup or use a hardware wallet.

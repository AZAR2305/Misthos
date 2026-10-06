---
title: The agents
order: 4
summary: What an agent can decide, what it cannot, and the reason codes.
---

# The agents

Each business runs its own agent: a separate program with its own wallet. They never share memory. They talk only through signed messages and the chain.

## The model proposes, code decides

An AI model may suggest where to start an ask or what to flag. It can **never** sign, send or pay. Plain code checks every number, and the contract has the final say. If the model, the wallet or the network fails, the agent does nothing and waits for a person.

## What each one holds privately

- The **supplier agent** knows what waiting costs and where it will stop.
- The **buyer agent** knows its hurdle rate and its cash plan. A rejection carries a reason code, never the number.

## Reason codes

| Code | Meaning |
|---|---|
| `BELOW_HURDLE` | The offer is under the buyer's private minimum. |
| `LIQUIDITY_FLOOR` | Paying would take the buyer under its cash floor. |
| `NOT_ELIGIBLE` | The invoice is not approved, is already due, or breaks a cap. |
| `NEEDS_HUMAN_APPROVAL` | The amount is above what the buyer signs off personally. |
| `EXPIRED` | The offer ran out of time. |
| `DISPUTED` | The buyer disputed the invoice. |
| `REPUTATION_FLAG` | A record of past behaviour blocks early payment. |

## Run them yourself

See [Run the agents](/docs/run-the-agents). The animated agents on the site are an illustration of this protocol; they show no live data.

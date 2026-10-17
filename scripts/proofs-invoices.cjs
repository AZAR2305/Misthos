// Verifies every invoice transaction (from the backend's chain index) and the contract deployments, against two Arc RPCs.
const { createRequire } = require("module");
const req = createRequire(require("path").join(__dirname, "../agent/package.json"));
const { createPublicClient, http } = req("viem");
const fs = require("fs");
const cs = [createPublicClient({ transport: http("https://rpc.blockdaemon.testnet.arc.io") }), createPublicClient({ transport: http("https://rpc.testnet.arc.io") })];
const receipt = async (hash) => { for (const cl of [...cs, ...cs]) { try { return await cl.getTransactionReceipt({ hash }); } catch {} await new Promise((r) => setTimeout(r, 1200)); } return { status: "unverified" }; };
(async () => {
  const r = await fetch("http://127.0.0.1:4000/api/invoices?limit=200");
  const items = (await r.json()).data.items.reverse();
  const inv = [];
  for (const i of items) {
    const row = { id: i.id, amount: i.amount, status: i.status, rateBps: i.settled?.rateBps ?? null, txs: {} };
    for (const [k, tx] of [["registered", i.registered?.tx], ["approved", i.approved?.tx], ["settled", i.settled?.tx]]) if (tx) row.txs[k] = { hash: tx, status: (await receipt(tx)).status };
    inv.push(row);
  }
  const deploys = {};
  for (const [k, tx] of [["InvoiceBook", "0x2d0204bca37f6c07420d02e8e5912a782b90a679cd00279b4a9516aeddad99ce"], ["RoleRegistry", "0x9769ea74eb2a53c8b42142b5555f50b7874e98dd4c5537653ac9e5f95ee8ee75"], ["InvoiceBook v1 (superseded)", "0xdcfb3799e99a3611d486765d7e45935ca2761f57bc4ae2d5218331c7e9ddbf72"]]) {
    const rc = await receipt(tx);
    deploys[k] = { tx, status: rc.status, contract: rc.contractAddress ?? null, block: rc.blockNumber?.toString() };
  }
  fs.writeFileSync(__dirname + "/proofs-invoices.json", JSON.stringify({ inv, deploys }, null, 1));
  const bad = inv.flatMap((i) => Object.values(i.txs)).filter((t) => t.status !== "success");
  console.log("invoices", inv.length, "txs checked", inv.reduce((n, i) => n + Object.keys(i.txs).length, 0), "not success", bad.length);
  console.log(JSON.stringify(deploys));
})().catch((e) => console.error("FAILED", e.message.slice(0, 300)));

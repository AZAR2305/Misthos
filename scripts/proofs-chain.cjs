// Collects and verifies every on-chain fact the README cites. Reads only.
const { createRequire } = require("module");
const req = createRequire(require("path").join(__dirname, "../agent/package.json"));
const { createPublicClient, http, parseAbiItem } = req("viem");
const fs = require("fs");
const c = createPublicClient({ transport: http("https://rpc.blockdaemon.testnet.arc.io") });
const c2 = createPublicClient({ transport: http("https://rpc.testnet.arc.io") });
const receipt = async (hash) => { for (const cl of [c, c2, c]) { try { return await cl.getTransactionReceipt({ hash }); } catch {} await new Promise((r) => setTimeout(r, 1500)); } return { status: "unverified" }; };
const REG = "0x54C789EcA2d40ef902CF792077622AA7B5a901dC";
const ID = "0x8004A818BFB912233c491871b3d84c89A494BD9e";
const REP = "0x8004B663056A597Dffe9eCcC1965A193B7388713";
const SUP = "0x6afd3cac8e4ac3d15388b58ac999481c96ffdf6f";
const BUY = "0x156af8e7298fc862c54b8d72b2b232770ceefa15";

async function logsChunked(params, from, to) {
  const out = [];
  for (let a = from; a <= to; a += 9000n) {
    const b = a + 8999n > to ? to : a + 8999n;
    out.push(...(await c.getLogs({ ...params, fromBlock: a, toBlock: b })));
  }
  return out;
}

(async () => {
  const head = await c.getBlockNumber();
  const roles = await logsChunked({ address: REG, event: parseAbiItem("event RoleChosen(address indexed account, uint8 role, bool sponsored)") }, 67192949n, head);
  // ERC-8004: any log on the identity / reputation registries that names our agent wallets or ids, from the first agent run
  const idLogs = await logsChunked({ address: ID }, 67160000n, head).catch((e) => (console.error("id logs", e.message.slice(0, 80)), []));
  const repLogs = await logsChunked({ address: REP }, 67160000n, head).catch((e) => (console.error("rep logs", e.message.slice(0, 80)), []));
  const mine = (l) => l.topics.some((t) => t && (t.toLowerCase().endsWith(SUP.slice(2)) || t.toLowerCase().endsWith(BUY.slice(2)) || BigInt(t) === 897306n || BigInt(t) === 897307n));
  const ours = [...idLogs.filter(mine), ...repLogs.filter(mine)];
  const txs = new Map();
  for (const l of roles) txs.set(l.transactionHash, { kind: "role", account: l.args.account, role: Number(l.args.role) === 1 ? "supplier" : "buyer", sponsored: l.args.sponsored, block: l.blockNumber });
  for (const l of ours) if (!txs.has(l.transactionHash)) txs.set(l.transactionHash, { kind: l.address.toLowerCase() === ID.toLowerCase() ? "erc8004-identity" : "erc8004-feedback", block: l.blockNumber });
  const out = [];
  for (const [hash, info] of txs) {
    const r = await receipt(hash);
    out.push({ hash, status: r.status, ...info, block: info.block.toString() });
  }
  fs.writeFileSync(__dirname + "/proofs-chain.json", JSON.stringify(out, null, 1));
  console.log("roles", roles.length, "erc8004 logs", ours.length, "head", head.toString());
  for (const o of out) console.log(o.kind, o.status, o.hash.slice(0, 12), o.account ?? "", o.role ?? "");
})().catch((e) => console.error("FAILED", e.message.slice(0, 300)));

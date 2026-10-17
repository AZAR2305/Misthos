# Proofs

Every on-chain fact the README cites, checked against Arc testnet (chain id 5042002) on 18 Oct 2026.
Each transaction's receipt was read from two RPC endpoints (`rpc.blockdaemon.testnet.arc.io`, `rpc.testnet.arc.io`); all 46 returned `success`.
Re-run: `node scripts/proofs-chain.cjs` (reads Arc) and `node scripts/proofs-invoices.cjs` (reads Arc and the local backend index on :4000). Both are read-only.

**Origin label:** all of this activity was run by the team (our own agents and wallets). It is not independent traction. See `docs/TRACTION.md`.

## Contract deployments

| Contract | Address | Transaction | Status |
|---|---|---|---|
| InvoiceBook | [`0x108da05fec74a1c0620cf7d66d07aeb586a5288c`](https://explorer.testnet.arc.io/address/0x108da05fec74a1c0620cf7d66d07aeb586a5288c) | [`0x2d0204bc…99ce`](https://explorer.testnet.arc.io/tx/0x2d0204bca37f6c07420d02e8e5912a782b90a679cd00279b4a9516aeddad99ce) · block 67164103 | ✅ |
| RoleRegistry | [`0x54c789eca2d40ef902cf792077622aa7b5a901dc`](https://explorer.testnet.arc.io/address/0x54c789eca2d40ef902cf792077622aa7b5a901dc) | [`0x9769ea74…ee75`](https://explorer.testnet.arc.io/tx/0x9769ea74eb2a53c8b42142b5555f50b7874e98dd4c5537653ac9e5f95ee8ee75) · block 67192949 | ✅ |
| InvoiceBook v1 (superseded) | [`0xd62b53a4d3a7cc56467f75cda8da246ea2ab35ed`](https://explorer.testnet.arc.io/address/0xd62b53a4d3a7cc56467f75cda8da246ea2ab35ed) | [`0xdcfb3799…bf72`](https://explorer.testnet.arc.io/tx/0xdcfb3799e99a3611d486765d7e45935ca2761f57bc4ae2d5218331c7e9ddbf72) · block 67148962 | ✅ |

## Invoices (9)

| Invoice id | USDC | Result | Registered | Approved | Settled |
|---|---|---|---|---|---|
| `0xc0a324c94cf35ad69e4673395cfd261dbaeceb826e155dafeac106b8bb1667e7` | 25.00 | paid early at 2.00% | [`0x5a587ee1…6af3`](https://explorer.testnet.arc.io/tx/0x5a587ee1607d2b5df2a895fea9f4c2d59905be3b733c62a7ec420cd441ff6af3) ✅ | [`0xd9b56b5f…a3e6`](https://explorer.testnet.arc.io/tx/0xd9b56b5f74bd12e37cc717f930ed389cb046180c2d6b028e6fae50a036a5a3e6) ✅ | [`0x8d581c6a…c8a1`](https://explorer.testnet.arc.io/tx/0x8d581c6a48fcb14892ea647405a9370d274d80dfb9e9f7459241da1bee3ec8a1) ✅ |
| `0x7b1fca0a6e616db1d330ab5006b1c0e5ef91e0898eb5a67602313c1507908681` | 40.00 | paid early at 0.00% | [`0xfcd91b74…d4b2`](https://explorer.testnet.arc.io/tx/0xfcd91b745dbaaae5adc7cd4cf7bb4a549c59043ff5ff33e0954376766a57d4b2) ✅ | [`0x689d375d…90d3`](https://explorer.testnet.arc.io/tx/0x689d375d1ba7ac8da030b152142437f7be12dd6eabc76784db8e6552df2990d3) ✅ | [`0x7f0e6735…8119`](https://explorer.testnet.arc.io/tx/0x7f0e67359180504dd7b00455fc85c542d43b7389536bfdb456c313f9df0c8119) ✅ |
| `0x50694ca4521e74797dc9515cb83c5ab45ad1f8157a789b02e33306045c4824e4` | 5.00 | paid early at 0.00% | [`0x0e8dbe12…3942`](https://explorer.testnet.arc.io/tx/0x0e8dbe12c8cea39fa10f7faa406f37c53f76e74cc71844083012ae1dffb73942) ✅ | [`0x28553e98…7554`](https://explorer.testnet.arc.io/tx/0x28553e98c7cbadcdbec4c58770908b35bca90f0d94d7dc7fb67366b5eddb7554) ✅ | [`0x7541b1c9…48e0`](https://explorer.testnet.arc.io/tx/0x7541b1c911edc89a7d84c859619aa4a7c2df49579541a3269a3dc748648748e0) ✅ |
| `0x120edd9f7935e56ae0a6ef064e7a1cb2f5a0231e6f94a1aa8fac8837f603845f` | 5.00 | paid early at 0.00% | [`0x41deec13…2fda`](https://explorer.testnet.arc.io/tx/0x41deec1327b767f05c3569047cb5407f596eb1eb6ceba5ff811436ec70022fda) ✅ | [`0xde55fcd8…6e5f`](https://explorer.testnet.arc.io/tx/0xde55fcd8b0b1fa180bea75a02c5f4b6ecf2a01ba5a0ddbdbdc30d5255bce6e5f) ✅ | [`0xf2304a1d…d13a`](https://explorer.testnet.arc.io/tx/0xf2304a1dcfdbc1d774530a69d8b6dcef8c85d1bfd64187e9165d797dedefd13a) ✅ |
| `0x02e86fd188f13c25e690cbfae6fe41317cc3194531b9a3919305e80ed0bc25b2` | 5.00 | paid early at 0.00% | [`0x1cc59094…14a4`](https://explorer.testnet.arc.io/tx/0x1cc59094c2011ded5375b8863db2bbfd8b02f0beffb1b22cb4d4647ede5014a4) ✅ | [`0xe5fccf03…5d36`](https://explorer.testnet.arc.io/tx/0xe5fccf03544be14293f3321aa5b13cee6cb67f1f75d7b9a68539a89b69625d36) ✅ | [`0x6a74a2ac…97ce`](https://explorer.testnet.arc.io/tx/0x6a74a2ac7f6c1a092ff151da9f871e2cb9284fa653cedfd207b2fb08523197ce) ✅ |
| `0x0fcc4980c5fae68ec6f1195a2054162d770b09c8b6207c6d3ad155ba1e899a7d` | 5.00 | paid early at 0.00% | [`0xf7595ddb…8f67`](https://explorer.testnet.arc.io/tx/0xf7595ddba8e086b0e2f8f9e5d5cb2ae0c4dd9eede19382f9e600643811298f67) ✅ | [`0xfadd4963…422b`](https://explorer.testnet.arc.io/tx/0xfadd496321828f59d5d99e74cf2f2d2d017202778f167051bcdfe7b726a1422b) ✅ | [`0x018260a3…5b27`](https://explorer.testnet.arc.io/tx/0x018260a33832ece6068ac15f28c06ca77b4d2976a14ed8db0e5168229c035b27) ✅ |
| `0x4d09110c8e8508521c5f6c1dac32ea65865f7b8670d6e732ee54d473c46613cd` | 5.00 | paid early at 0.00% | [`0x72ab5eab…933f`](https://explorer.testnet.arc.io/tx/0x72ab5eab0bd1056deb9127184d2323cafc25731a2296259a24ddcef4c86b933f) ✅ | [`0xa678cc0a…d797`](https://explorer.testnet.arc.io/tx/0xa678cc0ad8b67b5c38dc7d4062d9f7a83c79ea066e1bcc2afdbf4d4fd374d797) ✅ | [`0x8f3979ab…e7e1`](https://explorer.testnet.arc.io/tx/0x8f3979ab6f3ba079d63e667c48db6b79c93f059d5d2d0e36a07ebdfdbf6ce7e1) ✅ |
| `0xce40141592cc7de4a57107746bbba735e0f744b7761cd6ab3397b2443c83fa11` | 5.00 | approved | [`0x76a176a7…d5be`](https://explorer.testnet.arc.io/tx/0x76a176a76fa76700f053de9876bb083a9485c5321f2c675467f9b54f3a4ad5be) ✅ | [`0xd2f6e06c…4036`](https://explorer.testnet.arc.io/tx/0xd2f6e06c94ad226079c4569b8be7f02581228dcc58926ec536109d20ddce4036) ✅ | – |
| `0xe67d3108da398221f6ae98fd8156a4bfe0571b8bf8eca1d9e8d3ee08dce693c5` | 5.00 | paid early at 0.00% | [`0xa56f7287…ea1b`](https://explorer.testnet.arc.io/tx/0xa56f7287d8fd7030e7bab1ed9bfa028e2cf8eac5be0d1e816fdd24730d3cea1b) ✅ | [`0xb8a99a37…fc87`](https://explorer.testnet.arc.io/tx/0xb8a99a37536bfbea06a8f3dd8f146e36137deb3806935a42c8bb0cb92919fc87) ✅ | [`0x2ffadfdc…d403`](https://explorer.testnet.arc.io/tx/0x2ffadfdcc03f0ff20f1a0c4625b6f53c0eb8f8cf21bf84a15d6199c5808bd403) ✅ |

Totals: 8 paid early, 7 at 0%, 95.00 test USDC.

## Role registrations (5)

| Wallet | Address | Role | Transaction | Block | Status |
|---|---|---|---|---|---|
| Supplier agent (Circle Agent Wallet) | [`0x6Afd3CAC8e4aC3D15388b58Ac999481c96FfdF6f`](https://explorer.testnet.arc.io/address/0x6Afd3CAC8e4aC3D15388b58Ac999481c96FfdF6f) | supplier | [`0x2c4e7370…4fce`](https://explorer.testnet.arc.io/tx/0x2c4e7370dbd8f0816a724baa3795baa6d611b50b8af65d8bfc1588f5e7194fce) | 67193716 | ✅ |
| Buyer agent (Circle Agent Wallet) | [`0x156AF8E7298fc862C54B8D72b2b232770ceEFA15`](https://explorer.testnet.arc.io/address/0x156AF8E7298fc862C54B8D72b2b232770ceEFA15) | buyer | [`0x94f96ae3…4d05`](https://explorer.testnet.arc.io/tx/0x94f96ae377810a66653e69eae1193c7c095d052c61b02389c2b1f9b49b6e4d05) | 67193739 | ✅ |
| Supplier owner wallet (team test wallet) | [`0xC4Ff3f0dC60c5f3a9bab7582Ce862D8c84bB81E7`](https://explorer.testnet.arc.io/address/0xC4Ff3f0dC60c5f3a9bab7582Ce862D8c84bB81E7) | supplier | [`0x2c3ecccf…d5ae`](https://explorer.testnet.arc.io/tx/0x2c3ecccfa4cb7794272808feb544343a700cf9401b77c774819b14d4d120d5ae) | 67713261 | ✅ |
| Buyer owner wallet (team test wallet) | [`0x057106d6bD43a3c7a03fB07E2049b64Ba7e0776a`](https://explorer.testnet.arc.io/address/0x057106d6bD43a3c7a03fB07E2049b64Ba7e0776a) | buyer | [`0xcab56be4…bd02`](https://explorer.testnet.arc.io/tx/0xcab56be41ff0c5e084a44278735d7559be9fdce293eefb15ebf616cd5e3abd02) | 67714012 | ✅ |
| Owner's MetaMask (registered live in the demo) | [`0xA50050DBDBe672a5F0261e403909bCB8590B9130`](https://explorer.testnet.arc.io/address/0xA50050DBDBe672a5F0261e403909bCB8590B9130) | supplier | [`0xfb8d9c7e…2ed7`](https://explorer.testnet.arc.io/tx/0xfb8d9c7ef63b347d9046b1a4cc57c78dc5d3ebd4aa1fad9c9d970ac569352ed7) | 67724392 | ✅ |

## ERC-8004 (12)

| Kind | Transaction | Block | Status |
|---|---|---|---|
| Identity registration | [`0x8571bde2…87bd`](https://explorer.testnet.arc.io/tx/0x8571bde25695d50039e27c297238f17e363923096d2ea0a93f3b89d084ce87bd) | 67168028 | ✅ |
| Identity registration | [`0x2ab0542e…476c`](https://explorer.testnet.arc.io/tx/0x2ab0542eb6284dbb9967438f933ff288e98e224d249cedf030090d77073f476c) | 67168050 | ✅ |
| Rating after a settlement | [`0xa5484ec8…d8eb`](https://explorer.testnet.arc.io/tx/0xa5484ec832b4940dd00bc7380429bb90271ae478d8204fc74dccb9be25a4d8eb) | 67168071 | ✅ |
| Rating after a settlement | [`0x20f0f339…ed9c`](https://explorer.testnet.arc.io/tx/0x20f0f339304b6bfc2666196170f8222fc48faa582e39e6322e7110bdaf25ed9c) | 67168091 | ✅ |
| Rating after a settlement | [`0x5d74a9ac…9b2b`](https://explorer.testnet.arc.io/tx/0x5d74a9ac0e45915389428d21870d652a07652a01cecd7af1bbd9b59e7b4b9b2b) | 67168112 | ✅ |
| Rating after a settlement | [`0x1e68ca4d…cf3f`](https://explorer.testnet.arc.io/tx/0x1e68ca4ddfe9f8fdd4c6e645cbac0014e3c7999df32f1850f1cc6b6cf40fcf3f) | 67168132 | ✅ |
| Rating after a settlement | [`0x26d66d84…a3d9`](https://explorer.testnet.arc.io/tx/0x26d66d847d4bb46bb9daddb75d10a942ffd772d266c56eb2f7e256da6feea3d9) | 67714486 | ✅ |
| Rating after a settlement | [`0x26569524…7ee3`](https://explorer.testnet.arc.io/tx/0x265695241a3a70f69fcb1a50f8c372986bcc58558751a4f98cf215a11e327ee3) | 67715567 | ✅ |
| Rating after a settlement | [`0x509166f9…1cb1`](https://explorer.testnet.arc.io/tx/0x509166f965a25f8af8e0fa6d372edd8dfa6335fdf2af6d30511161211cb81cb1) | 67716455 | ✅ |
| Rating after a settlement | [`0x99e921bb…4231`](https://explorer.testnet.arc.io/tx/0x99e921bb77f7da5e2e00b55e8d90a44aa0ee263ef3e553e5f03d1a65a00d4231) | 67717352 | ✅ |
| Rating after a settlement | [`0x677209f3…5453`](https://explorer.testnet.arc.io/tx/0x677209f38ee068b5ceec2dada373c72d3948a1e016549e183c33d4a1b86a5453) | 67719007 | ✅ |
| Rating after a settlement | [`0xd52f45fd…a2bd`](https://explorer.testnet.arc.io/tx/0xd52f45fd8178daac173ddcae73da3f5d9405852e614492584089392e7938a2bd) | 67732511 | ✅ |

Supplier agent id 897306, buyer agent id 897307, on the identity registry [`0x8004A818BFB912233c491871b3d84c89A494BD9e`](https://explorer.testnet.arc.io/address/0x8004A818BFB912233c491871b3d84c89A494BD9e); ratings on [`0x8004B663056A597Dffe9eCcC1965A193B7388713`](https://explorer.testnet.arc.io/address/0x8004B663056A597Dffe9eCcC1965A193B7388713).

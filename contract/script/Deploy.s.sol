// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {VmSafe} from "forge-std/Vm.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {InvoiceBook} from "../src/InvoiceBook.sol";

/// @notice Deploys InvoiceBook (CLAUDE.md 7.7).
///   forge script script/Deploy.s.sol --rpc-url arc_testnet --broadcast
/// Reads contract/.env: DEPLOYER_PRIVATE_KEY (required), USDC_ADDRESS, OWNER, FEE_RECIPIENT, CONFIRM_MAINNET.
/// Refuses Arc mainnet unless CONFIRM_MAINNET=1. After a broadcast, copy the address into DEPLOYMENTS.md and the
/// repo-level .env files (INVOICE_BOOK_ADDRESS). On a real broadcast the script also writes deployments/<chainId>.json.
contract Deploy is Script {
    uint256 internal constant ARC_TESTNET = 5042002;
    uint256 internal constant ARC_MAINNET = 5042; // docs.arc.io/arc/references/connect-to-arc (VERIFY before any mainnet run)
    uint256 internal constant LOCAL = 31337;
    address internal constant ARC_USDC = 0x3600000000000000000000000000000000000000;

    function run() external returns (InvoiceBook book) {
        if (block.chainid == ARC_MAINNET) {
            require(vm.envOr("CONFIRM_MAINNET", uint256(0)) == 1, "Arc mainnet: set CONFIRM_MAINNET=1 to deploy");
        } else {
            require(block.chainid == ARC_TESTNET || block.chainid == LOCAL, "unsupported chain id");
        }

        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(pk);
        address usdc = vm.envOr("USDC_ADDRESS", ARC_USDC);
        address owner = vm.envOr("OWNER", deployer);
        address feeRecipient = vm.envOr("FEE_RECIPIENT", owner);

        if (block.chainid != LOCAL) {
            require(usdc.code.length > 0, "USDC_ADDRESS has no code on this chain");
            require(IERC20Metadata(usdc).decimals() == 6, "USDC ERC-20 interface must be 6 decimals");
        }

        vm.startBroadcast(pk);
        book = new InvoiceBook(owner, usdc, feeRecipient);
        vm.stopBroadcast();

        console2.log("InvoiceBook deployed at", address(book));
        console2.log("chain id", block.chainid);
        console2.log("owner", owner);
        console2.log("fee recipient", feeRecipient);
        console2.log("USDC", usdc);

        // Only record real broadcasts; a dry run must not leave a deployment record for a contract that does not exist.
        if (!vm.isContext(VmSafe.ForgeContext.ScriptBroadcast)) return book;

        string memory json = string.concat(
            '{"chainId":',
            vm.toString(block.chainid),
            ',"invoiceBook":"',
            vm.toString(address(book)),
            '","usdc":"',
            vm.toString(usdc),
            '","owner":"',
            vm.toString(owner),
            '","feeRecipient":"',
            vm.toString(feeRecipient),
            '"}'
        );
        vm.writeFile(string.concat("deployments/", vm.toString(block.chainid), ".json"), json);
    }
}

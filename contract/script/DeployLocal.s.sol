// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {InvoiceBook} from "../src/InvoiceBook.sol";
import {TestUSDC} from "../test/utils/TestUSDC.sol";
import {VmSafe} from "forge-std/Vm.sol";

/// @notice Local development only: deploys a 6-decimal test USDC and InvoiceBook to an Anvil chain (id 31337) and funds the
/// first ten Anvil accounts with test USDC, so the app can be tried end to end on a laptop with no faucet and no wallet login.
///   anvil
///   forge script script/DeployLocal.s.sol --rpc-url http://127.0.0.1:8545 --broadcast
/// It refuses any other chain. Nothing here touches Arc, and nothing it creates is used outside local runs.
contract DeployLocal is Script {
    string internal constant ANVIL_MNEMONIC = "test test test test test test test test test test test junk";

    function run() external {
        require(block.chainid == 31337, "DeployLocal is for the local Anvil chain only");
        uint256 deployerKey = vm.deriveKey(ANVIL_MNEMONIC, 0);
        address deployer = vm.addr(deployerKey);

        vm.startBroadcast(deployerKey);
        TestUSDC usdc = new TestUSDC();
        InvoiceBook book = new InvoiceBook(deployer, address(usdc), deployer);
        for (uint32 i = 0; i < 10; i++) {
            usdc.mint(vm.addr(vm.deriveKey(ANVIL_MNEMONIC, i)), 1_000_000e6);
        }
        vm.stopBroadcast();

        console2.log("InvoiceBook", address(book));
        console2.log("USDC (test)", address(usdc));
        console2.log("deploy block", block.number);
        string memory json = string.concat(
            '{"chainId":31337,"invoiceBook":"',
            vm.toString(address(book)),
            '","usdc":"',
            vm.toString(address(usdc)),
            '","deployBlock":',
            vm.toString(block.number),
            "}"
        );
        if (vm.isContext(VmSafe.ForgeContext.ScriptBroadcast)) vm.writeFile("deployments/31337.json", json);
    }
}

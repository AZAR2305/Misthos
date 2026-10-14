// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {VmSafe} from "forge-std/Vm.sol";
import {RoleRegistry} from "../src/RoleRegistry.sol";

/// @notice Deploys RoleRegistry. No constructor arguments, no owner: nobody can change what it records.
///   forge script script/DeployRoles.s.sol --rpc-url arc_testnet --broadcast
/// Reads contract/.env: DEPLOYER_PRIVATE_KEY. Refuses chains other than Arc testnet and a local chain. On a real broadcast it writes deployments/<chainId>-roles.json.
contract DeployRoles is Script {
    function run() external returns (RoleRegistry reg) {
        require(block.chainid == 5042002 || block.chainid == 31337, "unsupported chain id");
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        vm.startBroadcast(pk);
        reg = new RoleRegistry();
        vm.stopBroadcast();
        console2.log("RoleRegistry deployed at", address(reg));
        if (!vm.isContext(VmSafe.ForgeContext.ScriptBroadcast)) return reg;
        string memory json = string.concat('{"chainId":', vm.toString(block.chainid), ',"roleRegistry":"', vm.toString(address(reg)), '"}');
        vm.writeFile(string.concat("deployments/", vm.toString(block.chainid), "-roles.json"), json);
    }
}

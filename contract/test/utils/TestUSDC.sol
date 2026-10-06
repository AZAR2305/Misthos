// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @dev Unit-test token only (6 decimals, like Arc's USDC ERC-20 interface). It is never deployed by scripts and
///      nothing from it reaches a running app (CLAUDE.md 0.5 keeps pure unit-test fixtures).
contract TestUSDC is ERC20("Test USDC", "tUSDC") {
    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

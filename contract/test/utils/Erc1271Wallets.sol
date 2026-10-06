// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @dev Test contract wallet (ERC-1271): valid when the digest was signed by `owner`. Stands in for a Circle
///      Agent Wallet if it turns out to be a smart-contract account (CLAUDE.md 5.5 #5, VERIFY).
contract Erc1271Wallet {
    bytes4 internal constant MAGIC = 0x1626ba7e;
    address public immutable owner;

    constructor(address owner_) {
        owner = owner_;
    }

    function isValidSignature(bytes32 hash, bytes calldata signature) external view returns (bytes4) {
        (address signer, ECDSA.RecoverError err,) = ECDSA.tryRecover(hash, signature);
        return err == ECDSA.RecoverError.NoError && signer == owner ? MAGIC : bytes4(0xffffffff);
    }
}

/// @dev Contract wallet that always answers with the wrong magic value. Must be rejected.
contract BadErc1271Wallet {
    function isValidSignature(bytes32, bytes calldata) external pure returns (bytes4) {
        return 0xdeadbeef;
    }
}

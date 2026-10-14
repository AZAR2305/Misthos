// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";

/// @title RoleRegistry
/// @notice A wallet address is a supplier or a buyer, chosen once and fixed for good. Nothing can change it: there is no owner, no upgrade,
///         no admin override and no way to reset a role, so a wallet that registered as a supplier can never act as a buyer in anything that
///         asks this registry. Reconnecting the same wallet always reads the same role from here.
/// @dev    Two ways in, with the same result: `choose` (the wallet sends the transaction) and `chooseFor` (anyone, typically a relayer that pays
///         the gas, submits the wallet's own EIP-712 signature, EOA or ERC-1271). A signature can only ever set a role once because a role
///         can only ever be set once. Unaudited; testnet.
contract RoleRegistry is EIP712 {
    enum Role {
        None,
        Supplier,
        Buyer
    }

    bytes32 public constant CHOOSE_TYPEHASH = keccak256("ChooseRole(address account,uint8 role,uint256 deadline)");

    mapping(address => Role) public roleOf;

    event RoleChosen(address indexed account, Role role, bool sponsored);

    error AlreadyChosen(Role existing);
    error BadRole();
    error BadSignature();
    error Expired();
    error ZeroAddress();

    constructor() EIP712("MisthosRoles", "1") {}

    /// @notice The caller becomes a supplier or a buyer, permanently.
    function choose(Role role) external {
        _set(msg.sender, role, false);
    }

    /// @notice Set `account`'s role from its own signature. Anyone may submit it; the role is the one the account signed, nothing else.
    function chooseFor(address account, Role role, uint256 deadline, bytes calldata signature) external {
        if (block.timestamp > deadline) revert Expired();
        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(CHOOSE_TYPEHASH, account, uint8(role), deadline)));
        if (!SignatureChecker.isValidSignatureNow(account, digest, signature)) revert BadSignature();
        _set(account, role, true);
    }

    function isSupplier(address account) external view returns (bool) {
        return roleOf[account] == Role.Supplier;
    }

    function isBuyer(address account) external view returns (bool) {
        return roleOf[account] == Role.Buyer;
    }

    /// @notice The EIP-712 digest an account signs for `chooseFor`. Exposed so wallets and tests can build it without re-deriving the domain.
    function digestFor(address account, Role role, uint256 deadline) external view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(CHOOSE_TYPEHASH, account, uint8(role), deadline)));
    }

    function _set(address account, Role role, bool sponsored) internal {
        if (account == address(0)) revert ZeroAddress();
        if (role != Role.Supplier && role != Role.Buyer) revert BadRole();
        Role existing = roleOf[account];
        if (existing != Role.None) revert AlreadyChosen(existing);
        roleOf[account] = role;
        emit RoleChosen(account, role, sponsored);
    }
}

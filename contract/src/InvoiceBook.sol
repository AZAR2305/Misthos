// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title InvoiceBook
/// @notice Misthos Kit (CLAUDE.md section 7). Verifies signed invoices and signed early-pay offers, enforces caps
///         and the rate ceiling, and settles an invoice exactly once. Unaudited. Testnet only.
/// @dev Money is in token minor units (USDC: 6 decimals on the ERC-20 interface). No floats anywhere.
///      The supplier's signature is checked with SignatureChecker, so EOAs and ERC-1271 contract wallets both work.
contract InvoiceBook is EIP712, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ---------------------------------------------------------------- types

    enum Status {
        None,
        Registered,
        Approved,
        SettledEarly,
        SettledOnDue,
        Disputed
    }

    /// @dev Signed by the supplier. The EIP-712 digest of this struct is the invoice id.
    struct Invoice {
        address supplier;
        address buyer;
        address token;
        uint256 amount;
        uint64 dueDate;
        bytes32 refHash;
        uint256 nonce;
    }

    /// @dev Signed by the supplier. `rateBps` is the most the supplier will accept the buyer to earn (annualised).
    struct EarlyPayOffer {
        bytes32 invoiceId;
        uint16 rateBps;
        uint64 expiry;
        uint256 nonce;
    }

    struct Rec {
        address supplier;
        address buyer;
        address token;
        uint128 amount;
        uint64 dueDate;
        uint64 approvedAt;
        Status status;
    }

    struct Limits {
        uint256 perInvoiceCap; // 0 = no cap
        uint256 dailyCap; // 0 = no cap
    }

    struct Item {
        bytes32 id;
        EarlyPayOffer offer;
        bytes sig;
        uint16 rateBps; // rate actually applied: never above the signed offer, never above MAX_RATE_BPS
    }

    // ------------------------------------------------------------ constants

    bytes32 public constant INVOICE_TYPEHASH = keccak256(
        "Invoice(address supplier,address buyer,address token,uint256 amount,uint64 dueDate,bytes32 refHash,uint256 nonce)"
    );
    bytes32 public constant OFFER_TYPEHASH =
        keccak256("EarlyPayOffer(bytes32 invoiceId,uint16 rateBps,uint64 expiry,uint256 nonce)");

    uint16 public constant MAX_RATE_BPS = 5000; // 50% APR hard ceiling
    uint16 public constant MAX_FEE_BPS = 3000; // hard ceiling: 30% of the discount
    uint256 public constant MAX_BATCH = 20;
    uint256 private constant BPS = 10_000;
    uint256 private constant YEAR = 365 days;

    // ---------------------------------------------------------------- state

    mapping(bytes32 => Rec) public invoices;
    mapping(address => mapping(uint256 => bool)) public usedOfferNonce; // supplier => nonce
    mapping(address => Limits) public limits; // buyer => caps
    mapping(address => mapping(uint256 => uint256)) public spentOnDay; // buyer => day => net + fee paid early
    mapping(address => bool) public tokenAllowed;

    uint16 public feeBps; // protocol success fee: share of the discount (default 1000 = 10%)
    address public feeRecipient; // owner-set; the fee is skipped if zero

    // --------------------------------------------------------------- events

    event InvoiceRegistered(
        bytes32 indexed id,
        address indexed supplier,
        address indexed buyer,
        address token,
        uint256 amount,
        uint64 dueDate,
        bytes32 refHash
    );
    event InvoiceApproved(bytes32 indexed id, uint64 approvedAt);
    event InvoiceDisputed(bytes32 indexed id);
    event LimitsSet(address indexed buyer, uint256 perInvoiceCap, uint256 dailyCap);
    event FeeSet(uint16 feeBps, address recipient);
    event TokenAllowedSet(address indexed token, bool allowed);
    event EarlySettled(
        bytes32 indexed id, uint256 net, uint256 discount, uint16 rateBps, uint256 fee, bytes32 decisionHash
    );
    event SettledOnDue(bytes32 indexed id, uint256 amount);
    event BatchSettled(uint256 count, uint256 totalNet, uint256 totalDiscount, uint256 totalFee, bytes32 decisionHash);

    // --------------------------------------------------------------- errors

    error BadParams();
    error BadSignature();
    error NotBuyer();
    error NotApproved();
    error WrongStatus();
    error AlreadyRegistered();
    error TokenNotAllowed();
    error OfferMismatch();
    error OfferExpired();
    error PastDue();
    error RateTooHigh();
    error NonceUsed();
    error DiscountTooLarge();
    error PerInvoiceCapExceeded();
    error DailyCapExceeded();
    error FeeTooHigh();
    error BatchTooLarge();
    error DuplicateInvoice();

    // ---------------------------------------------------------- constructor

    /// @param initialOwner owner (can call setFee and setTokenAllowed)
    /// @param usdc the allowlisted settlement token (Arc USDC ERC-20 interface, 6 decimals)
    /// @param initialFeeRecipient fee recipient; address(0) disables the fee
    constructor(address initialOwner, address usdc, address initialFeeRecipient)
        EIP712("Misthos", "1")
        Ownable(initialOwner)
    {
        if (usdc == address(0)) revert BadParams();
        tokenAllowed[usdc] = true;
        emit TokenAllowedSet(usdc, true);
        feeBps = 1000;
        feeRecipient = initialFeeRecipient;
        emit FeeSet(1000, initialFeeRecipient);
    }

    // ----------------------------------------------------------- admin

    function setFee(uint16 newFeeBps, address recipient) external onlyOwner {
        if (newFeeBps > MAX_FEE_BPS) revert FeeTooHigh();
        feeBps = newFeeBps;
        feeRecipient = recipient;
        emit FeeSet(newFeeBps, recipient);
    }

    function setTokenAllowed(address token, bool allowed) external onlyOwner {
        tokenAllowed[token] = allowed;
        emit TokenAllowedSet(token, allowed);
    }

    // ------------------------------------------------------------ views

    /// @notice The EIP-712 domain separator, for off-chain signers and tests.
    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    /// @notice The invoice id: the EIP-712 digest the supplier signs.
    function hashInvoice(Invoice calldata inv) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    INVOICE_TYPEHASH,
                    inv.supplier,
                    inv.buyer,
                    inv.token,
                    inv.amount,
                    inv.dueDate,
                    inv.refHash,
                    inv.nonce
                )
            )
        );
    }

    /// @notice The EIP-712 digest the supplier signs for an early-pay offer.
    function hashOffer(EarlyPayOffer calldata offer) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(abi.encode(OFFER_TYPEHASH, offer.invoiceId, offer.rateBps, offer.expiry, offer.nonce))
        );
    }

    /// @notice discount = floor(amount * rateBps * secondsEarly / (10_000 * 365 days)). Same formula as packages/core.
    function discountFor(uint256 amount, uint16 rateBps, uint256 secondsEarly) public pure returns (uint256) {
        return (amount * rateBps * secondsEarly) / (BPS * YEAR);
    }

    // ------------------------------------------------------- lifecycle

    /// @notice Register a signed invoice. Anyone may submit it (a relayer pays gas for managed-wallet suppliers).
    function registerInvoice(Invoice calldata inv, bytes calldata sig) external returns (bytes32 id) {
        if (inv.supplier == inv.buyer || inv.supplier == address(0) || inv.buyer == address(0)) revert BadParams();
        if (inv.amount == 0 || inv.amount > type(uint128).max) revert BadParams();
        if (inv.dueDate <= block.timestamp) revert BadParams();
        if (!tokenAllowed[inv.token]) revert TokenNotAllowed();

        id = hashInvoice(inv);
        if (!SignatureChecker.isValidSignatureNow(inv.supplier, id, sig)) revert BadSignature();
        if (invoices[id].status != Status.None) revert AlreadyRegistered();

        invoices[id] = Rec({
            supplier: inv.supplier,
            buyer: inv.buyer,
            token: inv.token,
            amount: uint128(inv.amount),
            dueDate: inv.dueDate,
            approvedAt: 0,
            status: Status.Registered
        });
        emit InvoiceRegistered(id, inv.supplier, inv.buyer, inv.token, inv.amount, inv.dueDate, inv.refHash);
    }

    function approveInvoice(bytes32 id) external {
        Rec storage r = invoices[id];
        if (r.status != Status.Registered) revert WrongStatus();
        if (msg.sender != r.buyer) revert NotBuyer();
        r.status = Status.Approved;
        r.approvedAt = uint64(block.timestamp);
        emit InvoiceApproved(id, r.approvedAt);
    }

    function dispute(bytes32 id) external {
        Rec storage r = invoices[id];
        if (r.status != Status.Registered && r.status != Status.Approved) revert WrongStatus();
        if (msg.sender != r.buyer) revert NotBuyer();
        r.status = Status.Disputed;
        emit InvoiceDisputed(id);
    }

    function setLimits(uint256 perInvoiceCap, uint256 dailyCap) external {
        limits[msg.sender] = Limits(perInvoiceCap, dailyCap);
        emit LimitsSet(msg.sender, perInvoiceCap, dailyCap);
    }

    /// @notice Pay a registered, approved invoice early at the supplier's signed rate.
    function settleEarly(bytes32 id, EarlyPayOffer calldata offer, bytes calldata sig, bytes32 decisionHash)
        external
        nonReentrant
    {
        _settle(id, offer, sig, offer.rateBps, decisionHash);
    }

    /// @notice Pay up to 20 approved invoices early in one atomic transaction (Tier 3: early-pay rounds).
    /// @dev Any failing item reverts the whole batch. Caps apply to the batch total because spending accumulates
    ///      per item. A rate above an item's signed maximum reverts.
    function settleBatch(Item[] calldata items, bytes32 decisionHash) external nonReentrant {
        uint256 n = items.length;
        if (n == 0 || n > MAX_BATCH) revert BatchTooLarge();
        for (uint256 i = 0; i < n; i++) {
            for (uint256 j = i + 1; j < n; j++) {
                if (items[i].id == items[j].id) revert DuplicateInvoice();
            }
        }
        uint256 totalNet;
        uint256 totalDiscount;
        uint256 totalFee;
        for (uint256 i = 0; i < n; i++) {
            (uint256 net, uint256 discount, uint256 fee) =
                _settle(items[i].id, items[i].offer, items[i].sig, items[i].rateBps, decisionHash);
            totalNet += net;
            totalDiscount += discount;
            totalFee += fee;
        }
        emit BatchSettled(n, totalNet, totalDiscount, totalFee, decisionHash);
    }

    /// @notice Pay the full amount of an approved invoice. One time.
    function settleOnDue(bytes32 id) external nonReentrant {
        Rec storage r = invoices[id];
        if (r.status != Status.Approved) revert NotApproved();
        if (msg.sender != r.buyer) revert NotBuyer();
        r.status = Status.SettledOnDue;
        IERC20(r.token).safeTransferFrom(r.buyer, r.supplier, r.amount);
        emit SettledOnDue(id, r.amount);
    }

    // --------------------------------------------------------- internals

    /// @dev Checks and effects in the order of spec 7.4. The fee is paid by the buyer on top of net, is zero at a
    ///      zero rate, and is never taken from the supplier.
    function _settle(bytes32 id, EarlyPayOffer calldata offer, bytes calldata sig, uint16 rateBps, bytes32 decisionHash)
        internal
        returns (uint256 net, uint256 discount, uint256 fee)
    {
        Rec storage r = invoices[id];
        // 1. status and caller
        if (r.status != Status.Approved) revert NotApproved();
        if (msg.sender != r.buyer) revert NotBuyer();
        // 2. the offer is for this invoice, signed by the supplier, unexpired, and the invoice is not yet due
        if (offer.invoiceId != id) revert OfferMismatch();
        if (offer.expiry < block.timestamp) revert OfferExpired();
        if (block.timestamp >= r.dueDate) revert PastDue();
        if (!SignatureChecker.isValidSignatureNow(r.supplier, hashOffer(offer), sig)) revert BadSignature();
        // 3. rate ceiling, never above the signed rate, single-use nonce
        if (rateBps > MAX_RATE_BPS || rateBps > offer.rateBps) revert RateTooHigh();
        if (usedOfferNonce[r.supplier][offer.nonce]) revert NonceUsed();
        usedOfferNonce[r.supplier][offer.nonce] = true;
        // 4. discount, rounded down (supplier-favourable)
        uint256 amount = r.amount;
        discount = discountFor(amount, rateBps, r.dueDate - block.timestamp);
        if (discount >= amount) revert DiscountTooLarge();
        // 5. net, fee and caps on net + fee
        net = amount - discount;
        fee = feeRecipient == address(0) ? 0 : (discount * feeBps) / BPS;
        _spend(r.buyer, net + fee);
        // 6. effects
        r.status = Status.SettledEarly;
        // 7. interactions
        IERC20 token = IERC20(r.token);
        token.safeTransferFrom(r.buyer, r.supplier, net);
        if (fee > 0) token.safeTransferFrom(r.buyer, feeRecipient, fee);
        // 8. event
        emit EarlySettled(id, net, discount, rateBps, fee, decisionHash);
    }

    function _spend(address buyer, uint256 total) internal {
        Limits memory l = limits[buyer];
        if (l.perInvoiceCap != 0 && total > l.perInvoiceCap) revert PerInvoiceCapExceeded();
        uint256 day = block.timestamp / 1 days;
        uint256 spent = spentOnDay[buyer][day] + total;
        if (l.dailyCap != 0 && spent > l.dailyCap) revert DailyCapExceeded();
        spentOnDay[buyer][day] = spent;
    }
}

import { parseAbi } from "viem";

/** The slice of InvoiceBook (contract/src/InvoiceBook.sol) the app reads and writes. Keep in sync with the contract. */
export const INVOICE_BOOK_ABI = parseAbi([
  // events
  "event InvoiceRegistered(bytes32 indexed id, address indexed supplier, address indexed buyer, address token, uint256 amount, uint64 dueDate, bytes32 refHash)",
  "event InvoiceApproved(bytes32 indexed id, uint64 approvedAt)",
  "event InvoiceDisputed(bytes32 indexed id)",
  "event LimitsSet(address indexed buyer, uint256 perInvoiceCap, uint256 dailyCap)",
  "event EarlySettled(bytes32 indexed id, uint256 net, uint256 discount, uint16 rateBps, uint256 fee, bytes32 decisionHash)",
  "event SettledOnDue(bytes32 indexed id, uint256 amount)",
  // reads
  "function invoices(bytes32) view returns (address supplier, address buyer, address token, uint128 amount, uint64 dueDate, uint64 approvedAt, uint8 status)",
  "function limits(address) view returns (uint256 perInvoiceCap, uint256 dailyCap)",
  "function spentOnDay(address, uint256) view returns (uint256)",
  "function usedOfferNonce(address, uint256) view returns (bool)",
  "function feeBps() view returns (uint16)",
  "function feeRecipient() view returns (address)",
  "function tokenAllowed(address) view returns (bool)",
  // writes
  "function registerInvoice((address supplier, address buyer, address token, uint256 amount, uint64 dueDate, bytes32 refHash, uint256 nonce) inv, bytes sig) returns (bytes32 id)",
  "function approveInvoice(bytes32 id)",
  "function dispute(bytes32 id)",
  "function setLimits(uint256 perInvoiceCap, uint256 dailyCap)",
  "function settleEarly(bytes32 id, (bytes32 invoiceId, uint16 rateBps, uint64 expiry, uint256 nonce) offer, bytes sig, bytes32 decisionHash)",
  "function settleOnDue(bytes32 id)",
]);

export const ERC20_ABI = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)",
]);

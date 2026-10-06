/**
 * The pure code the UI and the agents already use, re-exported so the API computes ids, discounts, journals and stats
 * with the same implementation (one copy, no drift). These modules do no I/O.
 */
export * from "../../agent/src/core/index";
export { INVOICE_BOOK_ABI, ERC20_ABI } from "../../frontend/src/lib/chain/abi";
export { buildInvoices, type InvoiceRecord, type InvoiceStatus, type RawLog } from "../../frontend/src/lib/chain/invoices";
export { journalFor, journalFrom, balanced, toCsv, toBeancount, type JournalLine, type Side } from "../../frontend/src/lib/accounting";
export { settlementRows, summarise, type SettlementRow, type Summary } from "../../frontend/src/lib/stats";

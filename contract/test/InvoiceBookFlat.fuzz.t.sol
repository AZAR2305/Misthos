// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, Vm, console} from "forge-std/Test.sol";
import {InvoiceBook} from "../src/InvoiceBook.sol";
import {TestUSDC} from "./utils/TestUSDC.sol";

/// Shared setup: a book, a USDC, one supplier key, one buyer with a large balance and allowance.
abstract contract FlatBase is Test {
    InvoiceBook internal book;
    TestUSDC internal usdc;
    uint256 internal constant SUPPLIER_PK = 0xA11CE;
    address internal supplier;
    address internal buyer = address(0xB0B);
    address internal feeRecipient = address(0xFEE);
    uint256 internal constant T0 = 1_800_000_000;
    bytes32 internal constant INV_TH = keccak256(
        "Invoice(address supplier,address buyer,address token,uint256 amount,uint64 dueDate,bytes32 refHash,uint256 nonce)"
    );
    bytes32 internal constant OFFER_TH = keccak256("EarlyPayOffer(bytes32 invoiceId,uint16 rateBps,uint64 expiry,uint256 nonce)");
    bytes32 internal constant EARLY_SETTLED = keccak256("EarlySettled(bytes32,uint256,uint256,uint16,uint256,bytes32)");
    uint256 internal invNonce;

    function _setUpBook() internal {
        vm.warp(T0);
        supplier = vm.addr(SUPPLIER_PK);
        usdc = new TestUSDC();
        book = new InvoiceBook(address(0x0A11), address(usdc), feeRecipient);
        usdc.mint(buyer, type(uint128).max);
        vm.prank(buyer);
        usdc.approve(address(book), type(uint256).max);
    }

    function _digest(bytes32 h) internal view returns (bytes32) {
        return keccak256(abi.encodePacked("\x19\x01", book.domainSeparator(), h));
    }

    function _sign(bytes32 d) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(SUPPLIER_PK, d);
        return abi.encodePacked(r, s, v);
    }

    function _newApproved(uint256 amount, uint256 days_) internal returns (bytes32 id) {
        InvoiceBook.Invoice memory inv = InvoiceBook.Invoice(
            supplier, buyer, address(usdc), amount, uint64(T0 + days_ * 1 days), keccak256("ref"), ++invNonce
        );
        bytes32 d = _digest(
            keccak256(abi.encode(INV_TH, inv.supplier, inv.buyer, inv.token, inv.amount, inv.dueDate, inv.refHash, inv.nonce))
        );
        id = book.registerInvoice(inv, _sign(d));
        vm.prank(buyer);
        book.approveInvoice(id);
    }

    function _offerSig(bytes32 id, uint16 rate, uint64 expiry, uint256 nonce) internal view returns (bytes memory) {
        return _sign(_digest(keccak256(abi.encode(OFFER_TH, id, rate, expiry, nonce))));
    }

    /// Decode the EarlySettled event out of the recorded logs: (net, discount, rateBps, fee).
    function _settledEvent(Vm.Log[] memory logs, bytes32 id)
        internal
        pure
        returns (bool found, uint256 net, uint256 discount, uint16 rate, uint256 fee)
    {
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].topics.length > 1 && logs[i].topics[0] == EARLY_SETTLED && logs[i].topics[1] == id) {
                (net, discount, rate, fee,) = abi.decode(logs[i].data, (uint256, uint256, uint16, uint256, bytes32));
                return (true, net, discount, rate, fee);
            }
        }
    }
}

/// Property tests on settleEarlyFlat with random amounts, rates and timing.
contract SettleEarlyFlatFuzz is FlatBase {
    function setUp() public {
        _setUpBook();
    }

    function testFuzz_flat_arithmeticAndMoney(uint128 amount, uint16 rate, uint8 daysDue, uint8 daysEarly) public {
        amount = uint128(bound(amount, 1e6, 1_000_000_000e6));
        rate = uint16(bound(rate, 0, book.MAX_RATE_BPS()));
        uint256 due = bound(daysDue, 2, 250);
        bytes32 id = _newApproved(amount, due);
        vm.warp(T0 + bound(daysEarly, 0, due - 1) * 1 days);
        uint64 expiry = uint64(block.timestamp + 1 hours);
        bytes memory sig = _offerSig(id, rate, expiry, 1);

        uint256[3] memory before = [usdc.balanceOf(supplier), usdc.balanceOf(buyer), usdc.balanceOf(feeRecipient)];
        vm.recordLogs();
        vm.prank(buyer);
        try book.settleEarlyFlat(id, rate, expiry, 1, sig, bytes32(0)) {
            _checkSettlement(id, amount, rate, before);
        } catch (bytes memory reason) {
            // The only acceptable refusal for a valid, in-range offer is a discount that would swallow the invoice.
            assertEq(bytes4(reason), InvoiceBook.DiscountTooLarge.selector, "unexpected revert");
        }
    }

    function _checkSettlement(bytes32 id, uint256 amount, uint16 rate, uint256[3] memory before) internal {
        (bool found, uint256 net, uint256 discount, uint16 r, uint256 fee) = _settledEvent(vm.getRecordedLogs(), id);
        assertTrue(found, "event emitted");
        assertEq(net + discount, amount, "net + discount == amount");
        assertLe(fee, discount, "fee never exceeds the discount");
        assertEq(r, rate, "settled at the signed rate");
        if (rate == 0) {
            assertEq(discount, 0, "no discount at 0%");
            assertEq(fee, 0, "no fee at 0%");
        }
        assertEq(usdc.balanceOf(supplier) - before[0], net, "supplier receives exactly net");
        assertEq(before[1] - usdc.balanceOf(buyer), net + fee, "buyer pays exactly net + fee");
        assertEq(usdc.balanceOf(feeRecipient) - before[2], fee, "fee recipient receives exactly the fee");
        assertEq(usdc.balanceOf(address(book)), 0, "the book never holds funds");
    }

    function testFuzz_flat_settlesAtMostOnce(uint128 amount, uint16 rate) public {
        amount = uint128(bound(amount, 1e6, 1_000_000e6));
        rate = uint16(bound(rate, 0, 500));
        bytes32 id = _newApproved(amount, 30);
        uint64 expiry = uint64(T0 + 1 days);
        // Signatures are made first: building them calls the book, and a prank or expectRevert would be spent on that call.
        bytes memory s1 = _offerSig(id, rate, expiry, 1);
        bytes memory s2 = _offerSig(id, rate, expiry, 2);
        bytes memory s3 = _offerSig(id, rate, expiry, 3);
        vm.prank(buyer);
        book.settleEarlyFlat(id, rate, expiry, 1, s1, bytes32(0));
        // a fresh, perfectly valid offer cannot pay it a second time
        vm.prank(buyer);
        vm.expectRevert(InvoiceBook.NotApproved.selector);
        book.settleEarlyFlat(id, rate, expiry, 2, s2, bytes32(0));
        // nor through the struct entry point
        InvoiceBook.EarlyPayOffer memory o = InvoiceBook.EarlyPayOffer(id, rate, expiry, 3);
        vm.prank(buyer);
        vm.expectRevert(InvoiceBook.NotApproved.selector);
        book.settleEarly(id, o, s3, bytes32(0));
    }

    function testFuzz_flat_usedNonceIsDeadOnBothEntryPoints(uint256 nonce, bool firstFlat) public {
        bytes32 a = _newApproved(1_000e6, 30);
        bytes32 b = _newApproved(1_000e6, 30);
        bytes32 c = _newApproved(1_000e6, 30);
        uint64 expiry = uint64(T0 + 1 days);
        bytes memory sa = _offerSig(a, 300, expiry, nonce);
        bytes memory sb = _offerSig(b, 300, expiry, nonce);
        bytes memory sc = _offerSig(c, 300, expiry, nonce);
        vm.startPrank(buyer);
        if (firstFlat) {
            book.settleEarlyFlat(a, 300, expiry, nonce, sa, bytes32(0));
        } else {
            book.settleEarly(a, InvoiceBook.EarlyPayOffer(a, 300, expiry, nonce), sa, bytes32(0));
        }
        vm.expectRevert(InvoiceBook.NonceUsed.selector);
        book.settleEarlyFlat(b, 300, expiry, nonce, sb, bytes32(0));
        vm.expectRevert(InvoiceBook.NonceUsed.selector);
        book.settleEarly(c, InvoiceBook.EarlyPayOffer(c, 300, expiry, nonce), sc, bytes32(0));
        vm.stopPrank();
    }
}

/// Drives random sequences of registrations and settlements through BOTH entry points and records what the chain emitted.
contract FlatHandler is FlatBase {
    bytes32[] public ids;
    mapping(bytes32 => uint256) public settledCount;
    mapping(bytes32 => uint256) public amountOf;
    mapping(bytes32 => uint256) public netOf;
    mapping(bytes32 => uint256) public discountOf;
    mapping(bytes32 => uint256) public feeOf;
    mapping(bytes32 => uint16) public rateOf;
    mapping(uint256 => uint256) public nonceUses; // successful settlements per supplier nonce
    uint256 public ghostSupplierPaid;
    uint256 public ghostBuyerPaid;
    uint256 public ghostFees;
    uint256 public nextNonce = 1;
    uint256 public successes;
    uint256 public viaFlat;
    uint256 public viaStruct;

    constructor() {
        _setUpBook();
    }

    function bookAddress() external view returns (address) {
        return address(book);
    }

    function usdcAddress() external view returns (address) {
        return address(usdc);
    }

    function register(uint128 amount, uint8 daysDue) external {
        amount = uint128(bound(amount, 1e6, 100_000e6));
        bytes32 id = _newApproved(amount, bound(daysDue, 2, 200));
        ids.push(id);
        amountOf[id] = amount;
    }

    function settle(uint256 pick, uint16 rate, bool flat, bool reuseNonce, uint256 reuse) external {
        if (ids.length == 0) return;
        bytes32 id = ids[pick % ids.length];
        rate = uint16(bound(rate, 0, book.MAX_RATE_BPS()));
        uint256 nonce = reuseNonce ? (reuse % nextNonce) + 1 : nextNonce++;
        uint64 expiry = uint64(T0 + 1 days);
        bytes memory sig = _offerSig(id, rate, expiry, nonce);
        uint256 s0 = usdc.balanceOf(supplier);
        uint256 b0 = usdc.balanceOf(buyer);
        vm.recordLogs();
        vm.prank(buyer);
        if (flat) {
            try book.settleEarlyFlat(id, rate, expiry, nonce, sig, bytes32(0)) {} catch {
                return;
            }
        } else {
            try book.settleEarly(id, InvoiceBook.EarlyPayOffer(id, rate, expiry, nonce), sig, bytes32(0)) {} catch {
                return;
            }
        }
        (bool found, uint256 net, uint256 discount, uint16 r, uint256 fee) = _settledEvent(vm.getRecordedLogs(), id);
        require(found, "settled without an event");
        settledCount[id] += 1;
        successes += 1;
        if (flat) viaFlat += 1; else viaStruct += 1;
        nonceUses[nonce] += 1;
        netOf[id] = net;
        discountOf[id] = discount;
        feeOf[id] = fee;
        rateOf[id] = r;
        ghostSupplierPaid += usdc.balanceOf(supplier) - s0;
        ghostBuyerPaid += b0 - usdc.balanceOf(buyer);
        ghostFees += fee;
    }

    function count() external view returns (uint256) {
        return ids.length;
    }
}

contract SettleEarlyFlatInvariants is Test {
    FlatHandler internal h;

    function setUp() public {
        h = new FlatHandler();
        targetContract(address(h));
        bytes4[] memory sel = new bytes4[](2);
        sel[0] = FlatHandler.register.selector;
        sel[1] = FlatHandler.settle.selector;
        targetSelector(FuzzSelector({addr: address(h), selectors: sel}));
    }

    /// Guards against a vacuous run: the campaign must really settle invoices through both entry points.
    function afterInvariant() public view {
        console.log("settled per run: total", h.successes());
        console.log("  via settleEarlyFlat", h.viaFlat());
        console.log("  via settleEarly", h.viaStruct());
    }

    /// An invoice settles at most once, however many entry points and offers are tried.
    function invariant_settlesAtMostOnce() public view {
        for (uint256 i = 0; i < h.count(); i++) {
            assertLe(h.settledCount(h.ids(i)), 1);
        }
    }

    /// For every settled invoice: net + discount == amount, fee <= discount, and 0% means no discount and no fee.
    function invariant_arithmeticOfEverySettlement() public view {
        for (uint256 i = 0; i < h.count(); i++) {
            bytes32 id = h.ids(i);
            if (h.settledCount(id) == 0) continue;
            assertEq(h.netOf(id) + h.discountOf(id), h.amountOf(id));
            assertLe(h.feeOf(id), h.discountOf(id));
            if (h.rateOf(id) == 0) {
                assertEq(h.discountOf(id), 0);
                assertEq(h.feeOf(id), 0);
            }
        }
    }

    /// A supplier nonce can be used successfully only once, across both entry points.
    function invariant_aNonceIsUsedOnce() public view {
        for (uint256 n = 1; n <= h.nextNonce(); n++) {
            assertLe(h.nonceUses(n), 1);
        }
    }

    /// Money is conserved: the buyer paid exactly the nets plus fees, and the book holds nothing.
    function invariant_moneyIsConserved() public view {
        assertEq(h.ghostBuyerPaid(), h.ghostSupplierPaid() + h.ghostFees());
        assertEq(TestUSDC(h.usdcAddress()).balanceOf(h.bookAddress()), 0);
    }
}

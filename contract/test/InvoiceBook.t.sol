// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {InvoiceBook} from "../src/InvoiceBook.sol";
import {TestUSDC} from "./utils/TestUSDC.sol";
import {Erc1271Wallet, BadErc1271Wallet} from "./utils/Erc1271Wallets.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @dev Covers spec 7.5 (invariants) and 7.6 (required tests). Golden numbers come from CLAUDE.md Appendix B.
///      All amounts are 6-decimal minor units. Digests are rebuilt here from the type strings, independently of
///      the contract, so a wrong typehash in the contract would fail these tests.
contract InvoiceBookTest is Test {
    InvoiceBook internal book;
    TestUSDC internal usdc;

    uint256 internal constant SUPPLIER_PK = 0xA11CE;
    uint256 internal constant OTHER_PK = 0xBAD;
    address internal supplier;
    address internal other;
    address internal buyer = address(0xB0B);
    address internal owner = address(0x0A11);
    address internal feeRecipient = address(0xFEE);

    uint256 internal constant T0 = 1_800_000_000;
    uint256 internal nonceCounter;

    bytes32 internal constant INV_TH = keccak256(
        "Invoice(address supplier,address buyer,address token,uint256 amount,uint64 dueDate,bytes32 refHash,uint256 nonce)"
    );
    bytes32 internal constant OFFER_TH =
        keccak256("EarlyPayOffer(bytes32 invoiceId,uint16 rateBps,uint64 expiry,uint256 nonce)");

    function setUp() public {
        vm.warp(T0);
        supplier = vm.addr(SUPPLIER_PK);
        other = vm.addr(OTHER_PK);
        usdc = new TestUSDC();
        book = new InvoiceBook(owner, address(usdc), feeRecipient);
        usdc.mint(buyer, 1_000_000e6);
        vm.prank(buyer);
        usdc.approve(address(book), type(uint256).max);
    }

    // ---------------------------------------------------------------- helpers

    function _digest(bytes32 structHash) internal view returns (bytes32) {
        return keccak256(abi.encodePacked("\x19\x01", book.domainSeparator(), structHash));
    }

    function _invoice(address who, uint256 amount, uint256 daysUntilDue)
        internal
        returns (InvoiceBook.Invoice memory inv)
    {
        inv = InvoiceBook.Invoice({
            supplier: who,
            buyer: buyer,
            token: address(usdc),
            amount: amount,
            dueDate: uint64(T0 + daysUntilDue * 1 days),
            refHash: keccak256("INV-REF"),
            nonce: ++nonceCounter
        });
    }

    /// Memory structs alias on assignment; copy before mutating.
    function _copy(InvoiceBook.Invoice memory i) internal pure returns (InvoiceBook.Invoice memory) {
        return InvoiceBook.Invoice(i.supplier, i.buyer, i.token, i.amount, i.dueDate, i.refHash, i.nonce);
    }

    function _invoiceDigest(InvoiceBook.Invoice memory i) internal view returns (bytes32) {
        return
            _digest(
                keccak256(abi.encode(INV_TH, i.supplier, i.buyer, i.token, i.amount, i.dueDate, i.refHash, i.nonce))
            );
    }

    function _sign(uint256 pk, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    /// Register as `supplier` (signed by SUPPLIER_PK) and approve as buyer.
    function _registerApproved(uint256 amount, uint256 daysUntilDue)
        internal
        returns (bytes32 id, InvoiceBook.Invoice memory inv)
    {
        inv = _invoice(supplier, amount, daysUntilDue);
        bytes32 digest = _invoiceDigest(inv);
        bytes memory sig = _sign(SUPPLIER_PK, digest);
        id = book.registerInvoice(inv, sig);
        assertEq(id, digest, "invoice id is the EIP-712 digest");
        vm.prank(buyer);
        book.approveInvoice(id);
    }

    function _offer(bytes32 id, uint16 rate, uint256 expiryIn, uint256 nonce)
        internal
        view
        returns (InvoiceBook.EarlyPayOffer memory)
    {
        return InvoiceBook.EarlyPayOffer({
            invoiceId: id, rateBps: rate, expiry: uint64(block.timestamp + expiryIn), nonce: nonce
        });
    }

    function _offerDigest(InvoiceBook.EarlyPayOffer memory o) internal view returns (bytes32) {
        return _digest(keccak256(abi.encode(OFFER_TH, o.invoiceId, o.rateBps, o.expiry, o.nonce)));
    }

    function _signedOffer(uint256 pk, bytes32 id, uint16 rate)
        internal
        returns (InvoiceBook.EarlyPayOffer memory o, bytes memory sig)
    {
        o = _offer(id, rate, 1 days, ++nonceCounter);
        sig = _sign(pk, _offerDigest(o));
    }

    function _settle(bytes32 id, InvoiceBook.EarlyPayOffer memory o, bytes memory sig) internal {
        vm.prank(buyer);
        book.settleEarly(id, o, sig, bytes32(uint256(1)));
    }

    function _status(bytes32 id) internal view returns (InvoiceBook.Status s) {
        (,,,,,, s) = book.invoices(id);
    }

    // --------------------------------------------------------- happy path

    function test_happyPath_appendixB() public {
        (bytes32 id,) = _registerApproved(2_000_000_000, 27); // $2,000, 27 days early
        (InvoiceBook.EarlyPayOffer memory o, bytes memory sig) = _signedOffer(SUPPLIER_PK, id, 1000);
        uint256 buyerBefore = usdc.balanceOf(buyer);

        vm.expectEmit(true, false, false, true, address(book));
        emit InvoiceBook.EarlySettled(id, 1_985_205_480, 14_794_520, 1000, 1_479_452, bytes32(uint256(1)));
        _settle(id, o, sig);

        assertEq(usdc.balanceOf(supplier), 1_985_205_480, "net");
        assertEq(usdc.balanceOf(feeRecipient), 1_479_452, "fee = 10% of discount, floor");
        assertEq(buyerBefore - usdc.balanceOf(buyer), 1_985_205_480 + 1_479_452, "buyer pays net + fee");
        assertEq(uint8(_status(id)), uint8(InvoiceBook.Status.SettledEarly));
        assertEq(usdc.decimals(), 6);
        // net + discount == face
        assertEq(uint256(1_985_205_480) + 14_794_520, 2_000_000_000);
    }

    function test_ladderRungDiscounts_appendixB() public view {
        uint256 secs = 27 days;
        assertEq(book.discountFor(2_000_000_000, 600, secs), 8_876_712);
        assertEq(book.discountFor(2_000_000_000, 800, secs), 11_835_616);
        assertEq(book.discountFor(2_000_000_000, 1000, secs), 14_794_520);
    }

    function test_zeroRate_paysFaceAndNoFee() public {
        (bytes32 id,) = _registerApproved(2_000_000_000, 27);
        (InvoiceBook.EarlyPayOffer memory o, bytes memory sig) = _signedOffer(SUPPLIER_PK, id, 0);
        _settle(id, o, sig);
        assertEq(usdc.balanceOf(supplier), 2_000_000_000, "supplier is paid the full face");
        assertEq(usdc.balanceOf(feeRecipient), 0, "no fee at a zero rate");
    }

    // --------------------------------------------------- offer failure modes

    function test_expiredOffer_reverts() public {
        (bytes32 id,) = _registerApproved(1_000e6, 30);
        (InvoiceBook.EarlyPayOffer memory o, bytes memory sig) = _signedOffer(SUPPLIER_PK, id, 500);
        vm.warp(block.timestamp + 1 days + 1);
        vm.expectRevert(InvoiceBook.OfferExpired.selector);
        _settle(id, o, sig);
    }

    function test_wrongSigner_reverts() public {
        (bytes32 id,) = _registerApproved(1_000e6, 30);
        (InvoiceBook.EarlyPayOffer memory o, bytes memory sig) = _signedOffer(OTHER_PK, id, 500);
        vm.expectRevert(InvoiceBook.BadSignature.selector);
        _settle(id, o, sig);
    }

    function test_replayedNonce_reverts() public {
        (bytes32 id1,) = _registerApproved(1_000e6, 30);
        (bytes32 id2,) = _registerApproved(1_000e6, 30);
        InvoiceBook.EarlyPayOffer memory o1 = _offer(id1, 500, 1 days, 777);
        InvoiceBook.EarlyPayOffer memory o2 = _offer(id2, 500, 1 days, 777); // same supplier nonce
        bytes memory s1 = _sign(SUPPLIER_PK, _offerDigest(o1));
        bytes memory s2 = _sign(SUPPLIER_PK, _offerDigest(o2));
        _settle(id1, o1, s1);
        vm.expectRevert(InvoiceBook.NonceUsed.selector);
        _settle(id2, o2, s2);
        assertTrue(book.usedOfferNonce(supplier, 777));
    }

    function test_secondSettle_reverts() public {
        (bytes32 id,) = _registerApproved(1_000e6, 30);
        (InvoiceBook.EarlyPayOffer memory o, bytes memory sig) = _signedOffer(SUPPLIER_PK, id, 500);
        _settle(id, o, sig);
        vm.expectRevert(InvoiceBook.NotApproved.selector);
        _settle(id, o, sig);
    }

    function test_rateAboveCeiling_reverts() public {
        (bytes32 id,) = _registerApproved(1_000e6, 30);
        (InvoiceBook.EarlyPayOffer memory o, bytes memory sig) = _signedOffer(SUPPLIER_PK, id, 5001);
        vm.expectRevert(InvoiceBook.RateTooHigh.selector);
        _settle(id, o, sig);
        // exactly at the ceiling is allowed
        (o, sig) = _signedOffer(SUPPLIER_PK, id, 5000);
        _settle(id, o, sig);
    }

    function test_afterDueDate_reverts() public {
        (bytes32 id, InvoiceBook.Invoice memory inv) = _registerApproved(1_000e6, 30);
        InvoiceBook.EarlyPayOffer memory o = _offer(id, 500, 400 days, ++nonceCounter);
        bytes memory sig = _sign(SUPPLIER_PK, _offerDigest(o));
        vm.warp(inv.dueDate);
        vm.expectRevert(InvoiceBook.PastDue.selector);
        _settle(id, o, sig);
    }

    function test_unapprovedInvoice_reverts() public {
        InvoiceBook.Invoice memory inv = _invoice(supplier, 1_000e6, 30);
        bytes32 id = book.registerInvoice(inv, _sign(SUPPLIER_PK, _invoiceDigest(inv)));
        (InvoiceBook.EarlyPayOffer memory o, bytes memory sig) = _signedOffer(SUPPLIER_PK, id, 500);
        vm.expectRevert(InvoiceBook.NotApproved.selector);
        _settle(id, o, sig);
    }

    function test_disputedInvoice_neverSettles() public {
        (bytes32 id,) = _registerApproved(1_000e6, 30);
        vm.prank(buyer);
        book.dispute(id);
        (InvoiceBook.EarlyPayOffer memory o, bytes memory sig) = _signedOffer(SUPPLIER_PK, id, 500);
        vm.expectRevert(InvoiceBook.NotApproved.selector);
        _settle(id, o, sig);
        vm.expectRevert(InvoiceBook.NotApproved.selector);
        vm.prank(buyer);
        book.settleOnDue(id);
        // disputing a Registered invoice also blocks it
        InvoiceBook.Invoice memory inv = _invoice(supplier, 1_000e6, 30);
        bytes32 id2 = book.registerInvoice(inv, _sign(SUPPLIER_PK, _invoiceDigest(inv)));
        vm.prank(buyer);
        book.dispute(id2);
        assertEq(uint8(_status(id2)), uint8(InvoiceBook.Status.Disputed));
    }

    function test_offerForAnotherInvoice_reverts() public {
        (bytes32 id,) = _registerApproved(1_000e6, 30);
        (bytes32 id2,) = _registerApproved(1_000e6, 30);
        (InvoiceBook.EarlyPayOffer memory o, bytes memory sig) = _signedOffer(SUPPLIER_PK, id2, 500);
        vm.expectRevert(InvoiceBook.OfferMismatch.selector);
        _settle(id, o, sig);
    }

    function test_onlyBuyerSettles_andPayoutGoesToSupplier() public {
        (bytes32 id,) = _registerApproved(1_000e6, 30);
        (InvoiceBook.EarlyPayOffer memory o, bytes memory sig) = _signedOffer(SUPPLIER_PK, id, 500);
        vm.expectRevert(InvoiceBook.NotBuyer.selector);
        vm.prank(other);
        book.settleEarly(id, o, sig, 0);
        _settle(id, o, sig);
        assertGt(usdc.balanceOf(supplier), 0);
        assertEq(usdc.balanceOf(other), 0);
    }

    // ---------------------------------------------------------------- caps

    function test_perInvoiceCap() public {
        (bytes32 id,) = _registerApproved(2_000_000_000, 27);
        vm.prank(buyer);
        book.setLimits(1_900_000_000, 0); // below the net
        (InvoiceBook.EarlyPayOffer memory o, bytes memory sig) = _signedOffer(SUPPLIER_PK, id, 1000);
        vm.expectRevert(InvoiceBook.PerInvoiceCapExceeded.selector);
        _settle(id, o, sig);
        vm.prank(buyer);
        book.setLimits(1_986_684_932, 0); // exactly net + fee
        _settle(id, o, sig);
    }

    function test_dailyCap_rollsOverAtMidnight() public {
        (bytes32 id1,) = _registerApproved(2_000_000_000, 60);
        (bytes32 id2,) = _registerApproved(2_000_000_000, 60);
        vm.prank(buyer);
        book.setLimits(0, 3_000_000_000); // room for one invoice a day
        (InvoiceBook.EarlyPayOffer memory o1, bytes memory s1) = _signedOffer(SUPPLIER_PK, id1, 1000);
        (InvoiceBook.EarlyPayOffer memory o2, bytes memory s2) = _signedOffer(SUPPLIER_PK, id2, 1000);
        _settle(id1, o1, s1);
        vm.expectRevert(InvoiceBook.DailyCapExceeded.selector);
        _settle(id2, o2, s2);
        vm.warp(block.timestamp + 1 days);
        InvoiceBook.EarlyPayOffer memory o3 = _offer(id2, 1000, 1 days, ++nonceCounter);
        _settle(id2, o3, _sign(SUPPLIER_PK, _offerDigest(o3)));
    }

    // ------------------------------------------------------ rounding, fees

    function test_roundingTinyAmount() public {
        (bytes32 id,) = _registerApproved(1, 30); // one minor unit
        (InvoiceBook.EarlyPayOffer memory o, bytes memory sig) = _signedOffer(SUPPLIER_PK, id, 5000);
        _settle(id, o, sig);
        assertEq(usdc.balanceOf(supplier), 1, "discount rounds down to 0, supplier keeps the unit");
        assertEq(usdc.balanceOf(feeRecipient), 0);
    }

    function test_roundingHugeAmount() public {
        uint256 amount = 1e30;
        usdc.mint(buyer, amount * 2);
        (bytes32 id,) = _registerApproved(amount, 90);
        (InvoiceBook.EarlyPayOffer memory o, bytes memory sig) = _signedOffer(SUPPLIER_PK, id, 5000);
        _settle(id, o, sig);
        uint256 net = usdc.balanceOf(supplier);
        uint256 fee = usdc.balanceOf(feeRecipient);
        uint256 discount = book.discountFor(amount, 5000, 90 days);
        assertEq(net + discount, amount);
        assertEq(fee, (discount * 1000) / 10_000);
    }

    function test_feeSplit_floorAndBounds() public {
        // 3 minor units of discount: fee floors to 0 at 10%
        uint256 amount = 100;
        uint256 secs = 30 days;
        uint16 rate = 5000;
        uint256 d = book.discountFor(amount, rate, secs);
        assertEq(d, (amount * rate * secs) / (10_000 * 365 days));
        assertLe((d * 1000) / 10_000, d);
        // fee never above discount even at the maximum fee
        vm.prank(owner);
        book.setFee(3000, feeRecipient);
        (bytes32 id,) = _registerApproved(2_000_000_000, 27);
        (InvoiceBook.EarlyPayOffer memory o, bytes memory sig) = _signedOffer(SUPPLIER_PK, id, 1000);
        _settle(id, o, sig);
        assertEq(usdc.balanceOf(feeRecipient), (14_794_520 * 3000) / 10_000);
        assertEq(usdc.balanceOf(supplier), 1_985_205_480, "supplier payout is amount - discount regardless of the fee");
    }

    function test_setFee_aboveMaxReverts_andOnlyOwner() public {
        vm.expectRevert(InvoiceBook.FeeTooHigh.selector);
        vm.prank(owner);
        book.setFee(3001, feeRecipient);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, other));
        vm.prank(other);
        book.setFee(100, feeRecipient);
    }

    function test_noFeeRecipient_meansNoFee() public {
        vm.prank(owner);
        book.setFee(1000, address(0));
        (bytes32 id,) = _registerApproved(2_000_000_000, 27);
        (InvoiceBook.EarlyPayOffer memory o, bytes memory sig) = _signedOffer(SUPPLIER_PK, id, 1000);
        uint256 before = usdc.balanceOf(buyer);
        _settle(id, o, sig);
        assertEq(before - usdc.balanceOf(buyer), 1_985_205_480, "buyer pays net only");
    }

    // -------------------------------------------------------- registration

    function test_registerInvoice_badSignature_reverts() public {
        InvoiceBook.Invoice memory inv = _invoice(supplier, 1_000e6, 30);
        bytes memory sig = _sign(OTHER_PK, _invoiceDigest(inv));
        vm.expectRevert(InvoiceBook.BadSignature.selector);
        book.registerInvoice(inv, sig);
    }

    function test_registerInvoice_duplicate_reverts() public {
        InvoiceBook.Invoice memory inv = _invoice(supplier, 1_000e6, 30);
        bytes memory sig = _sign(SUPPLIER_PK, _invoiceDigest(inv));
        book.registerInvoice(inv, sig);
        vm.expectRevert(InvoiceBook.AlreadyRegistered.selector);
        book.registerInvoice(inv, sig);
    }

    function test_registerInvoice_validation() public {
        InvoiceBook.Invoice memory inv = _invoice(supplier, 1_000e6, 30);
        bytes memory sig = _sign(SUPPLIER_PK, _invoiceDigest(inv));

        InvoiceBook.Invoice memory bad = _copy(inv);
        bad.token = address(0x1234);
        vm.expectRevert(InvoiceBook.TokenNotAllowed.selector);
        book.registerInvoice(bad, sig);

        bad = _copy(inv);
        bad.amount = 0;
        vm.expectRevert(InvoiceBook.BadParams.selector);
        book.registerInvoice(bad, sig);

        bad = _copy(inv);
        bad.buyer = supplier;
        vm.expectRevert(InvoiceBook.BadParams.selector);
        book.registerInvoice(bad, sig);

        bad = _copy(inv);
        bad.dueDate = uint64(block.timestamp);
        vm.expectRevert(InvoiceBook.BadParams.selector);
        book.registerInvoice(bad, sig);

        // anyone (a relayer) may submit a valid signed invoice
        vm.prank(other);
        book.registerInvoice(inv, sig);
    }

    function test_onlyBuyerApprovesAndDisputes() public {
        InvoiceBook.Invoice memory inv = _invoice(supplier, 1_000e6, 30);
        bytes32 id = book.registerInvoice(inv, _sign(SUPPLIER_PK, _invoiceDigest(inv)));
        vm.expectRevert(InvoiceBook.NotBuyer.selector);
        vm.prank(other);
        book.approveInvoice(id);
        vm.expectRevert(InvoiceBook.NotBuyer.selector);
        vm.prank(other);
        book.dispute(id);
    }

    function test_settleOnDue() public {
        (bytes32 id,) = _registerApproved(1_000e6, 30);
        vm.expectRevert(InvoiceBook.NotBuyer.selector);
        vm.prank(other);
        book.settleOnDue(id);
        vm.prank(buyer);
        book.settleOnDue(id);
        assertEq(usdc.balanceOf(supplier), 1_000e6);
        vm.expectRevert(InvoiceBook.NotApproved.selector);
        vm.prank(buyer);
        book.settleOnDue(id);
    }

    // ------------------------------------------------------------ ERC-1271

    function test_erc1271Wallet_signsInvoiceAndOffer() public {
        Erc1271Wallet w = new Erc1271Wallet(supplier);
        InvoiceBook.Invoice memory inv = _invoice(address(w), 2_000_000_000, 27);
        bytes32 id = book.registerInvoice(inv, _sign(SUPPLIER_PK, _invoiceDigest(inv)));
        vm.prank(buyer);
        book.approveInvoice(id);
        (InvoiceBook.EarlyPayOffer memory o, bytes memory sig) = _signedOffer(SUPPLIER_PK, id, 1000);
        _settle(id, o, sig);
        assertEq(usdc.balanceOf(address(w)), 1_985_205_480, "paid to the contract wallet");
    }

    function test_erc1271Wallet_wrongOwnerRejected() public {
        Erc1271Wallet w = new Erc1271Wallet(supplier);
        InvoiceBook.Invoice memory inv = _invoice(address(w), 1_000e6, 30);
        bytes memory sig = _sign(OTHER_PK, _invoiceDigest(inv));
        vm.expectRevert(InvoiceBook.BadSignature.selector);
        book.registerInvoice(inv, sig);
    }

    function test_erc1271Wallet_invalidMagicRejected() public {
        BadErc1271Wallet w = new BadErc1271Wallet();
        InvoiceBook.Invoice memory inv = _invoice(address(w), 1_000e6, 30);
        bytes memory sig = _sign(SUPPLIER_PK, _invoiceDigest(inv));
        vm.expectRevert(InvoiceBook.BadSignature.selector);
        book.registerInvoice(inv, sig);
    }

    // ---------------------------------------------------------------- fuzz

    function testFuzz_netPlusDiscountEqualsAmount(uint128 amountIn, uint16 rateIn, uint32 secsEarlyIn) public {
        uint256 amount = bound(uint256(amountIn), 1, 1e30);
        uint16 rate = uint16(bound(uint256(rateIn), 0, 5000));
        uint256 secsEarly = bound(uint256(secsEarlyIn), 1, 300 days);
        usdc.mint(buyer, amount * 2);

        InvoiceBook.Invoice memory inv = InvoiceBook.Invoice({
            supplier: supplier,
            buyer: buyer,
            token: address(usdc),
            amount: amount,
            dueDate: uint64(T0 + secsEarly),
            refHash: bytes32(0),
            nonce: ++nonceCounter
        });
        bytes32 id = book.registerInvoice(inv, _sign(SUPPLIER_PK, _invoiceDigest(inv)));
        vm.prank(buyer);
        book.approveInvoice(id);
        (InvoiceBook.EarlyPayOffer memory o, bytes memory sig) = _signedOffer(SUPPLIER_PK, id, rate);

        uint256 buyerBefore = usdc.balanceOf(buyer);
        _settle(id, o, sig);
        uint256 net = usdc.balanceOf(supplier);
        uint256 fee = usdc.balanceOf(feeRecipient);
        uint256 discount = book.discountFor(amount, rate, secsEarly);
        assertEq(net + discount, amount, "net + discount == amount");
        assertLe(fee, discount, "fee <= discount");
        if (rate == 0) assertEq(fee, 0);
        assertEq(buyerBefore - usdc.balanceOf(buyer), net + fee);
    }

    // ----------------------------------------------------------- settleBatch

    struct Fixture {
        bytes32 id;
        InvoiceBook.EarlyPayOffer offer;
        bytes sig;
    }

    /// Appendix B allocator and auction fixture: A $2,000 27d bid 1000, B $3,500 20d 1400, C $1,200 10d 900, D $4,000 25d 1200.
    function _fixtureInvoice(uint256 faceUsd, uint256 days_, uint16 bid) internal returns (Fixture memory f) {
        (bytes32 id,) = _registerApproved(faceUsd * 1e6, days_);
        (InvoiceBook.EarlyPayOffer memory o, bytes memory sig) = _signedOffer(SUPPLIER_PK, id, bid);
        f = Fixture(id, o, sig);
    }

    function _item(Fixture memory f, uint16 rate) internal pure returns (InvoiceBook.Item memory) {
        return InvoiceBook.Item({id: f.id, offer: f.offer, sig: f.sig, rateBps: rate});
    }

    function _batch(InvoiceBook.Item[] memory items) internal {
        vm.prank(buyer);
        book.settleBatch(items, bytes32(uint256(2)));
    }

    function test_batch_payAsBid_appendixB() public {
        Fixture memory a = _fixtureInvoice(2000, 27, 1000);
        _fixtureInvoice(3500, 20, 1400); // B bids highest but is not in the winning set
        _fixtureInvoice(1200, 10, 900); // C
        Fixture memory d = _fixtureInvoice(4000, 25, 1200);
        InvoiceBook.Item[] memory items = new InvoiceBook.Item[](2);
        items[0] = _item(a, 1000);
        items[1] = _item(d, 1200);

        vm.expectEmit(false, false, false, true, address(book));
        emit InvoiceBook.BatchSettled(2, 1_985_205_480 + 3_967_123_288, 47_671_232, 4_767_123, bytes32(uint256(2)));
        _batch(items);
        assertEq(usdc.balanceOf(feeRecipient), 1_479_452 + 3_287_671);
        assertEq(usdc.balanceOf(supplier), 1_985_205_480 + 3_967_123_288);
    }

    function test_batch_uniform_appendixB() public {
        Fixture memory a = _fixtureInvoice(2000, 27, 1000);
        Fixture memory d = _fixtureInvoice(4000, 25, 1200);
        InvoiceBook.Item[] memory items = new InvoiceBook.Item[](2);
        items[0] = _item(a, 1000);
        items[1] = _item(d, 1000); // uniform clearing rate r* = 1000, below D's own bid
        vm.expectEmit(false, false, false, true, address(book));
        emit InvoiceBook.BatchSettled(2, 5_957_808_220, 42_191_780, 4_219_178, bytes32(uint256(2)));
        _batch(items);
    }

    function test_batch_abundantBudget_allFourWin() public {
        Fixture memory a = _fixtureInvoice(2000, 27, 1000);
        Fixture memory b = _fixtureInvoice(3500, 20, 1400);
        Fixture memory c = _fixtureInvoice(1200, 10, 900);
        Fixture memory d = _fixtureInvoice(4000, 25, 1200);
        InvoiceBook.Item[] memory items = new InvoiceBook.Item[](4);
        items[0] = _item(a, 1000);
        items[1] = _item(b, 1400);
        items[2] = _item(c, 900);
        items[3] = _item(d, 1200);
        vm.expectEmit(false, false, false, false, address(book));
        emit InvoiceBook.BatchSettled(4, 0, 77_479_451, 0, bytes32(uint256(2)));
        uint256 supplierBefore = usdc.balanceOf(supplier);
        _batch(items);
        uint256 faceTotal = (2000 + 3500 + 1200 + 4000) * 1e6;
        assertEq(faceTotal - (usdc.balanceOf(supplier) - supplierBefore), 77_479_451, "total discount, pay as bid");
    }

    function test_batch_uniformAtReserve_andZeroReserve() public {
        Fixture memory a = _fixtureInvoice(2000, 27, 1000);
        Fixture memory b = _fixtureInvoice(3500, 20, 1400);
        Fixture memory c = _fixtureInvoice(1200, 10, 900);
        Fixture memory d = _fixtureInvoice(4000, 25, 1200);
        assertEq(book.discountFor(2_000_000_000, 800, 27 days), 11_835_616);
        assertEq(book.discountFor(3_500_000_000, 800, 20 days), 15_342_465);
        assertEq(book.discountFor(1_200_000_000, 800, 10 days), 2_630_136);
        assertEq(book.discountFor(4_000_000_000, 800, 25 days), 21_917_808);

        InvoiceBook.Item[] memory items = new InvoiceBook.Item[](4);
        items[0] = _item(a, 800);
        items[1] = _item(b, 800);
        items[2] = _item(c, 800);
        items[3] = _item(d, 800);
        vm.expectEmit(false, false, false, false, address(book));
        emit InvoiceBook.BatchSettled(4, 0, 51_726_025, 0, bytes32(uint256(2)));
        _batch(items);

        // reserve 0: a fresh set clears at 0, every discount and fee is 0
        Fixture memory a2 = _fixtureInvoice(2000, 27, 1000);
        items = new InvoiceBook.Item[](1);
        items[0] = _item(a2, 0);
        uint256 feeBefore = usdc.balanceOf(feeRecipient);
        _batch(items);
        assertEq(usdc.balanceOf(feeRecipient), feeBefore, "no fee at a zero clearing rate");
    }

    function test_batch_atomic_oneBadItemRevertsAll() public {
        Fixture memory a = _fixtureInvoice(2000, 27, 1000);
        Fixture memory d = _fixtureInvoice(4000, 25, 1200);
        d.sig = _sign(OTHER_PK, _offerDigest(d.offer)); // wrong signer on the second item
        InvoiceBook.Item[] memory items = new InvoiceBook.Item[](2);
        items[0] = _item(a, 1000);
        items[1] = _item(d, 1200);
        vm.expectRevert(InvoiceBook.BadSignature.selector);
        _batch(items);
        assertEq(uint8(_status(a.id)), uint8(InvoiceBook.Status.Approved), "first item was rolled back");
        assertEq(usdc.balanceOf(supplier), 0);
    }

    function test_batch_rateAboveSignedMax_reverts() public {
        Fixture memory a = _fixtureInvoice(2000, 27, 1000);
        InvoiceBook.Item[] memory items = new InvoiceBook.Item[](1);
        items[0] = _item(a, 1001);
        vm.expectRevert(InvoiceBook.RateTooHigh.selector);
        _batch(items);
    }

    function test_batch_duplicateId_reverts() public {
        Fixture memory a = _fixtureInvoice(2000, 27, 1000);
        InvoiceBook.Item[] memory items = new InvoiceBook.Item[](2);
        items[0] = _item(a, 1000);
        items[1] = _item(a, 1000);
        vm.expectRevert(InvoiceBook.DuplicateInvoice.selector);
        _batch(items);
    }

    function test_batch_size_limits() public {
        InvoiceBook.Item[] memory none = new InvoiceBook.Item[](0);
        vm.expectRevert(InvoiceBook.BatchTooLarge.selector);
        _batch(none);

        Fixture memory a = _fixtureInvoice(10, 27, 1000);
        InvoiceBook.Item[] memory tooMany = new InvoiceBook.Item[](21);
        for (uint256 i = 0; i < 21; i++) {
            tooMany[i] = _item(a, 1000);
        }
        vm.expectRevert(InvoiceBook.BatchTooLarge.selector);
        _batch(tooMany);
    }

    function test_batch_exactlyTwentyItems() public {
        InvoiceBook.Item[] memory items = new InvoiceBook.Item[](20);
        for (uint256 i = 0; i < 20; i++) {
            items[i] = _item(_fixtureInvoice(100, 27, 1000), 1000);
        }
        _batch(items);
        assertEq(usdc.balanceOf(feeRecipient), 20 * ((book.discountFor(100e6, 1000, 27 days) * 1000) / 10_000));
    }

    function test_batch_dailyCapAppliesToTotal() public {
        Fixture memory a = _fixtureInvoice(2000, 27, 1000);
        Fixture memory d = _fixtureInvoice(4000, 25, 1200);
        vm.prank(buyer);
        book.setLimits(0, 3_000_000_000); // room for A alone, not A + D
        InvoiceBook.Item[] memory items = new InvoiceBook.Item[](2);
        items[0] = _item(a, 1000);
        items[1] = _item(d, 1200);
        vm.expectRevert(InvoiceBook.DailyCapExceeded.selector);
        _batch(items);
    }

    function test_batch_onlyBuyer() public {
        Fixture memory a = _fixtureInvoice(2000, 27, 1000);
        InvoiceBook.Item[] memory items = new InvoiceBook.Item[](1);
        items[0] = _item(a, 1000);
        vm.expectRevert(InvoiceBook.NotBuyer.selector);
        vm.prank(other);
        book.settleBatch(items, 0);
    }
}

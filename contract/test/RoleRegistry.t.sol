// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {RoleRegistry} from "../src/RoleRegistry.sol";
import {Erc1271Wallet} from "./utils/Erc1271Wallets.sol";

contract RoleRegistryTest is Test {
    RoleRegistry internal reg;
    uint256 internal constant PK = 0xA11CE;
    address internal alice;
    address internal bob = address(0xB0B);
    address internal relayer = address(0xE1A7E5);

    event RoleChosen(address indexed account, RoleRegistry.Role role, bool sponsored);

    function setUp() public {
        vm.warp(1_800_000_000);
        reg = new RoleRegistry();
        alice = vm.addr(PK);
    }

    function _sign(address who, RoleRegistry.Role role, uint256 deadline, uint256 pk) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, reg.digestFor(who, role, deadline));
        return abi.encodePacked(r, s, v);
    }

    // ------------------------------------------------------------------ choose

    function test_noRoleByDefault() public view {
        assertEq(uint8(reg.roleOf(alice)), uint8(RoleRegistry.Role.None));
        assertFalse(reg.isSupplier(alice));
        assertFalse(reg.isBuyer(alice));
    }

    function test_choose_setsTheRoleAndEmits() public {
        vm.expectEmit(true, false, false, true);
        emit RoleChosen(bob, RoleRegistry.Role.Supplier, false);
        vm.prank(bob);
        reg.choose(RoleRegistry.Role.Supplier);
        assertTrue(reg.isSupplier(bob));
        assertFalse(reg.isBuyer(bob));
    }

    function test_aRoleIsFixedForever_neitherSwitchingNorRepeating() public {
        vm.startPrank(bob);
        reg.choose(RoleRegistry.Role.Supplier);
        vm.expectRevert(abi.encodeWithSelector(RoleRegistry.AlreadyChosen.selector, RoleRegistry.Role.Supplier));
        reg.choose(RoleRegistry.Role.Buyer); // cannot switch
        vm.expectRevert(abi.encodeWithSelector(RoleRegistry.AlreadyChosen.selector, RoleRegistry.Role.Supplier));
        reg.choose(RoleRegistry.Role.Supplier); // cannot even repeat
        vm.stopPrank();
        // time does not loosen it
        vm.warp(block.timestamp + 3650 days);
        vm.prank(bob);
        vm.expectRevert();
        reg.choose(RoleRegistry.Role.Buyer);
        assertTrue(reg.isSupplier(bob));
    }

    function test_onlyTheTwoRealRolesAreAccepted() public {
        vm.startPrank(bob);
        vm.expectRevert(RoleRegistry.BadRole.selector);
        reg.choose(RoleRegistry.Role.None);
        vm.stopPrank();
        // a value outside the enum cannot even be encoded by the compiler; a raw call is refused too
        (bool ok,) = address(reg).call(abi.encodeWithSelector(RoleRegistry.choose.selector, uint8(3)));
        assertFalse(ok);
        assertEq(uint8(reg.roleOf(bob)), uint8(RoleRegistry.Role.None)); // nothing was set by the failures
    }

    function test_oneWalletsChoiceNeverTouchesAnother() public {
        vm.prank(bob);
        reg.choose(RoleRegistry.Role.Buyer);
        assertEq(uint8(reg.roleOf(alice)), uint8(RoleRegistry.Role.None));
        vm.prank(alice);
        reg.choose(RoleRegistry.Role.Supplier);
        assertTrue(reg.isBuyer(bob));
        assertTrue(reg.isSupplier(alice));
    }

    // ------------------------------------------------------------------ chooseFor (a relayer pays the gas)

    function test_chooseFor_setsTheSignedRole_andTheRelayerCannotPickAnother() public {
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _sign(alice, RoleRegistry.Role.Buyer, deadline, PK);
        // the relayer cannot swap the role: the signature covers it
        vm.prank(relayer);
        vm.expectRevert(RoleRegistry.BadSignature.selector);
        reg.chooseFor(alice, RoleRegistry.Role.Supplier, deadline, sig);
        // nor change the deadline
        vm.prank(relayer);
        vm.expectRevert(RoleRegistry.BadSignature.selector);
        reg.chooseFor(alice, RoleRegistry.Role.Buyer, deadline + 1, sig);
        // the real thing works
        vm.expectEmit(true, false, false, true);
        emit RoleChosen(alice, RoleRegistry.Role.Buyer, true);
        vm.prank(relayer);
        reg.chooseFor(alice, RoleRegistry.Role.Buyer, deadline, sig);
        assertTrue(reg.isBuyer(alice));
    }

    function test_chooseFor_cannotBeReplayedOrUsedToSwitch() public {
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _sign(alice, RoleRegistry.Role.Buyer, deadline, PK);
        reg.chooseFor(alice, RoleRegistry.Role.Buyer, deadline, sig);
        vm.expectRevert(abi.encodeWithSelector(RoleRegistry.AlreadyChosen.selector, RoleRegistry.Role.Buyer));
        reg.chooseFor(alice, RoleRegistry.Role.Buyer, deadline, sig); // replay
        // a second, perfectly valid signature for the OTHER role is refused too: the first choice stands
        bytes memory other = _sign(alice, RoleRegistry.Role.Supplier, deadline, PK);
        vm.expectRevert(abi.encodeWithSelector(RoleRegistry.AlreadyChosen.selector, RoleRegistry.Role.Buyer));
        reg.chooseFor(alice, RoleRegistry.Role.Supplier, deadline, other);
        // and the wallet itself cannot switch either
        vm.prank(alice);
        vm.expectRevert();
        reg.choose(RoleRegistry.Role.Supplier);
    }

    function test_chooseFor_refusesAWrongSignerAnExpiredSignatureAndTheZeroAddress() public {
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory stranger = _sign(alice, RoleRegistry.Role.Buyer, deadline, 0xBAD); // signed by someone else
        vm.expectRevert(RoleRegistry.BadSignature.selector);
        reg.chooseFor(alice, RoleRegistry.Role.Buyer, deadline, stranger);
        bytes memory ok = _sign(alice, RoleRegistry.Role.Buyer, deadline, PK);
        vm.warp(deadline + 1);
        vm.expectRevert(RoleRegistry.Expired.selector);
        reg.chooseFor(alice, RoleRegistry.Role.Buyer, deadline, ok);
        vm.expectRevert(); // an address(0) "signer" never validates
        reg.chooseFor(address(0), RoleRegistry.Role.Buyer, block.timestamp + 1, hex"");
        assertEq(uint8(reg.roleOf(alice)), uint8(RoleRegistry.Role.None));
    }

    function test_chooseFor_worksForAContractWalletToo() public {
        Erc1271Wallet wallet = new Erc1271Wallet(alice);
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _sign(address(wallet), RoleRegistry.Role.Supplier, deadline, PK);
        reg.chooseFor(address(wallet), RoleRegistry.Role.Supplier, deadline, sig);
        assertTrue(reg.isSupplier(address(wallet)));
    }

    // ------------------------------------------------------------------ fuzz: a role, once set, never changes

    function testFuzz_aSetRoleNeverChanges(address who, bool asSupplier, bool secondSupplier) public {
        vm.assume(who != address(0));
        RoleRegistry.Role first = asSupplier ? RoleRegistry.Role.Supplier : RoleRegistry.Role.Buyer;
        RoleRegistry.Role second = secondSupplier ? RoleRegistry.Role.Supplier : RoleRegistry.Role.Buyer;
        vm.prank(who);
        reg.choose(first);
        vm.prank(who);
        (bool ok,) = address(reg).call(abi.encodeWithSelector(RoleRegistry.choose.selector, second));
        assertFalse(ok);
        assertEq(uint8(reg.roleOf(who)), uint8(first));
    }
}

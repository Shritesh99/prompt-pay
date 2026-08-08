// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {CampaignVault} from "../src/CampaignVault.sol";
import {AdAuction} from "../src/AdAuction.sol";
import {PayoutSettlement} from "../src/PayoutSettlement.sol";
import {MockUSDC} from "../src/mocks/MockUSDC.sol";
import {AdMath} from "../src/lib/AdMath.sol";

contract PromptPayTest is Test {
    MockUSDC usdc;
    CampaignVault vault;
    AdAuction auction;
    PayoutSettlement settlement;

    address advertiser = makeAddr("advertiser");
    address rival = makeAddr("rival");
    address earner = makeAddr("earner");
    address treasury = makeAddr("treasury");
    address oracle = makeAddr("oracle");
    bytes32 constant CREATIVE = keccak256("Ship on Monad - monad.xyz\nhttps://monad.xyz");
    bytes32 constant HUMAN = keccak256("human-1");

    function setUp() public {
        usdc = new MockUSDC();
        vault = new CampaignVault(IERC20(address(usdc)));
        auction = new AdAuction(vault);
        settlement = new PayoutSettlement(vault, treasury);
        vault.setOperator(address(auction), true);
        vault.setOperator(address(settlement), true);
        settlement.setOracle(oracle, true);

        usdc.mint(advertiser, 10_000e6);
        usdc.mint(rival, 10_000e6);
    }

    // ---- helpers ----

    function _createFunded(address who, uint256 amount) internal returns (uint256 id) {
        vm.startPrank(who);
        id = vault.createCampaign(CREATIVE);
        usdc.approve(address(vault), amount);
        vault.fund(id, amount);
        vm.stopPrank();
    }

    // ---- vault ----

    function test_createFundWithdraw() public {
        uint256 id = _createFunded(advertiser, 100e6);
        assertEq(vault.campaignOf(id).balance, 100e6);
        assertEq(usdc.balanceOf(address(vault)), 100e6);

        vm.prank(advertiser);
        vault.withdraw(id, 40e6);
        assertEq(vault.campaignOf(id).balance, 60e6);
        assertEq(usdc.balanceOf(advertiser), 10_000e6 - 60e6);
    }

    function test_withdraw_revertsForNonAdvertiser() public {
        uint256 id = _createFunded(advertiser, 100e6);
        vm.prank(rival);
        vm.expectRevert(CampaignVault.NotAdvertiser.selector);
        vault.withdraw(id, 1);
    }

    function test_fund_revertsUnknownOrZero() public {
        vm.startPrank(advertiser);
        usdc.approve(address(vault), 1e6);
        vm.expectRevert(CampaignVault.UnknownCampaign.selector);
        vault.fund(999, 1e6);
        uint256 id = vault.createCampaign(CREATIVE);
        vm.expectRevert(CampaignVault.ZeroAmount.selector);
        vault.fund(id, 0);
        vm.stopPrank();
    }

    function test_operatorGating() public {
        uint256 id = _createFunded(advertiser, 100e6);
        vm.startPrank(rival);
        vm.expectRevert(CampaignVault.NotOperator.selector);
        vault.setPrice(id, 1e6);
        vm.expectRevert(CampaignVault.NotOperator.selector);
        vault.deduct(id, 1);
        vm.expectRevert(CampaignVault.NotOperator.selector);
        vault.credit(rival, 1);
        vm.stopPrank();
    }

    function test_deduct_revertsOverBalance() public {
        uint256 id = _createFunded(advertiser, 100e6);
        vault.setOperator(address(this), true);
        vm.expectRevert(CampaignVault.InsufficientBalance.selector);
        vault.deduct(id, 100e6 + 1);
    }

    function test_claim_and_claimAll() public {
        _createFunded(advertiser, 100e6); // gets USDC into the vault
        vault.setOperator(address(this), true);
        vault.credit(earner, 10e6);

        vm.prank(earner);
        vault.claim(4e6);
        assertEq(usdc.balanceOf(earner), 4e6);
        assertEq(vault.claimable(earner), 6e6);

        vm.prank(earner);
        vault.claimAll();
        assertEq(usdc.balanceOf(earner), 10e6);
        assertEq(vault.claimable(earner), 0);
    }

    function test_claim_revertsOverAccruedOrZero() public {
        vm.startPrank(earner);
        vm.expectRevert(CampaignVault.NothingToClaim.selector);
        vault.claim(1);
        vm.expectRevert(CampaignVault.NothingToClaim.selector);
        vault.claimAll();
        vm.stopPrank();
    }

    // ---- auction ----

    function test_bid_happyPath_writesThroughToVault() public {
        uint256 id = _createFunded(advertiser, 100e6);
        vm.prank(advertiser);
        auction.bid(id, 2e6);
        assertEq(auction.currentBid(id), 2e6);
        assertEq(vault.campaignOf(id).pricePerSlot, 2e6);
        (uint256 winnerId, uint256 price) = auction.topBid();
        assertEq(winnerId, id);
        assertEq(price, 2e6);
    }

    function test_bid_mustExceedPrior_includingOwn() public {
        uint256 id = _createFunded(advertiser, 100e6);
        vm.startPrank(advertiser);
        auction.bid(id, 2e6);
        vm.expectRevert(AdAuction.MustOutbid.selector);
        auction.bid(id, 2e6);
        vm.stopPrank();
    }

    function test_bid_revertsUnderfunded() public {
        uint256 id = _createFunded(advertiser, 1e6);
        vm.prank(advertiser);
        vm.expectRevert(AdAuction.UnderfundedForBid.selector);
        auction.bid(id, 2e6);
    }

    function test_bid_revertsNonAdvertiser() public {
        uint256 id = _createFunded(advertiser, 100e6);
        vm.prank(rival);
        vm.expectRevert(AdAuction.NotAdvertiser.selector);
        auction.bid(id, 2e6);
    }

    function test_topBid_skipsInactiveAndDrained() public {
        uint256 a = _createFunded(advertiser, 100e6);
        uint256 b = _createFunded(rival, 100e6);
        vm.prank(advertiser);
        auction.bid(a, 5e6);
        vm.prank(rival);
        auction.bid(b, 3e6);

        // a wins, then deactivates — b takes over
        vm.prank(advertiser);
        vault.deactivate(a);
        (uint256 winnerId,) = auction.topBid();
        assertEq(winnerId, b);

        // drain b below its bid — nobody eligible
        vm.prank(rival);
        vault.withdraw(b, 98e6);
        (winnerId,) = auction.topBid();
        assertEq(winnerId, 0);
    }

    function test_board_shape() public {
        uint256 a = _createFunded(advertiser, 100e6);
        vm.prank(advertiser);
        auction.bid(a, 5e6);
        (uint256[] memory ids, address[] memory advs, uint256[] memory prices, uint256[] memory bals, bool[] memory acts)
        = auction.board();
        assertEq(ids.length, 1);
        assertEq(ids[0], a);
        assertEq(advs[0], advertiser);
        assertEq(prices[0], 5e6);
        assertEq(bals[0], 100e6);
        assertTrue(acts[0]);
        assertEq(auction.participantCount(), 1);
    }

    // ---- settlement ----

    function test_settle_splitMath() public {
        uint256 id = _createFunded(advertiser, 100e6);
        vm.prank(advertiser);
        auction.bid(id, 1e6); // 1 USDC per 1000 impressions

        vm.prank(oracle);
        uint256 charged = settlement.settleBatch(bytes32("r1"), id, earner, HUMAN, 1000, 0);
        assertEq(charged, 1e6);
        assertEq(vault.claimable(earner), 0.5e6);
        assertEq(vault.claimable(treasury), 0.5e6);
        assertEq(vault.campaignOf(id).balance, 99e6);
    }

    function test_settle_clickWeighting() public {
        uint256 id = _createFunded(advertiser, 100e6);
        vm.prank(advertiser);
        auction.bid(id, 1e6);

        vm.prank(oracle);
        uint256 charged = settlement.settleBatch(bytes32("r2"), id, earner, HUMAN, 0, 1);
        // 1 click = 50 impressions = 50/1000 of a slot
        assertEq(charged, 0.05e6);
    }

    function test_settle_capsToBalance() public {
        uint256 id = _createFunded(advertiser, 1e6);
        vm.prank(advertiser);
        auction.bid(id, 1e6);

        vm.prank(oracle);
        uint256 charged = settlement.settleBatch(bytes32("r3"), id, earner, HUMAN, 5000, 0);
        assertEq(charged, 1e6); // capped to remaining budget
        assertEq(vault.campaignOf(id).balance, 0);
        assertEq(vault.claimable(earner) + vault.claimable(treasury), 1e6);
    }

    function test_settle_receiptReplay_reverts() public {
        uint256 id = _createFunded(advertiser, 100e6);
        vm.prank(advertiser);
        auction.bid(id, 1e6);

        vm.startPrank(oracle);
        settlement.settleBatch(bytes32("r4"), id, earner, HUMAN, 10, 0);
        vm.expectRevert(PayoutSettlement.ReceiptReplayed.selector);
        settlement.settleBatch(bytes32("r4"), id, earner, HUMAN, 10, 0);
        vm.stopPrank();
    }

    function test_settle_nonOracle_reverts() public {
        uint256 id = _createFunded(advertiser, 100e6);
        vm.prank(rival);
        vm.expectRevert(PayoutSettlement.NotOracle.selector);
        settlement.settleBatch(bytes32("r5"), id, earner, HUMAN, 10, 0);
    }

    function test_settle_zeroEarner_reverts() public {
        uint256 id = _createFunded(advertiser, 100e6);
        vm.prank(oracle);
        vm.expectRevert(PayoutSettlement.ZeroEarner.selector);
        settlement.settleBatch(bytes32("r6"), id, address(0), HUMAN, 10, 0);
    }

    // ---- full loop ----

    function test_fullLoop_e2e() public {
        // advertiser creates, funds, bids
        uint256 id = _createFunded(advertiser, 10e6);
        vm.prank(advertiser);
        auction.bid(id, 2e6);

        // oracle settles 500 impressions + 2 clicks = 600 units = 0.6 slots = 1.2 USDC
        vm.prank(oracle);
        uint256 charged = settlement.settleBatch(bytes32("loop"), id, earner, HUMAN, 500, 2);
        assertEq(charged, 1.2e6);

        // earner claims their 50%
        vm.prank(earner);
        vault.claimAll();
        assertEq(usdc.balanceOf(earner), 0.6e6);

        // treasury claims
        vm.prank(treasury);
        vault.claimAll();
        assertEq(usdc.balanceOf(treasury), 0.6e6);

        // advertiser withdraws the remainder
        vm.prank(advertiser);
        vault.withdraw(id, 10e6 - 1.2e6);
        assertEq(usdc.balanceOf(address(vault)), 0);
    }
}

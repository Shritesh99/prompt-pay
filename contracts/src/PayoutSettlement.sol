// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {CampaignVault} from "./CampaignVault.sol";
import {AdMath} from "./lib/AdMath.sol";

/// Oracle-authorized settlement writer. The ad-server batches validated
/// impressions/clicks off-chain and submits them here; the vault is charged at
/// the campaign's live price and the proceeds are split 50/50 between the
/// earner and the treasury.
///
/// `humanId` is an audit passthrough today (the server derives it from the
/// agent key). When Sybil resistance lands, an AgentRegistry resolves it to a
/// World ID nullifier — no changes needed here.
contract PayoutSettlement is Ownable {
    CampaignVault public immutable vault;
    address public treasury;
    mapping(address oracle => bool) public oracles;
    mapping(bytes32 receiptId => bool) public usedReceipts;

    event BatchSettled(
        bytes32 indexed receiptId,
        uint256 indexed campaignId,
        address indexed earner,
        bytes32 humanId,
        uint256 impressions,
        uint256 clicks,
        uint256 charged,
        uint256 earnerShare,
        uint256 treasuryShare
    );
    event OracleSet(address indexed oracle, bool allowed);
    event TreasurySet(address treasury);

    error NotOracle();
    error ReceiptReplayed();
    error ZeroEarner();
    error ZeroTreasury();

    constructor(CampaignVault vault_, address treasury_) Ownable(msg.sender) {
        if (treasury_ == address(0)) revert ZeroTreasury();
        vault = vault_;
        treasury = treasury_;
    }

    function setOracle(address oracle, bool allowed) external onlyOwner {
        oracles[oracle] = allowed;
        emit OracleSet(oracle, allowed);
    }

    function setTreasury(address treasury_) external onlyOwner {
        if (treasury_ == address(0)) revert ZeroTreasury();
        treasury = treasury_;
        emit TreasurySet(treasury_);
    }

    function settleBatch(
        bytes32 receiptId,
        uint256 campaignId,
        address earner,
        bytes32 humanId,
        uint256 impressions,
        uint256 clicks
    ) external returns (uint256 charged) {
        if (!oracles[msg.sender]) revert NotOracle();
        if (usedReceipts[receiptId]) revert ReceiptReplayed();
        usedReceipts[receiptId] = true;
        if (earner == address(0)) revert ZeroEarner();

        CampaignVault.Campaign memory c = vault.campaignOf(campaignId);
        uint256 cost = AdMath.costOf(impressions, clicks, c.pricePerSlot);
        // deliver only what the campaign can still pay for
        charged = cost > c.balance ? c.balance : cost;

        uint256 earnerShare;
        uint256 treasuryShare;
        if (charged > 0) {
            vault.deduct(campaignId, charged);
            (earnerShare, treasuryShare) = AdMath.splitOf(charged);
            vault.credit(earner, earnerShare);
            vault.credit(treasury, treasuryShare);
        }

        emit BatchSettled(
            receiptId, campaignId, earner, humanId, impressions, clicks, charged, earnerShare, treasuryShare
        );
    }
}

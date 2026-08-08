// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {CampaignVault} from "./CampaignVault.sol";

/// English-ascending standing-bid auction over campaigns. Ranking only — this
/// contract never custodies tokens. Bids are written through to the vault so
/// settlement always charges at the live price.
contract AdAuction {
    CampaignVault public immutable vault;

    uint256[] private participants;
    mapping(uint256 id => bool) private seen;
    mapping(uint256 id => uint256) public currentBid;

    event BidPlaced(uint256 indexed campaignId, address indexed advertiser, uint256 pricePerSlot);

    error NotAdvertiser();
    error MustOutbid();
    error UnderfundedForBid();

    constructor(CampaignVault vault_) {
        vault = vault_;
    }

    function bid(uint256 campaignId, uint256 pricePerSlot) external {
        CampaignVault.Campaign memory c = vault.campaignOf(campaignId);
        if (c.advertiser != msg.sender) revert NotAdvertiser();
        if (pricePerSlot <= currentBid[campaignId]) revert MustOutbid();
        // must be able to deliver at least one slot at the new price
        if (c.balance < pricePerSlot) revert UnderfundedForBid();

        currentBid[campaignId] = pricePerSlot;
        if (!seen[campaignId]) {
            seen[campaignId] = true;
            participants.push(campaignId);
        }
        vault.setPrice(campaignId, pricePerSlot);
        emit BidPlaced(campaignId, msg.sender, pricePerSlot);
    }

    /// Highest active, still-fundable bid. O(n) over participants — fine at
    /// hackathon scale; the ad-server reads this off-chain anyway.
    function topBid() external view returns (uint256 winnerId, uint256 price) {
        uint256 n = participants.length;
        for (uint256 i = 0; i < n; i++) {
            uint256 id = participants[i];
            uint256 b = currentBid[id];
            if (b <= price) continue;
            CampaignVault.Campaign memory c = vault.campaignOf(id);
            if (!c.active || c.balance < b) continue;
            price = b;
            winnerId = id;
        }
    }

    function board()
        external
        view
        returns (
            uint256[] memory ids,
            address[] memory advertisers,
            uint256[] memory prices,
            uint256[] memory balances,
            bool[] memory actives
        )
    {
        uint256 n = participants.length;
        ids = new uint256[](n);
        advertisers = new address[](n);
        prices = new uint256[](n);
        balances = new uint256[](n);
        actives = new bool[](n);
        for (uint256 i = 0; i < n; i++) {
            uint256 id = participants[i];
            CampaignVault.Campaign memory c = vault.campaignOf(id);
            ids[i] = id;
            advertisers[i] = c.advertiser;
            prices[i] = currentBid[id];
            balances[i] = c.balance;
            actives[i] = c.active;
        }
    }

    function participantCount() external view returns (uint256) {
        return participants.length;
    }
}

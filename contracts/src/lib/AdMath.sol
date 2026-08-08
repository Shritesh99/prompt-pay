// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// Pure pricing and revenue-split math for PromptPay.
/// A "slot" is the bid unit: `pricePerSlot` (USDC base units) buys 1000 impressions.
/// A click is worth 50 impressions. The earner keeps 50%; the treasury gets the rest.
library AdMath {
    uint256 internal constant IMPRESSIONS_PER_SLOT = 1000;
    uint256 internal constant CLICK_UNITS = 50;
    uint256 internal constant EARNER_BPS = 5000;
    uint256 internal constant BPS = 10_000;

    function unitsOf(uint256 impressions, uint256 clicks) internal pure returns (uint256) {
        return impressions + clicks * CLICK_UNITS;
    }

    function costOf(uint256 impressions, uint256 clicks, uint256 pricePerSlot)
        internal
        pure
        returns (uint256)
    {
        return unitsOf(impressions, clicks) * pricePerSlot / IMPRESSIONS_PER_SLOT;
    }

    /// Splits `amount` 50/50; any odd unit goes to the treasury so shares always sum to amount.
    function splitOf(uint256 amount)
        internal
        pure
        returns (uint256 earnerShare, uint256 treasuryShare)
    {
        earnerShare = amount * EARNER_BPS / BPS;
        treasuryShare = amount - earnerShare;
    }
}

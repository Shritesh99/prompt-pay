// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {AdMath} from "../src/lib/AdMath.sol";

contract AdMathTest is Test {
    function test_costOf_basics() public pure {
        // 1000 impressions at 1000 units/slot = exactly one slot
        assertEq(AdMath.costOf(1000, 0, 1000), 1000);
        // one click = 50 impressions
        assertEq(AdMath.costOf(0, 1, 1000), 50);
        // mixed, floors
        assertEq(AdMath.costOf(3, 0, 1000), 3);
        assertEq(AdMath.costOf(1, 0, 999), 0); // sub-unit floors to zero
    }

    function test_splitOf_sumsAndOddUnit() public pure {
        (uint256 e, uint256 t) = AdMath.splitOf(100);
        assertEq(e, 50);
        assertEq(t, 50);
        (e, t) = AdMath.splitOf(101);
        assertEq(e, 50); // floor
        assertEq(t, 51); // odd unit to treasury
    }

    function testFuzz_costAndSplit(uint64 impressions, uint16 clicks, uint64 pricePerSlot) public pure {
        uint256 cost = AdMath.costOf(impressions, clicks, pricePerSlot);
        (uint256 e, uint256 t) = AdMath.splitOf(cost);
        assertEq(e + t, cost);
        assertLe(e, t); // earner never exceeds treasury given floor split
    }
}

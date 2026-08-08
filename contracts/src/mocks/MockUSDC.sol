// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// Faucet stablecoin for local and Monad-testnet demos. 6 decimals like USDC.
/// Minting is open but capped per call so the testnet deployment can't be
/// drained into absurdity by a single tx.
contract MockUSDC is ERC20 {
    uint256 public constant MAX_MINT_PER_CALL = 10_000e6;

    error MintTooLarge();

    constructor() ERC20("PromptPay Test USD", "pUSDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        if (amount > MAX_MINT_PER_CALL) revert MintTooLarge();
        _mint(to, amount);
    }
}

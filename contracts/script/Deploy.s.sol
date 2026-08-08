// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {CampaignVault} from "../src/CampaignVault.sol";
import {AdAuction} from "../src/AdAuction.sol";
import {PayoutSettlement} from "../src/PayoutSettlement.sol";
import {MockUSDC} from "../src/mocks/MockUSDC.sol";

/// Deploys the full PromptPay suite and writes deployments/<NETWORK>.json.
/// Env: PRIVATE_KEY (required), NETWORK (default "anvil"),
///      USDC_ADDRESS (optional — deploys MockUSDC when unset),
///      TREASURY / ORACLE (default to the deployer).
contract Deploy is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);
        string memory network = vm.envOr("NETWORK", string("anvil"));
        address usdcAddr = vm.envOr("USDC_ADDRESS", address(0));
        address treasury = vm.envOr("TREASURY", deployer);
        address oracle = vm.envOr("ORACLE", deployer);

        vm.startBroadcast(pk);

        if (usdcAddr == address(0)) {
            MockUSDC usdc = new MockUSDC();
            usdc.mint(deployer, 10_000e6);
            usdcAddr = address(usdc);
        }

        CampaignVault vault = new CampaignVault(IERC20(usdcAddr));
        AdAuction auction = new AdAuction(vault);
        PayoutSettlement settlement = new PayoutSettlement(vault, treasury);

        vault.setOperator(address(auction), true);
        vault.setOperator(address(settlement), true);
        settlement.setOracle(oracle, true);

        vm.stopBroadcast();

        string memory obj = "deployment";
        vm.serializeUint(obj, "chainId", block.chainid);
        vm.serializeAddress(obj, "usdc", usdcAddr);
        vm.serializeAddress(obj, "vault", address(vault));
        vm.serializeAddress(obj, "auction", address(auction));
        vm.serializeAddress(obj, "settlement", address(settlement));
        vm.serializeAddress(obj, "treasury", treasury);
        string memory json = vm.serializeAddress(obj, "oracle", oracle);
        string memory path = string.concat("./deployments/", network, ".json");
        vm.writeJson(json, path);

        console.log("network:", network);
        console.log("usdc:", usdcAddr);
        console.log("vault:", address(vault));
        console.log("auction:", address(auction));
        console.log("settlement:", address(settlement));
    }
}

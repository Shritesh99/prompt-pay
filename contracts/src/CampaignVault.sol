// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// The only token custodian in PromptPay. Holds advertiser campaign budgets and
/// earned-but-unclaimed balances. Operators (AdAuction, PayoutSettlement) may
/// reprice, deduct and credit; only this contract ever moves USDC.
contract CampaignVault is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Campaign {
        address advertiser;
        uint256 balance; // remaining budget, USDC base units
        uint256 pricePerSlot; // USDC base units per 1000 impressions
        bytes32 creativeHash; // keccak256(adText + "\n" + clickUrl)
        bool active;
    }

    IERC20 public immutable usdc;
    uint256 public nextId = 1;
    mapping(uint256 id => Campaign) public campaigns;
    mapping(address who => uint256) public claimable;
    mapping(address op => bool) public operators;

    event CampaignCreated(uint256 indexed id, address indexed advertiser, bytes32 creativeHash);
    event CampaignFunded(uint256 indexed id, uint256 amount);
    event CampaignWithdrawn(uint256 indexed id, uint256 amount);
    event CampaignDeactivated(uint256 indexed id);
    event PriceSet(uint256 indexed id, uint256 pricePerSlot);
    event Deducted(uint256 indexed id, uint256 amount);
    event Credited(address indexed who, uint256 amount);
    event Claimed(address indexed who, uint256 amount);
    event OperatorSet(address indexed operator, bool allowed);

    error NotOperator();
    error NotAdvertiser();
    error UnknownCampaign();
    error ZeroAmount();
    error InsufficientBalance();
    error NothingToClaim();

    modifier onlyOperator() {
        if (!operators[msg.sender]) revert NotOperator();
        _;
    }

    modifier onlyAdvertiser(uint256 id) {
        if (campaigns[id].advertiser != msg.sender) revert NotAdvertiser();
        _;
    }

    constructor(IERC20 usdc_) Ownable(msg.sender) {
        usdc = usdc_;
    }

    function setOperator(address op, bool allowed) external onlyOwner {
        operators[op] = allowed;
        emit OperatorSet(op, allowed);
    }

    // ---- advertiser ----

    function createCampaign(bytes32 creativeHash) external returns (uint256 id) {
        id = nextId++;
        campaigns[id] = Campaign({
            advertiser: msg.sender,
            balance: 0,
            pricePerSlot: 0,
            creativeHash: creativeHash,
            active: true
        });
        emit CampaignCreated(id, msg.sender, creativeHash);
    }

    function fund(uint256 id, uint256 amount) external nonReentrant {
        if (campaigns[id].advertiser == address(0)) revert UnknownCampaign();
        if (amount == 0) revert ZeroAmount();
        campaigns[id].balance += amount;
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        emit CampaignFunded(id, amount);
    }

    function withdraw(uint256 id, uint256 amount) external nonReentrant onlyAdvertiser(id) {
        Campaign storage c = campaigns[id];
        if (amount == 0 || amount > c.balance) revert InsufficientBalance();
        c.balance -= amount;
        usdc.safeTransfer(msg.sender, amount);
        emit CampaignWithdrawn(id, amount);
    }

    function deactivate(uint256 id) external onlyAdvertiser(id) {
        campaigns[id].active = false;
        emit CampaignDeactivated(id);
    }

    // ---- operators (AdAuction, PayoutSettlement) ----

    function setPrice(uint256 id, uint256 pricePerSlot) external onlyOperator {
        if (campaigns[id].advertiser == address(0)) revert UnknownCampaign();
        campaigns[id].pricePerSlot = pricePerSlot;
        emit PriceSet(id, pricePerSlot);
    }

    function deduct(uint256 id, uint256 amount) external onlyOperator {
        Campaign storage c = campaigns[id];
        if (amount > c.balance) revert InsufficientBalance();
        c.balance -= amount;
        emit Deducted(id, amount);
    }

    function credit(address who, uint256 amount) external onlyOperator {
        claimable[who] += amount;
        emit Credited(who, amount);
    }

    // ---- earners / treasury ----

    function claim(uint256 amount) public nonReentrant {
        if (amount == 0 || amount > claimable[msg.sender]) revert NothingToClaim();
        claimable[msg.sender] -= amount;
        usdc.safeTransfer(msg.sender, amount);
        emit Claimed(msg.sender, amount);
    }

    function claimAll() external {
        claim(claimable[msg.sender]);
    }

    // ---- views ----

    function campaignOf(uint256 id) external view returns (Campaign memory) {
        return campaigns[id];
    }
}

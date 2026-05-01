// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title  $BLOK — Block Blaster Token
 * @notice Whole-number ERC-20 (decimals = 0). Owner (backend signer) can
 *         mint. A single additional `minter` slot grants mint rights to the
 *         GameRewards contract so it can pay out wager bonuses on wins.
 *
 *         ERC20Burnable adds:
 *           - `burn(uint256)`           — caller burns own balance
 *           - `burnFrom(address,uint)`  — caller burns from an allowance
 *         Both are used by GameRewards: burnFrom for player spends (nuke,
 *         sweep reload, lost wagers held in escrow), burn for self-held
 *         balances (wager escrow settlement).
 *
 *         Renouncing ownership is blocked — doing so would permanently
 *         disable minting. Transfer to a fresh owner is still allowed.
 */
contract BlokToken is ERC20, ERC20Burnable, Ownable {
    /// @notice Secondary minter (expected: GameRewards contract). Zero when unset.
    address public minter;

    /// @notice 2-step minter handover staging slot.
    address public pendingMinterAddr;
    /// @notice Earliest timestamp the pending minter can be accepted.
    uint256 public pendingMinterTime;
    /// @notice Cooldown between proposing a new minter and being able to accept it.
    uint256 public constant MINTER_DELAY = 2 days;

    event MinterUpdated(address indexed previous, address indexed next);
    event MinterProposed(address indexed previous, address indexed pending, uint256 acceptableAt);

    error BlokUnauthorized();
    error ZeroMinter();
    error MinterDelayNotMet();
    error NoPendingMinter();

    constructor(address owner_) ERC20("Block Blaster Token", "BLOK") Ownable(owner_) {}

    /// @dev Whole-number token: score → tokens 1:1 with no fractional unit.
    function decimals() public pure override returns (uint8) {
        return 0;
    }

    modifier onlyMinter() {
        if (msg.sender != owner() && msg.sender != minter) revert BlokUnauthorized();
        _;
    }

    /// @notice Stage a new minter address. Must wait MINTER_DELAY before acceptMinter().
    /// @dev Rejects address(0) — use a deliberate proposeMinter+accept of a sentinel
    ///      revocation pattern at the operational layer if revocation is needed.
    function proposeMinter(address minter_) external onlyOwner {
        if (minter_ == address(0)) revert ZeroMinter();
        pendingMinterAddr = minter_;
        pendingMinterTime = block.timestamp + MINTER_DELAY;
        emit MinterProposed(minter, minter_, pendingMinterTime);
    }

    /// @notice Promote the staged minter once the cooldown has elapsed.
    function acceptMinter() external onlyOwner {
        if (pendingMinterTime == 0) revert NoPendingMinter();
        if (block.timestamp < pendingMinterTime) revert MinterDelayNotMet();
        emit MinterUpdated(minter, pendingMinterAddr);
        minter = pendingMinterAddr;
        pendingMinterTime = 0;
        pendingMinterAddr = address(0);
    }

    /// @notice Cancel a pending minter proposal before acceptance.
    function cancelPendingMinter() external onlyOwner {
        pendingMinterTime = 0;
        pendingMinterAddr = address(0);
    }

    /// @notice Mint `amount` BLOK to `to`. Callable by owner or `minter`.
    function mint(address to, uint256 amount) external onlyMinter {
        _mint(to, amount);
    }

    /// @notice Renouncing disabled — would brick minting permanently.
    function renounceOwnership() public override onlyOwner {
        revert BlokUnauthorized();
    }
}

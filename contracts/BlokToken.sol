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

    event MinterUpdated(address indexed previous, address indexed next);

    error BlokUnauthorized();

    constructor(address owner_) ERC20("Block Blaster Token", "BLOK") Ownable(owner_) {}

    /// @dev Whole-number token: score → tokens 1:1 with no fractional unit.
    function decimals() public pure override returns (uint8) {
        return 0;
    }

    modifier onlyMinter() {
        if (msg.sender != owner() && msg.sender != minter) revert BlokUnauthorized();
        _;
    }

    /// @notice Grant or revoke the secondary minter slot. Owner-only.
    function setMinter(address minter_) external onlyOwner {
        emit MinterUpdated(minter, minter_);
        minter = minter_;
    }

    /// @notice Mint `amount` BLOK to `to`. Callable by owner or `minter`.
    function mint(address to, uint256 amount) external onlyMinter {
        _mint(to, amount);
    }

    /// @notice Renouncing disabled — would brick minting permanently.
    function renounceOwnership() public view override onlyOwner {
        revert BlokUnauthorized();
    }
}

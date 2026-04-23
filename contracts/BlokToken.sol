// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title  $BLOK — Block Blaster Token
 * @notice Whole-number ERC-20 (decimals = 0). Only the owner (backend signer)
 *         can mint. Score maps 1:1 to minted units.
 */
contract BlokToken is ERC20, Ownable {
    constructor(address owner_) ERC20("Block Blaster Token", "BLOK") Ownable(owner_) {}

    /// @dev Whole-number token: score → tokens 1:1 with no fractional unit.
    function decimals() public pure override returns (uint8) {
        return 0;
    }

    /// @notice Mint `amount` BLOK to `to`. Reverts unless caller is owner.
    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }
}

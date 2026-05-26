// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";

/// @title IERC5192 — Minimal Soulbound Token interface.
interface IERC5192 {
    event Locked(uint256 tokenId);
    event Unlocked(uint256 tokenId);
    function locked(uint256 tokenId) external view returns (bool);
}

/// @title SoulboundERC721
/// @notice ERC-721 with all transfer paths reverting. ERC-5192 compliant.
/// @dev Override `_beforeAppend` / `_afterAppend` in derived contracts to add
///      gating without forking the base.
abstract contract SoulboundERC721 is ERC721, IERC5192 {
    error SoulboundNonTransferable();
    error SoulboundNonApprovable();

    constructor(string memory name_, string memory symbol_) ERC721(name_, symbol_) {}

    function locked(uint256) external pure override returns (bool) {
        return true;
    }

    /// @dev OZ v5 routes all transfers through `_update`. Allowing minting
    ///      (`from == address(0)`) and rejecting everything else covers
    ///      transferFrom, safeTransferFrom, and burn paths in one place.
    function _update(address to, uint256 tokenId, address auth)
        internal
        virtual
        override
        returns (address)
    {
        address from = _ownerOf(tokenId);
        if (from != address(0) && to != address(0)) revert SoulboundNonTransferable();
        address previousOwner = super._update(to, tokenId, auth);
        if (from == address(0) && to != address(0)) {
            emit Locked(tokenId);
        }
        return previousOwner;
    }

    /// @dev Block approvals entirely — no point approving what cannot move.
    function approve(address, uint256) public pure override {
        revert SoulboundNonApprovable();
    }

    function setApprovalForAll(address, bool) public pure override {
        revert SoulboundNonApprovable();
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        virtual
        override(ERC721)
        returns (bool)
    {
        return interfaceId == type(IERC5192).interfaceId || super.supportsInterface(interfaceId);
    }

    function _beforeAppend(address athlete, uint256 tokenId) internal virtual {}

    function _afterAppend(address athlete, uint256 tokenId) internal virtual {}
}

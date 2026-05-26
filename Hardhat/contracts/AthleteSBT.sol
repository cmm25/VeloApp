// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {SoulboundERC721} from "./abstract/SoulboundERC721.sol";
import {IAthleteSBT} from "./interfaces/IAthleteSBT.sol";

interface ICoachRegistryLike {
    function isCoach(address a) external view returns (bool);
}

/// @title AthleteSBT
/// @notice One soulbound token per athlete, holding an append-only log of
///         Velo coaching receipts. Owned by the athlete; appendable only by
///         the orchestrator (granted `APPENDER_ROLE`).
/// @dev    Athletes may self-mint via `register()` to claim the role before
///         their first receipt. They may also `burn()` their own SBT to
///         delete their account, which clears the receipt log and frees the
///         address so it can re-register as either role.
///
///         Role mutual exclusion: when `coachRegistry` is set, `register()`
///         and `appendReceipt()` revert if the athlete is registered as a
///         coach. This makes the on-chain role assignment unambiguous.
contract AthleteSBT is SoulboundERC721, AccessControl, IAthleteSBT {
    using Strings for uint256;
    using Strings for address;

    bytes32 public constant APPENDER_ROLE = keccak256("APPENDER_ROLE");

    /// @dev Auto-incrementing token id starting at 1. 0 sentinel = "no token".
    uint256 private _nextId = 1;

    /// @dev One token per athlete. `tokenIdOf[athlete] == 0` means not minted.
    mapping(address athlete => uint256 tokenId) public tokenIdOf;
    mapping(uint256 tokenId => address athlete) public athleteOf;

    /// @dev Append-only receipt log per athlete (reset on burn).
    mapping(address athlete => ReceiptRef[]) private _receipts;

    /// @notice Optional CoachRegistry reference for mutual-exclusion checks.
    ICoachRegistryLike public coachRegistry;

    error ZeroAthlete();
    error IsCoach();
    error NotOwner();

    event CoachRegistrySet(address indexed coachRegistry);
    event AthleteBurned(address indexed athlete, uint256 indexed tokenId);

    constructor(address admin)
        SoulboundERC721("Velo Athlete History", "VELO-AH")
    {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    /// @notice Admin one-shot setter for the mutual-exclusion CoachRegistry
    ///         reference. Can be re-set; pass address(0) to disable the check.
    function setCoachRegistry(address registry) external onlyRole(DEFAULT_ADMIN_ROLE) {
        coachRegistry = ICoachRegistryLike(registry);
        emit CoachRegistrySet(registry);
    }

    /// @notice Self-mint an empty athlete SBT to claim the role.
    function register() external {
        if (address(coachRegistry) != address(0) && coachRegistry.isCoach(msg.sender)) {
            revert IsCoach();
        }
        _ensureMinted(msg.sender);
    }

    /// @notice Burn the caller's SBT and wipe their receipt log. After this
    ///         the address is free to re-register as athlete or coach.
    function burn() external {
        uint256 tokenId = tokenIdOf[msg.sender];
        if (tokenId == 0) revert NotOwner();
        if (ownerOf(tokenId) != msg.sender) revert NotOwner();
        delete tokenIdOf[msg.sender];
        delete athleteOf[tokenId];
        delete _receipts[msg.sender];
        _burn(tokenId);
        emit AthleteBurned(msg.sender, tokenId);
    }

    /// @inheritdoc IAthleteSBT
    function appendReceipt(address athlete, ReceiptRef calldata r)
        external
        onlyRole(APPENDER_ROLE)
        returns (uint256 tokenId)
    {
        if (athlete == address(0)) revert ZeroAthlete();
        if (address(coachRegistry) != address(0) && coachRegistry.isCoach(athlete)) {
            revert IsCoach();
        }
        tokenId = _ensureMinted(athlete);
        _receipts[athlete].push(r);
        emit ReceiptAppended(athlete, tokenId, r.jobId, r.ipfsCid);
        _afterAppend(athlete, tokenId);
    }

    function _ensureMinted(address athlete) internal returns (uint256 tokenId) {
        tokenId = tokenIdOf[athlete];
        if (tokenId == 0) {
            tokenId = _nextId++;
            tokenIdOf[athlete] = tokenId;
            athleteOf[tokenId] = athlete;
            _beforeAppend(athlete, tokenId);
            _safeMint(athlete, tokenId);
        } else {
            _beforeAppend(athlete, tokenId);
        }
    }

    /// @inheritdoc IAthleteSBT
    function receiptCount(address athlete) external view returns (uint256) {
        return _receipts[athlete].length;
    }

    /// @inheritdoc IAthleteSBT
    function receiptAt(address athlete, uint256 index)
        external
        view
        returns (ReceiptRef memory)
    {
        return _receipts[athlete][index];
    }

    /// @notice ERC-721 metadata JSON returned as a `data:application/json;base64`
    ///         URI. Every receipt attached to the athlete is enumerated in the
    ///         `receipts` array, so a wallet that reads this URI sees the full
    ///         coaching history without an off-chain resolver. `attributes`
    ///         carries the receipt count so explorers can show it at a glance.
    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        address athlete = athleteOf[tokenId];
        ReceiptRef[] storage rs = _receipts[athlete];

        bytes memory receiptsJson = bytes("[");
        for (uint256 i = 0; i < rs.length; i++) {
            ReceiptRef storage r = rs[i];
            if (i > 0) receiptsJson = abi.encodePacked(receiptsJson, ",");
            receiptsJson = abi.encodePacked(
                receiptsJson,
                '{"jobId":"', _toHex(r.jobId),
                '","ipfsCid":"', r.ipfsCid,
                '","summaryHash":"', _toHex(r.summaryHash),
                '","timestamp":', uint256(r.timestamp).toString(),
                ',"formAgent":"', r.formAgent.toHexString(),
                '","prescriptionAgent":"', r.prescriptionAgent.toHexString(),
                '"}'
            );
        }
        receiptsJson = abi.encodePacked(receiptsJson, "]");

        bytes memory json = abi.encodePacked(
            '{"name":"Velo Athlete History #', tokenId.toString(),
            '","description":"Soulbound coaching receipt history for athlete ',
            athlete.toHexString(),
            '. Each entry is a verifiable two-agent receipt anchored on Somnia.",',
            '"attributes":[{"trait_type":"receipt_count","value":',
            rs.length.toString(),
            '}],"receipts":',
            receiptsJson,
            '}'
        );

        return string.concat(
            "data:application/json;base64,",
            Base64.encode(json)
        );
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(SoulboundERC721, AccessControl)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }

    /// @dev Hex-encode a bytes32 as a 0x-prefixed lowercase string.
    function _toHex(bytes32 v) private pure returns (string memory) {
        bytes memory alphabet = "0123456789abcdef";
        bytes memory out = new bytes(66);
        out[0] = "0";
        out[1] = "x";
        for (uint256 i = 0; i < 32; i++) {
            out[2 + i * 2] = alphabet[uint8(v[i] >> 4)];
            out[3 + i * 2] = alphabet[uint8(v[i] & 0x0f)];
        }
        return string(out);
    }
}

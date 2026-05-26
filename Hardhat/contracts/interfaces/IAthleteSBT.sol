// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IAthleteSBT
/// @notice Soulbound athlete history token. Per-athlete append-only receipt log.
interface IAthleteSBT {
    struct ReceiptRef {
        bytes32 jobId;
        string ipfsCid;
        bytes32 summaryHash;
        uint64 timestamp;
        address formAgent;
        address prescriptionAgent;
    }

    event ReceiptAppended(
        address indexed athlete,
        uint256 indexed tokenId,
        bytes32 indexed jobId,
        string ipfsCid
    );

    /// @notice Append a new receipt for `athlete`, minting their SBT on first call.
    function appendReceipt(
        address athlete,
        ReceiptRef calldata receipt
    ) external returns (uint256 tokenId);

    /// @notice Returns the number of receipts attached to `athlete`.
    function receiptCount(address athlete) external view returns (uint256);

    /// @notice Returns the i-th receipt attached to `athlete`.
    function receiptAt(address athlete, uint256 index)
        external
        view
        returns (ReceiptRef memory);
}

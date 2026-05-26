// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/// @title ReceiptLib
/// @notice EIP-712 typed-data hashing for agent receipts. Pure logic, no storage.
library ReceiptLib {
    using ECDSA for bytes32;

    /// @dev Hard cap on the on-chain summary to keep gas bounded and to
    ///      approximate the ≤256-token policy off-chain (~4 chars/token).
    uint256 internal constant MAX_SUMMARY_BYTES = 1024;

    /// @dev Hard cap on IPFS CID length (CIDv0 ~46, CIDv1 ~62 typical).
    uint256 internal constant MAX_CID_BYTES = 128;

    bytes32 internal constant RECEIPT_TYPEHASH = keccak256(
        "Receipt(bytes32 jobId,address agent,string ipfsCid,bytes32 summaryHash,string summary,uint256 nonce,uint64 deadline,bytes32 priorReceiptHash)"
    );

    struct Receipt {
        bytes32 jobId;
        address agent;
        string ipfsCid;
        bytes32 summaryHash; // keccak256 of the full report bytes
        string summary;      // short human-readable summary, stored on-chain
        uint256 nonce;
        uint64 deadline;
        bytes32 priorReceiptHash; // bytes32(0) for the form receipt
    }

    error InvalidSignature();
    error CidTooLong();
    error SummaryHashZero();
    error SummaryTooLong();
    error SummaryEmpty();
    error AgentMismatch(address expected, address recovered);
    error DeadlineExpired();

    /// @notice EIP-712 struct hash of a receipt.
    function structHash(Receipt memory r) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                RECEIPT_TYPEHASH,
                r.jobId,
                r.agent,
                keccak256(bytes(r.ipfsCid)),
                r.summaryHash,
                keccak256(bytes(r.summary)),
                r.nonce,
                r.deadline,
                r.priorReceiptHash
            )
        );
    }

    /// @notice Hash of the receipt eligible for storage / chaining. Includes
    ///         summary so the prescription is bound to the exact human-readable
    ///         text the form agent recorded.
    function digest(Receipt memory r) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                r.jobId,
                r.agent,
                r.ipfsCid,
                r.summaryHash,
                keccak256(bytes(r.summary)),
                r.priorReceiptHash
            )
        );
    }

    /// @notice Validate bounds & non-emptiness — every public path must call this
    ///         before persisting receipt fields.
    function validate(Receipt memory r) internal view {
        if (bytes(r.ipfsCid).length == 0 || bytes(r.ipfsCid).length > MAX_CID_BYTES) {
            revert CidTooLong();
        }
        if (r.summaryHash == bytes32(0)) revert SummaryHashZero();
        if (bytes(r.summary).length == 0) revert SummaryEmpty();
        if (bytes(r.summary).length > MAX_SUMMARY_BYTES) revert SummaryTooLong();
        if (r.deadline != 0 && block.timestamp > r.deadline) revert DeadlineExpired();
    }

    /// @notice Recover the EIP-712 signer and assert it equals `r.agent`.
    function verify(
        Receipt memory r,
        bytes32 domainSeparator,
        bytes memory signature
    ) internal pure {
        bytes32 typed = MessageHashUtils.toTypedDataHash(domainSeparator, structHash(r));
        address recovered = ECDSA.recover(typed, signature);
        if (recovered == address(0)) revert InvalidSignature();
        if (recovered != r.agent) revert AgentMismatch(r.agent, recovered);
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReceiptLib} from "../libraries/ReceiptLib.sol";

/// @title ReceiptStore
/// @notice Storage + chaining for the two-step agent receipt flow.
/// @dev Enforces that the prescription receipt's `priorReceiptHash` matches
///      the on-chain digest of the form receipt — i.e. the prescriber must
///      have read the form result from chain state, not from off-chain memory.
abstract contract ReceiptStore {
    /// @notice Form receipt indexed by job id.
    mapping(bytes32 jobId => ReceiptLib.Receipt) internal _formReceipt;

    /// @notice Prescription receipt indexed by job id.
    mapping(bytes32 jobId => ReceiptLib.Receipt) internal _prescriptionReceipt;

    /// @notice Per-agent nonce, used to reject replay across jobs and forks.
    mapping(address agent => uint256 nonce) public nonceOf;

    error FormReceiptMissing();
    error FormReceiptAlreadyExists();
    error PrescriptionAlreadyExists();
    error PriorReceiptMismatch(bytes32 expected, bytes32 actual);
    error BadNonce(uint256 expected, uint256 actual);

    function _storeFormReceipt(bytes32 jobId, ReceiptLib.Receipt memory r) internal {
        if (_formReceipt[jobId].agent != address(0)) revert FormReceiptAlreadyExists();
        _assertAndBumpNonce(r.agent, r.nonce);
        _formReceipt[jobId] = r;
    }

    function _storePrescriptionReceipt(bytes32 jobId, ReceiptLib.Receipt memory r) internal {
        if (_prescriptionReceipt[jobId].agent != address(0)) revert PrescriptionAlreadyExists();
        ReceiptLib.Receipt memory prior = _formReceipt[jobId];
        if (prior.agent == address(0)) revert FormReceiptMissing();
        bytes32 priorDigest = ReceiptLib.digest(prior);
        if (r.priorReceiptHash != priorDigest) {
            revert PriorReceiptMismatch(priorDigest, r.priorReceiptHash);
        }
        _assertAndBumpNonce(r.agent, r.nonce);
        _prescriptionReceipt[jobId] = r;
    }

    function _assertAndBumpNonce(address agent, uint256 provided) private {
        uint256 expected = nonceOf[agent];
        if (provided != expected) revert BadNonce(expected, provided);
        unchecked {
            nonceOf[agent] = expected + 1;
        }
    }
}

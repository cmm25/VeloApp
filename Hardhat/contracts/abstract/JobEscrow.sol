// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

/// @title JobEscrow
/// @notice Per-job pull-payment escrow. Native-token only in v1.
/// @dev All native transfers use pull-payment (`withdraw`) — never push in the
///      hot path. Checks-Effects-Interactions strictly enforced.
abstract contract JobEscrow is ReentrancyGuard, Pausable {
    /// @notice Basis-points share of the fee given to the form-analysis agent.
    /// @dev Remainder (10000 - FORM_AGENT_BPS) goes to the prescription agent.
    uint16 public constant FORM_AGENT_BPS = 4000; // 40%

    uint16 internal constant BPS_DENOM = 10_000;

    /// @notice Per-job escrowed amount.
    mapping(bytes32 jobId => uint256 amount) public escrowOf;

    /// @notice Pending pull-payment balances per agent.
    mapping(address agent => uint256 amount) public pendingOf;

    event EscrowFunded(bytes32 indexed jobId, uint256 amount);
    event EscrowSplit(
        bytes32 indexed jobId,
        address indexed formAgent,
        uint256 formShare,
        address indexed prescriptionAgent,
        uint256 prescriptionShare
    );
    event EscrowRefunded(bytes32 indexed jobId, address indexed coach, uint256 amount);

    error EscrowEmpty();
    error InsufficientFee(uint256 sent);
    error TransferFailed();

    /// @notice Minimum job fee — enforced via override in concrete contract.
    function _minJobFee() internal view virtual returns (uint256);

    /// @notice Record a new escrow deposit for a job.
    /// @dev Caller must already have validated the job is new.
    function _fundEscrow(bytes32 jobId, uint256 amount) internal {
        if (amount < _minJobFee()) revert InsufficientFee(amount);
        escrowOf[jobId] = amount;
        emit EscrowFunded(jobId, amount);
    }

    /// @notice Split escrow between the two agents (pull-payment accrual).
    function _splitEscrow(
        bytes32 jobId,
        address formAgent,
        address prescriptionAgent
    ) internal {
        uint256 total = escrowOf[jobId];
        if (total == 0) revert EscrowEmpty();
        // Effects
        escrowOf[jobId] = 0;
        uint256 formShare = (total * FORM_AGENT_BPS) / BPS_DENOM;
        uint256 prescriptionShare = total - formShare;
        pendingOf[formAgent] += formShare;
        pendingOf[prescriptionAgent] += prescriptionShare;
        emit EscrowSplit(jobId, formAgent, formShare, prescriptionAgent, prescriptionShare);
    }

    /// @notice Refund the full escrow to `coach`.
    function _refundEscrow(bytes32 jobId, address coach) internal {
        uint256 total = escrowOf[jobId];
        if (total == 0) revert EscrowEmpty();
        // Effects
        escrowOf[jobId] = 0;
        pendingOf[coach] += total;
        emit EscrowRefunded(jobId, coach, total);
    }

    /// @notice Pull-payment withdrawal entry point.
    function _withdraw(address payable to) internal nonReentrant returns (uint256) {
        uint256 amount = pendingOf[to];
        if (amount == 0) revert EscrowEmpty();
        // Effects
        pendingOf[to] = 0;
        // Interactions
        (bool ok, ) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
        return amount;
    }
}

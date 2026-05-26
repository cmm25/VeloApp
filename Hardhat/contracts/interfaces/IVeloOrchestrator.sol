// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReceiptLib} from "../libraries/ReceiptLib.sol";

/// @title IVeloOrchestrator
/// @notice Public surface of the Velo orchestrator. Other dApps/agents on
///         Somnia should depend on this interface, never on the concrete.
interface IVeloOrchestrator {
    enum JobStatus {
        None,
        Requested,
        FormSubmitted,
        Completed,
        Cancelled
    }

    struct Job {
        address coach;
        address athlete;
        string videoCid;
        uint256 fee;
        uint64 createdAt;
        uint64 deadline;
        JobStatus status;
    }

    event JobRequested(
        bytes32 indexed jobId,
        address indexed coach,
        address indexed athlete,
        string videoCid,
        uint256 fee,
        uint64 deadline
    );

    event FormReceiptSubmitted(
        bytes32 indexed jobId,
        address indexed agent,
        string ipfsCid,
        bytes32 summaryHash,
        string summary
    );

    event PrescriptionSubmitted(
        bytes32 indexed jobId,
        address indexed agent,
        string ipfsCid,
        bytes32 summaryHash,
        string summary
    );

    /// @notice Emitted when an expired job is cancelled and the coach is refunded.
    /// @param jobId The job that was cancelled.
    /// @param by The address that triggered the cancellation (always the coach in v1).
    event JobCancelled(bytes32 indexed jobId, address indexed by);

    /// @notice Emitted when an agent (or coach refund) is paid out via pull-payment.
    /// @param agent The recipient of the withdrawal.
    /// @param amount The amount withdrawn (wei).
    event AgentWithdrawn(address indexed agent, uint256 amount);

    /// @notice Open a new job by escrowing `msg.value` and recording the inputs.
    /// @dev Reverts with `JobAlreadyExists` if the derived job id collides, with
    ///      `ReceiptLib.DeadlineExpired` if the deadline is in the past, or with
    ///      `InsufficientFee` if `msg.value` is below `minJobFee`.
    /// @param athlete   The athlete whose swing is being analyzed.
    /// @param videoCid  IPFS CID of the swing video to analyze.
    /// @param deadline  Unix timestamp by which both agent receipts must be submitted.
    /// @return jobId    The deterministic id assigned to this job.
    function payJob(
        address athlete,
        string calldata videoCid,
        uint64 deadline
    ) external payable returns (bytes32 jobId);

    /// @notice Submit the first (form-analysis) receipt for a Requested job.
    /// @dev    Caller must be a registered agent. The receipt is validated,
    ///         its EIP-712 signature is recovered, and the job advances to
    ///         `FormSubmitted`.
    /// @param receipt    The fully populated form receipt.
    /// @param signature  The EIP-712 signature over `receipt` produced by `receipt.agent`.
    function submitFormReceipt(
        ReceiptLib.Receipt calldata receipt,
        bytes calldata signature
    ) external;

    /// @notice Submit the second (prescription) receipt, completing the job.
    /// @dev    Caller must be a registered agent. The receipt's
    ///         `priorReceiptHash` must equal the digest of the stored form
    ///         receipt, proving the prescriber read state from chain. Splits
    ///         the escrow between the two agents and appends to the athlete SBT.
    /// @param receipt    The fully populated prescription receipt.
    /// @param signature  The EIP-712 signature over `receipt` produced by `receipt.agent`.
    function submitPrescription(
        ReceiptLib.Receipt calldata receipt,
        bytes calldata signature
    ) external;

    /// @notice Cancel an expired job and refund the coach via pull-payment.
    /// @dev    Only the original coach may cancel. The job must still be in
    ///         `Requested` or `FormSubmitted` and `block.timestamp` must be
    ///         strictly past the job deadline.
    /// @param jobId The job to cancel.
    function cancelExpired(bytes32 jobId) external;

    /// @notice Withdraw the caller's pull-payment balance.
    /// @dev    Reverts with `EscrowEmpty` if the caller has nothing pending.
    function withdraw() external;

    /// @notice Return the job record for `jobId`.
    /// @dev    Reverts with `JobNotFound` if the job was never opened.
    function getJob(bytes32 jobId) external view returns (Job memory);

    /// @notice Return the stored form receipt for `jobId`.
    /// @dev    Reverts with `FormReceiptMissing` if no form receipt was submitted.
    function getFormReceipt(bytes32 jobId)
        external
        view
        returns (ReceiptLib.Receipt memory);

    /// @notice Return the stored prescription receipt for `jobId`.
    /// @dev    Returns a zero-initialized struct (agent == address(0)) if no
    ///         prescription has been submitted yet.
    function getPrescriptionReceipt(bytes32 jobId)
        external
        view
        returns (ReceiptLib.Receipt memory);
}

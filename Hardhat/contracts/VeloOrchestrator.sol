// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

import {AgentRegistryAware} from "./abstract/AgentRegistryAware.sol";
import {JobEscrow} from "./abstract/JobEscrow.sol";
import {ReceiptStore} from "./abstract/ReceiptStore.sol";
import {ReceiptLib} from "./libraries/ReceiptLib.sol";
import {JobIdLib} from "./libraries/JobIdLib.sol";
import {IVeloOrchestrator} from "./interfaces/IVeloOrchestrator.sol";
import {IAthleteSBT} from "./interfaces/IAthleteSBT.sol";

/// @title VeloOrchestrator
/// @notice Thin composer of `AgentRegistryAware + JobEscrow + ReceiptStore +
///         EIP712`. Implements the public `IVeloOrchestrator` surface.
/// @dev    No business logic lives here that isn't a base's. Every external
///         path is `nonReentrant` + `whenNotPaused` where it mutates state.
contract VeloOrchestrator is
    AgentRegistryAware,
    JobEscrow,
    ReceiptStore,
    EIP712,
    AccessControl,
    IVeloOrchestrator
{
    /// @notice Role allowed to pause / unpause all state-mutating entrypoints.
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    /// @notice Role allowed to adjust the minimum job fee.
    bytes32 public constant FEE_ADMIN_ROLE = keccak256("FEE_ADMIN_ROLE");

    /// @notice Minimum native-token fee a coach must pay per job (wei).
    uint256 public minJobFee;

    /// @notice Soulbound athlete history token receiving the appended receipts.
    IAthleteSBT public immutable athleteSBT;

    /// @dev Storage of all jobs, indexed by their deterministic job id.
    mapping(bytes32 jobId => Job) internal _jobs;

    /// @notice Reverted when a derived job id collides with an existing job.
    error JobAlreadyExists();
    /// @notice Reverted when a view or mutation references a non-existent job.
    error JobNotFound();
    /// @notice Reverted when the form receipt is submitted on a job not in `Requested`.
    error JobNotRequested();
    /// @notice Reverted when the prescription is submitted on a job not in `FormSubmitted`.
    error JobNotFormSubmitted();
    /// @notice Reverted when `cancelExpired` is called before the job deadline.
    error DeadlineNotReached();
    /// @notice Reverted when `cancelExpired` is called by anyone other than the coach.
    /// @param coach The address authorized to cancel the job.
    error OnlyCoach(address coach);
    /// @notice Reverted when an agent receipt's deadline outlasts the job's own deadline.
    /// @param receiptDeadline The deadline carried in the receipt struct.
    /// @param jobDeadline     The deadline of the underlying job.
    error ReceiptDeadlineAfterJob(uint64 receiptDeadline, uint64 jobDeadline);

    /// @notice Emitted when the admin updates the minimum job fee.
    /// @param oldFee The previous `minJobFee` value (wei).
    /// @param newFee The new `minJobFee` value (wei).
    event MinJobFeeUpdated(uint256 oldFee, uint256 newFee);

    /// @notice Deploy the orchestrator and wire its admin / registry / SBT.
    /// @param admin       Address granted `DEFAULT_ADMIN_ROLE`, `PAUSER_ROLE` and `FEE_ADMIN_ROLE`.
    /// @param registry    Canonical AgentRegistry used to gate agent submissions.
    /// @param sbt         AthleteSBT contract that records appended receipts.
    /// @param minJobFee_  Initial minimum native-token fee per job (wei).
    constructor(
        address admin,
        address registry,
        address sbt,
        uint256 minJobFee_
    ) AgentRegistryAware(registry) EIP712("Velo", "1") {
        if (admin == address(0) || sbt == address(0)) revert ZeroAddress();
        athleteSBT = IAthleteSBT(sbt);
        minJobFee = minJobFee_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(PAUSER_ROLE, admin);
        _grantRole(FEE_ADMIN_ROLE, admin);
        emit MinJobFeeUpdated(0, minJobFee_);
    }

    /// @inheritdoc IVeloOrchestrator
    function payJob(address athlete, string calldata videoCid, uint64 deadline)
        external
        payable
        override
        whenNotPaused
        nonReentrant
        returns (bytes32 jobId)
    {
        if (athlete == address(0)) revert ZeroAddress();
        if (deadline <= block.timestamp) revert ReceiptLib.DeadlineExpired();

        jobId = JobIdLib.compute(msg.sender, athlete, videoCid, block.number);
        if (_jobs[jobId].status != JobStatus.None) revert JobAlreadyExists();

        // Effects
        _jobs[jobId] = Job({
            coach: msg.sender,
            athlete: athlete,
            videoCid: videoCid,
            fee: msg.value,
            createdAt: uint64(block.timestamp),
            deadline: deadline,
            status: JobStatus.Requested
        });
        _fundEscrow(jobId, msg.value);

        emit JobRequested(jobId, msg.sender, athlete, videoCid, msg.value, deadline);
    }

    /// @inheritdoc IVeloOrchestrator
    function submitFormReceipt(
        ReceiptLib.Receipt calldata r,
        bytes calldata signature
    )
        external
        override
        whenNotPaused
        nonReentrant
        onlyRegisteredAgent(r.agent)
    {
        Job storage job = _jobs[r.jobId];
        if (job.status != JobStatus.Requested) revert JobNotRequested();
        if (r.priorReceiptHash != bytes32(0)) {
            revert PriorReceiptMismatch(bytes32(0), r.priorReceiptHash);
        }
        // Receipt deadline must not outlast the job deadline — otherwise an
        // agent could complete a job after the coach was entitled to refund.
        if (r.deadline > job.deadline) {
            revert ReceiptDeadlineAfterJob(r.deadline, job.deadline);
        }
        ReceiptLib.validate(r);
        ReceiptLib.verify(r, _domainSeparatorV4(), signature);

        // Effects
        job.status = JobStatus.FormSubmitted;
        _storeFormReceipt(r.jobId, r);

        emit FormReceiptSubmitted(r.jobId, r.agent, r.ipfsCid, r.summaryHash, r.summary);
    }

    /// @inheritdoc IVeloOrchestrator
    function submitPrescription(
        ReceiptLib.Receipt calldata r,
        bytes calldata signature
    )
        external
        override
        whenNotPaused
        nonReentrant
        onlyRegisteredAgent(r.agent)
    {
        Job storage job = _jobs[r.jobId];
        if (job.status != JobStatus.FormSubmitted) revert JobNotFormSubmitted();
        if (r.deadline > job.deadline) {
            revert ReceiptDeadlineAfterJob(r.deadline, job.deadline);
        }
        ReceiptLib.validate(r);
        // Domain-separated EIP-712 sig binds agent ↔ jobId ↔ priorReceiptHash.
        ReceiptLib.verify(r, _domainSeparatorV4(), signature);

        // Effects
        job.status = JobStatus.Completed;
        _storePrescriptionReceipt(r.jobId, r);
        ReceiptLib.Receipt memory formR = _formReceipt[r.jobId];
        _splitEscrow(r.jobId, formR.agent, r.agent);

        // Interactions
        athleteSBT.appendReceipt(
            job.athlete,
            IAthleteSBT.ReceiptRef({
                jobId: r.jobId,
                ipfsCid: r.ipfsCid,
                summaryHash: r.summaryHash,
                timestamp: uint64(block.timestamp),
                formAgent: formR.agent,
                prescriptionAgent: r.agent
            })
        );

        emit PrescriptionSubmitted(r.jobId, r.agent, r.ipfsCid, r.summaryHash, r.summary);
    }

    /// @inheritdoc IVeloOrchestrator
    function cancelExpired(bytes32 jobId) external override nonReentrant {
        Job storage job = _jobs[jobId];
        if (job.status == JobStatus.None) revert JobNotFound();
        if (job.status == JobStatus.Completed || job.status == JobStatus.Cancelled) {
            revert JobNotRequested();
        }
        if (block.timestamp <= job.deadline) revert DeadlineNotReached();
        if (msg.sender != job.coach) revert OnlyCoach(job.coach);

        job.status = JobStatus.Cancelled;
        _refundEscrow(jobId, job.coach);
        emit JobCancelled(jobId, msg.sender);
    }

    /// @inheritdoc IVeloOrchestrator
    function withdraw() external override {
        uint256 amount = _withdraw(payable(msg.sender));
        emit AgentWithdrawn(msg.sender, amount);
    }

    /// @notice Pause all state-mutating entrypoints (`payJob`, `submitFormReceipt`,
    ///         `submitPrescription`). Caller must hold `PAUSER_ROLE`.
    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    /// @notice Resume the contract after a pause. Caller must hold `PAUSER_ROLE`.
    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    /// @notice Update the minimum native-token fee a coach must pay per job.
    /// @dev    Caller must hold `FEE_ADMIN_ROLE`. Emits `MinJobFeeUpdated`.
    /// @param newFee The new minimum fee, in wei.
    function setMinJobFee(uint256 newFee) external onlyRole(FEE_ADMIN_ROLE) {
        uint256 oldFee = minJobFee;
        minJobFee = newFee;
        emit MinJobFeeUpdated(oldFee, newFee);
    }

    /// @inheritdoc IVeloOrchestrator
    function getJob(bytes32 jobId) external view override returns (Job memory) {
        Job memory j = _jobs[jobId];
        if (j.status == JobStatus.None) revert JobNotFound();
        return j;
    }

    /// @inheritdoc IVeloOrchestrator
    function getFormReceipt(bytes32 jobId)
        external
        view
        override
        returns (ReceiptLib.Receipt memory)
    {
        ReceiptLib.Receipt memory r = _formReceipt[jobId];
        if (r.agent == address(0)) revert FormReceiptMissing();
        return r;
    }

    /// @inheritdoc IVeloOrchestrator
    function getPrescriptionReceipt(bytes32 jobId)
        external
        view
        override
        returns (ReceiptLib.Receipt memory)
    {
        return _prescriptionReceipt[jobId];
    }

    /// @notice Exposes the EIP-712 domain separator to off-chain signers.
    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    function _minJobFee() internal view override returns (uint256) {
        return minJobFee;
    }

    /// @dev Resolve multiple inheritance of `supportsInterface` (AccessControl).
    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(AccessControl)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}

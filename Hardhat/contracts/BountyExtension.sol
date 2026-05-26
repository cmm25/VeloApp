// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {ReceiptLib} from "./libraries/ReceiptLib.sol";
import {AgentRegistry} from "./AgentRegistry.sol";
import {Reputation} from "./Reputation.sol";

/// @title BountyExtension
/// @notice Standalone bounty marketplace: poster escrows funds, registered
///         agents bid, poster accepts a bid, the lead agent may sub-contract
///         to other registered agents, and on settle the escrow is split
///         pull-payment style by the supplied `splits` array.
/// @dev    NatSpec scope decision: this contract does NOT append to
///         AthleteSBT. v1 keeps the SBT a record of the direct-pay flow only;
///         bounty receipts are queryable from this contract's events. A
///         future version may bridge selected bounty completions into the SBT
///         via a separate appender role.
///
///         EIP-712 domain is `("VeloBounty","1")`. Agent receipts are signed
///         against this contract's domain separator and re-use `ReceiptLib`
///         for typed-data hashing. Each agent has its own monotonic nonce.
contract BountyExtension is EIP712, ReentrancyGuard {
    enum BountyStatus {
        None,
        Open,
        Accepted,
        Settled,
        Expired
    }

    struct Bounty {
        address poster;
        address athlete;
        string videoCid;
        uint64 deadline;
        uint64 createdAt;
        uint256 escrow;
        address leadAgent;
        uint256 acceptedFee;
        BountyStatus status;
        bytes32[] requiredSkills;
    }

    struct Bid {
        address agent;
        uint256 proposedFee;
        uint64 proposedDeadline;
        uint64 placedAt;
    }

    struct Split {
        address agent;
        uint16 bps;
    }

    AgentRegistry public immutable agentRegistry;
    Reputation public immutable reputation;
    uint256 public immutable minBountyFee;

    uint16 internal constant BPS_DENOM = 10_000;

    uint256 public nextBountyId = 1;

    mapping(uint256 => Bounty) private _bounties;
    mapping(uint256 => Bid[]) private _bids;
    mapping(uint256 => address[]) private _subAgents;
    mapping(uint256 => mapping(address => bool)) private _isSubAgent;
    mapping(uint256 => mapping(address => bool)) private _settled;
    mapping(address => uint256) public pendingOf;
    mapping(address => uint256) public nonceOf;

    // ──────────────────── events ────────────────────

    event BountyPosted(
        uint256 indexed bountyId,
        address indexed poster,
        address indexed athlete,
        string videoCid,
        uint256 escrow,
        uint64 deadline,
        bytes32[] requiredSkills
    );
    event BidPlaced(
        uint256 indexed bountyId,
        uint256 indexed bidId,
        address indexed agent,
        uint256 proposedFee,
        uint64 proposedDeadline
    );
    event BidAccepted(
        uint256 indexed bountyId,
        uint256 indexed bidId,
        address indexed leadAgent,
        uint256 acceptedFee,
        uint256 refund
    );
    event JobStarted(uint256 indexed bountyId, address indexed leadAgent, uint64 deadline);
    event SubContracted(uint256 indexed bountyId, address indexed leadAgent, address indexed subAgent);
    event Settled(
        uint256 indexed bountyId,
        address indexed leadAgent,
        uint256 totalPaid,
        Split[] splits
    );
    event BountyExpired(uint256 indexed bountyId, address indexed poster, uint256 refund);
    event Withdrawn(address indexed to, uint256 amount);
    event ReceiptRecorded(
        uint256 indexed bountyId,
        address indexed agent,
        string ipfsCid,
        bytes32 summaryHash,
        string summary
    );

    // ──────────────────── errors ────────────────────

    error ZeroAddress();
    error FeeBelowMin(uint256 sent);
    error DeadlinePassed();
    error BountyNotFound();
    error BountyNotOpen();
    error BountyNotAccepted();
    error NotPoster();
    error NotLeadAgent();
    error AgentNotRegistered(address agent);
    error AgentMissingSkill(address agent);
    error BidNotFound();
    error DeadlineNotReached();
    error EmptyEscrow();
    error TransferFailed();
    error SplitsOverflow(uint256 totalBps);
    error UnknownSplitRecipient(address agent);
    error DuplicateSplitRecipient(address agent);
    error SplitMissingReceipt(address agent);
    error ReceiptJobIdMismatch();
    error AgentAlreadySettled(address agent);
    error ReceiptAgentNotInJob(address agent);
    error NoSubAgents();

    constructor(
        address registry,
        address reputation_,
        uint256 minBountyFee_
    ) EIP712("VeloBounty", "1") {
        if (registry == address(0) || reputation_ == address(0)) revert ZeroAddress();
        agentRegistry = AgentRegistry(registry);
        reputation = Reputation(reputation_);
        minBountyFee = minBountyFee_;
    }

    // ──────────────────── poster lifecycle ────────────────────

    function postBounty(
        address athlete,
        string calldata videoCid,
        uint64 deadline,
        bytes32[] calldata requiredSkills
    ) external payable nonReentrant returns (uint256 bountyId) {
        if (athlete == address(0)) revert ZeroAddress();
        if (msg.value < minBountyFee) revert FeeBelowMin(msg.value);
        if (deadline <= block.timestamp) revert DeadlinePassed();

        bountyId = nextBountyId++;
        Bounty storage b = _bounties[bountyId];
        b.poster = msg.sender;
        b.athlete = athlete;
        b.videoCid = videoCid;
        b.deadline = deadline;
        b.createdAt = uint64(block.timestamp);
        b.escrow = msg.value;
        b.status = BountyStatus.Open;
        b.requiredSkills = requiredSkills;

        emit BountyPosted(
            bountyId,
            msg.sender,
            athlete,
            videoCid,
            msg.value,
            deadline,
            requiredSkills
        );
    }

    function bid(
        uint256 bountyId,
        uint256 proposedFee,
        uint64 proposedDeadline
    ) external returns (uint256 bidId) {
        Bounty storage b = _bounties[bountyId];
        if (b.status == BountyStatus.None) revert BountyNotFound();
        if (b.status != BountyStatus.Open) revert BountyNotOpen();
        if (block.timestamp >= b.deadline) revert DeadlinePassed();

        if (!agentRegistry.isActive(msg.sender)) revert AgentNotRegistered(msg.sender);
        if (!_hasMatchingSkill(b.requiredSkills, msg.sender)) {
            revert AgentMissingSkill(msg.sender);
        }

        bidId = _bids[bountyId].length;
        _bids[bountyId].push(
            Bid({
                agent: msg.sender,
                proposedFee: proposedFee,
                proposedDeadline: proposedDeadline,
                placedAt: uint64(block.timestamp)
            })
        );
        emit BidPlaced(bountyId, bidId, msg.sender, proposedFee, proposedDeadline);
    }

    function accept(uint256 bountyId, uint256 bidId) external nonReentrant {
        Bounty storage b = _bounties[bountyId];
        if (b.status == BountyStatus.None) revert BountyNotFound();
        if (b.status != BountyStatus.Open) revert BountyNotOpen();
        if (msg.sender != b.poster) revert NotPoster();
        if (bidId >= _bids[bountyId].length) revert BidNotFound();

        Bid storage bd = _bids[bountyId][bidId];
        uint256 fee = bd.proposedFee;
        if (fee == 0 || fee > b.escrow) revert FeeBelowMin(fee);

        uint256 refund = b.escrow - fee;
        b.escrow = fee;
        b.leadAgent = bd.agent;
        b.acceptedFee = fee;
        b.status = BountyStatus.Accepted;
        if (refund > 0) {
            pendingOf[b.poster] += refund;
        }

        emit BidAccepted(bountyId, bidId, bd.agent, fee, refund);
        emit JobStarted(bountyId, bd.agent, b.deadline);
    }

    // ──────────────────── lead/agent lifecycle ────────────────────

    function subContract(uint256 bountyId, address subAgent) external {
        Bounty storage b = _bounties[bountyId];
        if (b.status == BountyStatus.None) revert BountyNotFound();
        if (b.status != BountyStatus.Accepted) revert BountyNotAccepted();
        if (msg.sender != b.leadAgent) revert NotLeadAgent();
        if (subAgent == address(0)) revert ZeroAddress();
        if (!agentRegistry.isRegistered(subAgent)) revert AgentNotRegistered(subAgent);
        if (subAgent == b.leadAgent || _isSubAgent[bountyId][subAgent]) return;

        _isSubAgent[bountyId][subAgent] = true;
        _subAgents[bountyId].push(subAgent);

        emit SubContracted(bountyId, msg.sender, subAgent);
    }

    function settleWithSplits(
        uint256 bountyId,
        ReceiptLib.Receipt calldata leadReceipt,
        bytes calldata leadSig,
        ReceiptLib.Receipt[] calldata subReceipts,
        bytes[] calldata subSigs,
        Split[] calldata splits
    ) external nonReentrant {
        Bounty storage b = _bounties[bountyId];
        if (b.status == BountyStatus.None) revert BountyNotFound();
        if (b.status != BountyStatus.Accepted) revert BountyNotAccepted();
        require(subReceipts.length == subSigs.length, "length mismatch");

        bytes32 expectedJobId = bytes32(bountyId);

        // Lead receipt.
        _verifyReceipt(b, leadReceipt, leadSig, expectedJobId, b.leadAgent);
        emit ReceiptRecorded(
            bountyId,
            leadReceipt.agent,
            leadReceipt.ipfsCid,
            leadReceipt.summaryHash,
            leadReceipt.summary
        );

        // Sub receipts.
        for (uint256 i = 0; i < subReceipts.length; i++) {
            ReceiptLib.Receipt calldata r = subReceipts[i];
            if (!_isSubAgent[bountyId][r.agent]) revert ReceiptAgentNotInJob(r.agent);
            _verifyReceipt(b, r, subSigs[i], expectedJobId, r.agent);
            emit ReceiptRecorded(
                bountyId,
                r.agent,
                r.ipfsCid,
                r.summaryHash,
                r.summary
            );
        }

        // Compute split totals (lead receives remainder). Reject duplicate
        // recipients so reputation cannot be inflated by repeated entries for
        // the same agent within one settlement.
        uint256 total = b.escrow;
        uint256 totalBps;
        for (uint256 i = 0; i < splits.length; i++) {
            address agent = splits[i].agent;
            if (agent == b.leadAgent) revert UnknownSplitRecipient(agent);
            if (!_isSubAgent[bountyId][agent]) revert UnknownSplitRecipient(agent);
            for (uint256 j = 0; j < i; j++) {
                if (splits[j].agent == agent) revert DuplicateSplitRecipient(agent);
            }
            // Each split recipient must have produced a verified sub-receipt
            // in this settlement. Reputation may only mutate after a signed
            // receipt is on record.
            bool seen = false;
            for (uint256 k = 0; k < subReceipts.length; k++) {
                if (subReceipts[k].agent == agent) {
                    seen = true;
                    break;
                }
            }
            if (!seen) revert SplitMissingReceipt(agent);
            totalBps += splits[i].bps;
        }
        if (totalBps > BPS_DENOM) revert SplitsOverflow(totalBps);

        // Effects: clear escrow, distribute.
        b.escrow = 0;
        b.status = BountyStatus.Settled;

        uint256 distributed;
        for (uint256 i = 0; i < splits.length; i++) {
            uint256 share = (total * splits[i].bps) / BPS_DENOM;
            if (share > 0) {
                pendingOf[splits[i].agent] += share;
                reputation.credit(splits[i].agent, share);
                distributed += share;
            }
        }
        uint256 leadShare = total - distributed;
        if (leadShare > 0) {
            pendingOf[b.leadAgent] += leadShare;
            reputation.credit(b.leadAgent, leadShare);
        }

        emit Settled(bountyId, b.leadAgent, total, splits);
    }

    function expireBounty(uint256 bountyId) external nonReentrant {
        Bounty storage b = _bounties[bountyId];
        if (b.status == BountyStatus.None) revert BountyNotFound();
        if (b.status != BountyStatus.Open) revert BountyNotOpen();
        if (block.timestamp < b.deadline) revert DeadlineNotReached();
        uint256 amount = b.escrow;
        if (amount == 0) revert EmptyEscrow();

        b.escrow = 0;
        b.status = BountyStatus.Expired;
        pendingOf[b.poster] += amount;
        emit BountyExpired(bountyId, b.poster, amount);
    }

    function withdraw() external nonReentrant returns (uint256) {
        uint256 amount = pendingOf[msg.sender];
        if (amount == 0) revert EmptyEscrow();
        pendingOf[msg.sender] = 0;
        (bool ok, ) = payable(msg.sender).call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit Withdrawn(msg.sender, amount);
        return amount;
    }

    // ──────────────────── views ────────────────────

    function getBounty(uint256 bountyId) external view returns (Bounty memory) {
        Bounty memory b = _bounties[bountyId];
        if (b.status == BountyStatus.None) revert BountyNotFound();
        return b;
    }

    function getBids(uint256 bountyId) external view returns (Bid[] memory) {
        return _bids[bountyId];
    }

    function getSubAgents(uint256 bountyId) external view returns (address[] memory) {
        return _subAgents[bountyId];
    }

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    // ──────────────────── internal ────────────────────

    function _verifyReceipt(
        Bounty storage b,
        ReceiptLib.Receipt calldata r,
        bytes calldata sig,
        bytes32 expectedJobId,
        address expectedAgent
    ) private {
        if (r.jobId != expectedJobId) revert ReceiptJobIdMismatch();
        if (r.agent != expectedAgent) revert ReceiptAgentNotInJob(r.agent);
        if (r.deadline != 0 && r.deadline > b.deadline) revert DeadlinePassed();
        if (_settled[uint256(expectedJobId)][r.agent]) revert AgentAlreadySettled(r.agent);
        uint256 expectedNonce = nonceOf[r.agent];
        require(r.nonce == expectedNonce, "bad nonce");
        ReceiptLib.validate(r);
        ReceiptLib.verify(r, _domainSeparatorV4(), sig);
        unchecked {
            nonceOf[r.agent] = expectedNonce + 1;
        }
        _settled[uint256(expectedJobId)][r.agent] = true;
    }

    function _hasMatchingSkill(bytes32[] memory required, address agent)
        private
        view
        returns (bool)
    {
        if (required.length == 0) return true;
        for (uint256 i = 0; i < required.length; i++) {
            if (agentRegistry.hasSkill(agent, required[i])) return true;
        }
        return false;
    }
}

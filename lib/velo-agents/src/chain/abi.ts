export const BOUNTY_EXTENSION_ABI = [
  // Events
  "event BidAccepted(uint256 indexed bountyId, uint256 indexed bidId, address indexed leadAgent, uint256 acceptedFee, uint256 refund)",
  "event JobStarted(uint256 indexed bountyId, address indexed leadAgent, uint64 deadline)",
  "event Settled(uint256 indexed bountyId, address indexed leadAgent, uint256 totalPaid, (address agent, uint16 bps)[] splits)",

  // State-mutating
  "function settleWithSplits(uint256 bountyId, (bytes32 jobId, address agent, string ipfsCid, bytes32 summaryHash, string summary, uint256 nonce, uint64 deadline, bytes32 priorReceiptHash) leadReceipt, bytes leadSig, (bytes32 jobId, address agent, string ipfsCid, bytes32 summaryHash, string summary, uint256 nonce, uint64 deadline, bytes32 priorReceiptHash)[] subReceipts, bytes[] subSigs, (address agent, uint16 bps)[] splits)",
  "function withdraw()",

  // Views
  "function getBounty(uint256 bountyId) view returns ((address poster, address athlete, string videoCid, uint64 deadline, uint64 createdAt, uint256 escrow, address leadAgent, uint256 acceptedFee, uint8 status, bytes32[] requiredSkills))",
  "function nonceOf(address agent) view returns (uint256)",
  "function domainSeparator() view returns (bytes32)",
] as const;

export interface BountyAcceptedEvent {
  bountyId: bigint;
  bidId: bigint;
  leadAgent: string;
  acceptedFee: bigint;
  videoCid: string;
  athlete: string;
  deadline: bigint;
}

export const ORCHESTRATOR_ABI = [
  // Events
  "event JobRequested(bytes32 indexed jobId, address indexed coach, address indexed athlete, string videoCid, uint256 fee, uint64 deadline)",
  "event FormReceiptSubmitted(bytes32 indexed jobId, address indexed agent, string ipfsCid, bytes32 summaryHash, string summary)",
  "event PrescriptionSubmitted(bytes32 indexed jobId, address indexed agent, string ipfsCid, bytes32 summaryHash, string summary)",
  "event JobCancelled(bytes32 indexed jobId, address indexed coach)",

  // State-mutating
  "function submitFormReceipt((bytes32 jobId, address agent, string ipfsCid, bytes32 summaryHash, string summary, uint256 nonce, uint64 deadline, bytes32 priorReceiptHash) r, bytes signature)",
  "function submitPrescription((bytes32 jobId, address agent, string ipfsCid, bytes32 summaryHash, string summary, uint256 nonce, uint64 deadline, bytes32 priorReceiptHash) r, bytes signature)",
  "function withdraw()",

  // Views
  "function getJob(bytes32 jobId) view returns ((address coach, address athlete, string videoCid, uint256 fee, uint64 createdAt, uint64 deadline, uint8 status))",
  "function getFormReceipt(bytes32 jobId) view returns ((bytes32 jobId, address agent, string ipfsCid, bytes32 summaryHash, string summary, uint256 nonce, uint64 deadline, bytes32 priorReceiptHash))",
  "function getPrescriptionReceipt(bytes32 jobId) view returns ((bytes32 jobId, address agent, string ipfsCid, bytes32 summaryHash, string summary, uint256 nonce, uint64 deadline, bytes32 priorReceiptHash))",
  "function nonceOf(address agent) view returns (uint256)",
  "function minJobFee() view returns (uint256)",
  "function domainSeparator() view returns (bytes32)",
] as const;

export const AGENT_REGISTRY_ABI = [
  "function isActive(address agent) view returns (bool)",
  "function isRegistered(address agent) view returns (bool)",
  "function register(string name, string endpoint, bytes32[] skills, uint256 feeWei)",
  "function update(string name, string endpoint, bytes32[] skills, uint256 feeWei)",
  "function setActive(bool active)",
  "function getAgent(address agent) view returns ((string name, string endpoint, bytes32[] skills, uint256 feeWei, bool active, bool exists, uint64 registeredAt, uint64 updatedAt))",
  "function agentsBySkill(bytes32 skill) view returns (address[])",
  "function listAgents() view returns (address[])",
] as const;

// Job status enum mirrors JobStatus in IVeloOrchestrator.sol
export enum JobStatus {
  None = 0,
  Requested = 1,
  FormSubmitted = 2,
  Completed = 3,
  Cancelled = 4,
}

export interface JobEvent {
  jobId: string;
  coach: string;
  athlete: string;
  videoCid: string;
  fee: bigint;
  deadline: bigint;
}

export interface FormReceiptEvent {
  jobId: string;
  agent: string;
  ipfsCid: string;
  summaryHash: string;
  summary: string;
}

export interface ReceiptStruct {
  jobId: string;
  agent: string;
  ipfsCid: string;
  summaryHash: string;
  summary: string;
  nonce: bigint;
  deadline: bigint;
  priorReceiptHash: string;
}

export const ZERO_BYTES32 =
  "0x0000000000000000000000000000000000000000000000000000000000000000";

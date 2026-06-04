// AUTO-DERIVED from lib/contracts/artifacts-hh — minimal frontend slice. Do not hand-edit large surfaces.
export const veloOrchestratorAbi = [
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "admin",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "registry",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "sbt",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "minJobFee_",
        "type": "uint256"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "constructor"
  },
  {
    "inputs": [],
    "name": "AccessControlBadConfirmation",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "account",
        "type": "address"
      },
      {
        "internalType": "bytes32",
        "name": "neededRole",
        "type": "bytes32"
      }
    ],
    "name": "AccessControlUnauthorizedAccount",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "expected",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "recovered",
        "type": "address"
      }
    ],
    "name": "AgentMismatch",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "expected",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "actual",
        "type": "uint256"
      }
    ],
    "name": "BadNonce",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "CidTooLong",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "DeadlineExpired",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "DeadlineNotReached",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "ECDSAInvalidSignature",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "length",
        "type": "uint256"
      }
    ],
    "name": "ECDSAInvalidSignatureLength",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "s",
        "type": "bytes32"
      }
    ],
    "name": "ECDSAInvalidSignatureS",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "EnforcedPause",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "EscrowEmpty",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "ExpectedPause",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "FormReceiptAlreadyExists",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "FormReceiptMissing",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "sent",
        "type": "uint256"
      }
    ],
    "name": "InsufficientFee",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "InvalidShortString",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "InvalidSignature",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "JobAlreadyExists",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "JobIdMismatch",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "JobNotFormSubmitted",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "JobNotFound",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "JobNotRequested",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "coach",
        "type": "address"
      }
    ],
    "name": "OnlyCoach",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "PrescriptionAlreadyExists",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "expected",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "actual",
        "type": "bytes32"
      }
    ],
    "name": "PriorReceiptMismatch",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "uint64",
        "name": "receiptDeadline",
        "type": "uint64"
      },
      {
        "internalType": "uint64",
        "name": "jobDeadline",
        "type": "uint64"
      }
    ],
    "name": "ReceiptDeadlineAfterJob",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "ReentrancyGuardReentrantCall",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "string",
        "name": "str",
        "type": "string"
      }
    ],
    "name": "StringTooLong",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "SummaryEmpty",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "SummaryHashZero",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "SummaryTooLong",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "TransferFailed",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "agent",
        "type": "address"
      }
    ],
    "name": "UnregisteredAgent",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "ZeroAddress",
    "type": "error"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "agent",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      }
    ],
    "name": "AgentWithdrawn",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "jobId",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "agent",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "string",
        "name": "ipfsCid",
        "type": "string"
      },
      {
        "indexed": false,
        "internalType": "bytes32",
        "name": "summaryHash",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "string",
        "name": "summary",
        "type": "string"
      }
    ],
    "name": "FormReceiptSubmitted",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "jobId",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "by",
        "type": "address"
      }
    ],
    "name": "JobCancelled",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "jobId",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "coach",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "athlete",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "string",
        "name": "videoCid",
        "type": "string"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "fee",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint64",
        "name": "deadline",
        "type": "uint64"
      }
    ],
    "name": "JobRequested",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "jobId",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "agent",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "string",
        "name": "ipfsCid",
        "type": "string"
      },
      {
        "indexed": false,
        "internalType": "bytes32",
        "name": "summaryHash",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "string",
        "name": "summary",
        "type": "string"
      }
    ],
    "name": "PrescriptionSubmitted",
    "type": "event"
  },
  {
    "inputs": [],
    "name": "athleteSBT",
    "outputs": [
      {
        "internalType": "contract IAthleteSBT",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "jobId",
        "type": "bytes32"
      }
    ],
    "name": "cancelExpired",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "domainSeparator",
    "outputs": [
      {
        "internalType": "bytes32",
        "name": "",
        "type": "bytes32"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "jobId",
        "type": "bytes32"
      }
    ],
    "name": "getFormReceipt",
    "outputs": [
      {
        "components": [
          {
            "internalType": "bytes32",
            "name": "jobId",
            "type": "bytes32"
          },
          {
            "internalType": "address",
            "name": "agent",
            "type": "address"
          },
          {
            "internalType": "string",
            "name": "ipfsCid",
            "type": "string"
          },
          {
            "internalType": "bytes32",
            "name": "summaryHash",
            "type": "bytes32"
          },
          {
            "internalType": "string",
            "name": "summary",
            "type": "string"
          },
          {
            "internalType": "uint256",
            "name": "nonce",
            "type": "uint256"
          },
          {
            "internalType": "uint64",
            "name": "deadline",
            "type": "uint64"
          },
          {
            "internalType": "bytes32",
            "name": "priorReceiptHash",
            "type": "bytes32"
          }
        ],
        "internalType": "struct ReceiptLib.Receipt",
        "name": "",
        "type": "tuple"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "jobId",
        "type": "bytes32"
      }
    ],
    "name": "getJob",
    "outputs": [
      {
        "components": [
          {
            "internalType": "address",
            "name": "coach",
            "type": "address"
          },
          {
            "internalType": "address",
            "name": "athlete",
            "type": "address"
          },
          {
            "internalType": "string",
            "name": "videoCid",
            "type": "string"
          },
          {
            "internalType": "uint256",
            "name": "fee",
            "type": "uint256"
          },
          {
            "internalType": "uint64",
            "name": "createdAt",
            "type": "uint64"
          },
          {
            "internalType": "uint64",
            "name": "deadline",
            "type": "uint64"
          },
          {
            "internalType": "enum IVeloOrchestrator.JobStatus",
            "name": "status",
            "type": "uint8"
          }
        ],
        "internalType": "struct IVeloOrchestrator.Job",
        "name": "",
        "type": "tuple"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "jobId",
        "type": "bytes32"
      }
    ],
    "name": "getPrescriptionReceipt",
    "outputs": [
      {
        "components": [
          {
            "internalType": "bytes32",
            "name": "jobId",
            "type": "bytes32"
          },
          {
            "internalType": "address",
            "name": "agent",
            "type": "address"
          },
          {
            "internalType": "string",
            "name": "ipfsCid",
            "type": "string"
          },
          {
            "internalType": "bytes32",
            "name": "summaryHash",
            "type": "bytes32"
          },
          {
            "internalType": "string",
            "name": "summary",
            "type": "string"
          },
          {
            "internalType": "uint256",
            "name": "nonce",
            "type": "uint256"
          },
          {
            "internalType": "uint64",
            "name": "deadline",
            "type": "uint64"
          },
          {
            "internalType": "bytes32",
            "name": "priorReceiptHash",
            "type": "bytes32"
          }
        ],
        "internalType": "struct ReceiptLib.Receipt",
        "name": "",
        "type": "tuple"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "minJobFee",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "athlete",
        "type": "address"
      },
      {
        "internalType": "string",
        "name": "videoCid",
        "type": "string"
      },
      {
        "internalType": "uint64",
        "name": "deadline",
        "type": "uint64"
      }
    ],
    "name": "payJob",
    "outputs": [
      {
        "internalType": "bytes32",
        "name": "jobId",
        "type": "bytes32"
      }
    ],
    "stateMutability": "payable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "withdraw",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "components": [
          { "internalType": "bytes32", "name": "jobId", "type": "bytes32" },
          { "internalType": "address", "name": "agent", "type": "address" },
          { "internalType": "string", "name": "ipfsCid", "type": "string" },
          { "internalType": "bytes32", "name": "summaryHash", "type": "bytes32" },
          { "internalType": "string", "name": "summary", "type": "string" },
          { "internalType": "uint256", "name": "nonce", "type": "uint256" },
          { "internalType": "uint64", "name": "deadline", "type": "uint64" },
          { "internalType": "bytes32", "name": "priorReceiptHash", "type": "bytes32" }
        ],
        "internalType": "struct ReceiptLib.Receipt",
        "name": "r",
        "type": "tuple"
      },
      { "internalType": "bytes", "name": "signature", "type": "bytes" }
    ],
    "name": "submitFormReceipt",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "components": [
          { "internalType": "bytes32", "name": "jobId", "type": "bytes32" },
          { "internalType": "address", "name": "agent", "type": "address" },
          { "internalType": "string", "name": "ipfsCid", "type": "string" },
          { "internalType": "bytes32", "name": "summaryHash", "type": "bytes32" },
          { "internalType": "string", "name": "summary", "type": "string" },
          { "internalType": "uint256", "name": "nonce", "type": "uint256" },
          { "internalType": "uint64", "name": "deadline", "type": "uint64" },
          { "internalType": "bytes32", "name": "priorReceiptHash", "type": "bytes32" }
        ],
        "internalType": "struct ReceiptLib.Receipt",
        "name": "r",
        "type": "tuple"
      },
      { "internalType": "bytes", "name": "signature", "type": "bytes" }
    ],
    "name": "submitPrescription",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  }
] as const;

export const athleteSbtAbi = [
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "admin",
        "type": "address"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "constructor"
  },
  {
    "inputs": [],
    "name": "AccessControlBadConfirmation",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "account",
        "type": "address"
      },
      {
        "internalType": "bytes32",
        "name": "neededRole",
        "type": "bytes32"
      }
    ],
    "name": "AccessControlUnauthorizedAccount",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "sender",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "tokenId",
        "type": "uint256"
      },
      {
        "internalType": "address",
        "name": "owner",
        "type": "address"
      }
    ],
    "name": "ERC721IncorrectOwner",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "operator",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "tokenId",
        "type": "uint256"
      }
    ],
    "name": "ERC721InsufficientApproval",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "approver",
        "type": "address"
      }
    ],
    "name": "ERC721InvalidApprover",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "operator",
        "type": "address"
      }
    ],
    "name": "ERC721InvalidOperator",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "owner",
        "type": "address"
      }
    ],
    "name": "ERC721InvalidOwner",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "receiver",
        "type": "address"
      }
    ],
    "name": "ERC721InvalidReceiver",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "sender",
        "type": "address"
      }
    ],
    "name": "ERC721InvalidSender",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "tokenId",
        "type": "uint256"
      }
    ],
    "name": "ERC721NonexistentToken",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "SoulboundNonApprovable",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "SoulboundNonTransferable",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "value",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "length",
        "type": "uint256"
      }
    ],
    "name": "StringsInsufficientHexLength",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "ZeroAthlete",
    "type": "error"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "athlete",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "tokenId",
        "type": "uint256"
      },
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "jobId",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "string",
        "name": "ipfsCid",
        "type": "string"
      }
    ],
    "name": "ReceiptAppended",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "from",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "to",
        "type": "address"
      },
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "tokenId",
        "type": "uint256"
      }
    ],
    "name": "Transfer",
    "type": "event"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "tokenId",
        "type": "uint256"
      }
    ],
    "name": "athleteOf",
    "outputs": [
      {
        "internalType": "address",
        "name": "athlete",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "owner",
        "type": "address"
      }
    ],
    "name": "balanceOf",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "name",
    "outputs": [
      {
        "internalType": "string",
        "name": "",
        "type": "string"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "tokenId",
        "type": "uint256"
      }
    ],
    "name": "ownerOf",
    "outputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "athlete",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "index",
        "type": "uint256"
      }
    ],
    "name": "receiptAt",
    "outputs": [
      {
        "components": [
          {
            "internalType": "bytes32",
            "name": "jobId",
            "type": "bytes32"
          },
          {
            "internalType": "string",
            "name": "ipfsCid",
            "type": "string"
          },
          {
            "internalType": "bytes32",
            "name": "summaryHash",
            "type": "bytes32"
          },
          {
            "internalType": "uint64",
            "name": "timestamp",
            "type": "uint64"
          },
          {
            "internalType": "address",
            "name": "formAgent",
            "type": "address"
          },
          {
            "internalType": "address",
            "name": "prescriptionAgent",
            "type": "address"
          }
        ],
        "internalType": "struct IAthleteSBT.ReceiptRef",
        "name": "",
        "type": "tuple"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "athlete",
        "type": "address"
      }
    ],
    "name": "receiptCount",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "symbol",
    "outputs": [
      {
        "internalType": "string",
        "name": "",
        "type": "string"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "athlete",
        "type": "address"
      }
    ],
    "name": "tokenIdOf",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "tokenId",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "tokenId",
        "type": "uint256"
      }
    ],
    "name": "tokenURI",
    "outputs": [
      {
        "internalType": "string",
        "name": "",
        "type": "string"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  }
] as const;

// ──────────────────── AgentRegistry ────────────────────

export const agentRegistryAbi = [
  {
    type: "function",
    name: "register",
    stateMutability: "nonpayable",
    inputs: [
      { name: "name", type: "string" },
      { name: "endpoint", type: "string" },
      { name: "skills", type: "bytes32[]" },
      { name: "feeWei", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "update",
    stateMutability: "nonpayable",
    inputs: [
      { name: "name", type: "string" },
      { name: "endpoint", type: "string" },
      { name: "skills", type: "bytes32[]" },
      { name: "feeWei", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "setActive",
    stateMutability: "nonpayable",
    inputs: [{ name: "active", type: "bool" }],
    outputs: [],
  },
  {
    type: "function",
    name: "getAgent",
    stateMutability: "view",
    inputs: [{ name: "agent", type: "address" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "name", type: "string" },
          { name: "endpoint", type: "string" },
          { name: "skills", type: "bytes32[]" },
          { name: "feeWei", type: "uint256" },
          { name: "active", type: "bool" },
          { name: "exists", type: "bool" },
          { name: "registeredAt", type: "uint64" },
          { name: "updatedAt", type: "uint64" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "listAgents",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address[]" }],
  },
  {
    type: "function",
    name: "agentsBySkill",
    stateMutability: "view",
    inputs: [{ name: "skill", type: "bytes32" }],
    outputs: [{ name: "", type: "address[]" }],
  },
  {
    type: "function",
    name: "isActive",
    stateMutability: "view",
    inputs: [{ name: "agent", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "isRegistered",
    stateMutability: "view",
    inputs: [{ name: "agent", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "event",
    name: "AgentRegistered",
    inputs: [
      { name: "agent", type: "address", indexed: true },
      { name: "name", type: "string", indexed: false },
      { name: "endpoint", type: "string", indexed: false },
      { name: "skills", type: "bytes32[]", indexed: false },
      { name: "feeWei", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "AgentUpdated",
    inputs: [
      { name: "agent", type: "address", indexed: true },
      { name: "name", type: "string", indexed: false },
      { name: "endpoint", type: "string", indexed: false },
      { name: "skills", type: "bytes32[]", indexed: false },
      { name: "feeWei", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "AgentActiveChanged",
    inputs: [
      { name: "agent", type: "address", indexed: true },
      { name: "active", type: "bool", indexed: false },
    ],
  },
] as const;

// ──────────────────── Reputation ────────────────────

export const reputationAbi = [
  {
    type: "function",
    name: "statsOf",
    stateMutability: "view",
    inputs: [{ name: "agent", type: "address" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "jobsCompleted", type: "uint64" },
          { name: "totalEarnedWei", type: "uint128" },
          { name: "lastActivity", type: "uint64" },
          { name: "rollingScore", type: "uint64" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "jobsCompleted",
    stateMutability: "view",
    inputs: [{ name: "agent", type: "address" }],
    outputs: [{ name: "", type: "uint64" }],
  },
  {
    type: "function",
    name: "rollingScore",
    stateMutability: "view",
    inputs: [{ name: "agent", type: "address" }],
    outputs: [{ name: "", type: "uint64" }],
  },
  {
    type: "event",
    name: "ReputationCredited",
    inputs: [
      { name: "agent", type: "address", indexed: true },
      { name: "earnedWei", type: "uint256", indexed: false },
      { name: "jobsCompleted", type: "uint64", indexed: false },
      { name: "totalEarnedWei", type: "uint128", indexed: false },
      { name: "rollingScore", type: "uint64", indexed: false },
    ],
  },
] as const;

// ──────────────────── BountyExtension ────────────────────

const BOUNTY_RECEIPT_TUPLE = {
  name: "r",
  type: "tuple",
  components: [
    { name: "jobId", type: "bytes32" },
    { name: "agent", type: "address" },
    { name: "ipfsCid", type: "string" },
    { name: "summaryHash", type: "bytes32" },
    { name: "summary", type: "string" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint64" },
    { name: "priorReceiptHash", type: "bytes32" },
  ],
} as const;

export const bountyExtensionAbi = [
  {
    type: "function",
    name: "postBounty",
    stateMutability: "payable",
    inputs: [
      { name: "athlete", type: "address" },
      { name: "videoCid", type: "string" },
      { name: "deadline", type: "uint64" },
      { name: "requiredSkills", type: "bytes32[]" },
    ],
    outputs: [{ name: "bountyId", type: "uint256" }],
  },
  {
    type: "function",
    name: "bid",
    stateMutability: "nonpayable",
    inputs: [
      { name: "bountyId", type: "uint256" },
      { name: "proposedFee", type: "uint256" },
      { name: "proposedDeadline", type: "uint64" },
    ],
    outputs: [{ name: "bidId", type: "uint256" }],
  },
  {
    type: "function",
    name: "accept",
    stateMutability: "nonpayable",
    inputs: [
      { name: "bountyId", type: "uint256" },
      { name: "bidId", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "subContract",
    stateMutability: "nonpayable",
    inputs: [
      { name: "bountyId", type: "uint256" },
      { name: "subAgent", type: "address" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "settleWithSplits",
    stateMutability: "nonpayable",
    inputs: [
      { name: "bountyId", type: "uint256" },
      BOUNTY_RECEIPT_TUPLE,
      { name: "leadSig", type: "bytes" },
      {
        name: "subReceipts",
        type: "tuple[]",
        components: BOUNTY_RECEIPT_TUPLE.components,
      },
      { name: "subSigs", type: "bytes[]" },
      {
        name: "splits",
        type: "tuple[]",
        components: [
          { name: "agent", type: "address" },
          { name: "bps", type: "uint16" },
        ],
      },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "expireBounty",
    stateMutability: "nonpayable",
    inputs: [{ name: "bountyId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "withdraw",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "nextBountyId",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "getBounty",
    stateMutability: "view",
    inputs: [{ name: "bountyId", type: "uint256" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "poster", type: "address" },
          { name: "athlete", type: "address" },
          { name: "videoCid", type: "string" },
          { name: "deadline", type: "uint64" },
          { name: "createdAt", type: "uint64" },
          { name: "escrow", type: "uint256" },
          { name: "leadAgent", type: "address" },
          { name: "acceptedFee", type: "uint256" },
          { name: "status", type: "uint8" },
          { name: "requiredSkills", type: "bytes32[]" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "getBids",
    stateMutability: "view",
    inputs: [{ name: "bountyId", type: "uint256" }],
    outputs: [
      {
        name: "",
        type: "tuple[]",
        components: [
          { name: "agent", type: "address" },
          { name: "proposedFee", type: "uint256" },
          { name: "proposedDeadline", type: "uint64" },
          { name: "placedAt", type: "uint64" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "getSubAgents",
    stateMutability: "view",
    inputs: [{ name: "bountyId", type: "uint256" }],
    outputs: [{ name: "", type: "address[]" }],
  },
  {
    type: "function",
    name: "pendingOf",
    stateMutability: "view",
    inputs: [{ name: "agent", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "minBountyFee",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "domainSeparator",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "bytes32" }],
  },
  {
    type: "function",
    name: "athleteSbt",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "event",
    name: "BountyPosted",
    inputs: [
      { name: "bountyId", type: "uint256", indexed: true },
      { name: "poster", type: "address", indexed: true },
      { name: "athlete", type: "address", indexed: true },
      { name: "videoCid", type: "string", indexed: false },
      { name: "escrow", type: "uint256", indexed: false },
      { name: "deadline", type: "uint64", indexed: false },
      { name: "requiredSkills", type: "bytes32[]", indexed: false },
    ],
  },
  {
    type: "event",
    name: "BidPlaced",
    inputs: [
      { name: "bountyId", type: "uint256", indexed: true },
      { name: "bidId", type: "uint256", indexed: true },
      { name: "agent", type: "address", indexed: true },
      { name: "proposedFee", type: "uint256", indexed: false },
      { name: "proposedDeadline", type: "uint64", indexed: false },
    ],
  },
  {
    type: "event",
    name: "BidAccepted",
    inputs: [
      { name: "bountyId", type: "uint256", indexed: true },
      { name: "bidId", type: "uint256", indexed: true },
      { name: "leadAgent", type: "address", indexed: true },
      { name: "acceptedFee", type: "uint256", indexed: false },
      { name: "refund", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "JobStarted",
    inputs: [
      { name: "bountyId", type: "uint256", indexed: true },
      { name: "leadAgent", type: "address", indexed: true },
      { name: "deadline", type: "uint64", indexed: false },
    ],
  },
  {
    type: "event",
    name: "SubContracted",
    inputs: [
      { name: "bountyId", type: "uint256", indexed: true },
      { name: "leadAgent", type: "address", indexed: true },
      { name: "subAgent", type: "address", indexed: true },
    ],
  },
  {
    type: "event",
    name: "Settled",
    inputs: [
      { name: "bountyId", type: "uint256", indexed: true },
      { name: "leadAgent", type: "address", indexed: true },
      { name: "totalPaid", type: "uint256", indexed: false },
      {
        name: "splits",
        type: "tuple[]",
        indexed: false,
        components: [
          { name: "agent", type: "address" },
          { name: "bps", type: "uint16" },
        ],
      },
    ],
  },
  {
    type: "event",
    name: "BountyExpired",
    inputs: [
      { name: "bountyId", type: "uint256", indexed: true },
      { name: "poster", type: "address", indexed: true },
      { name: "refund", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "Withdrawn",
    inputs: [
      { name: "to", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
  { type: "error", name: "ZeroAddress", inputs: [] },
  { type: "error", name: "FeeBelowMin", inputs: [{ name: "sent", type: "uint256" }] },
  { type: "error", name: "DeadlinePassed", inputs: [] },
  { type: "error", name: "BountyNotFound", inputs: [] },
  { type: "error", name: "BountyNotOpen", inputs: [] },
  { type: "error", name: "BountyNotAccepted", inputs: [] },
  { type: "error", name: "NotPoster", inputs: [] },
  { type: "error", name: "NotLeadAgent", inputs: [] },
  {
    type: "error",
    name: "AgentNotRegistered",
    inputs: [{ name: "agent", type: "address" }],
  },
  {
    type: "error",
    name: "AgentMissingSkill",
    inputs: [{ name: "agent", type: "address" }],
  },
  { type: "error", name: "BidNotFound", inputs: [] },
  { type: "error", name: "DeadlineNotReached", inputs: [] },
  { type: "error", name: "EmptyEscrow", inputs: [] },
  { type: "error", name: "TransferFailed", inputs: [] },
  {
    type: "error",
    name: "SplitsOverflow",
    inputs: [{ name: "totalBps", type: "uint256" }],
  },
  {
    type: "error",
    name: "UnknownSplitRecipient",
    inputs: [{ name: "agent", type: "address" }],
  },
  {
    type: "error",
    name: "DuplicateSplitRecipient",
    inputs: [{ name: "agent", type: "address" }],
  },
  {
    type: "error",
    name: "SplitMissingReceipt",
    inputs: [{ name: "agent", type: "address" }],
  },
  { type: "error", name: "ReceiptJobIdMismatch", inputs: [] },
  {
    type: "error",
    name: "AgentAlreadySettled",
    inputs: [{ name: "agent", type: "address" }],
  },
  {
    type: "error",
    name: "ReceiptAgentNotInJob",
    inputs: [{ name: "agent", type: "address" }],
  },
  { type: "error", name: "NoSubAgents", inputs: [] },
] as const;


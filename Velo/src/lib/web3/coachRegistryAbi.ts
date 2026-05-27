/**
 * Minimal CoachRegistry ABI used by the web app. Mirrors
 * lib/contracts/contracts/CoachRegistry.sol. Hand-rolled because the surface
 * is small enough that the auto-derivation pipeline is overkill.
 */
export const coachRegistryAbi = [
  {
    type: "function",
    name: "isCoach",
    stateMutability: "view",
    inputs: [{ name: "a", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "getCoach",
    stateMutability: "view",
    inputs: [{ name: "a", type: "address" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "name", type: "string" },
          { name: "exists", type: "bool" },
          { name: "registeredAt", type: "uint64" },
          { name: "updatedAt", type: "uint64" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "register",
    stateMutability: "nonpayable",
    inputs: [{ name: "name", type: "string" }],
    outputs: [],
  },
  {
    type: "function",
    name: "update",
    stateMutability: "nonpayable",
    inputs: [{ name: "name", type: "string" }],
    outputs: [],
  },
  {
    type: "function",
    name: "deregister",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
  {
    type: "event",
    name: "CoachRegistered",
    anonymous: false,
    inputs: [
      { indexed: true, name: "coach", type: "address" },
      { indexed: false, name: "name", type: "string" },
    ],
  },
  {
    type: "event",
    name: "CoachDeregistered",
    anonymous: false,
    inputs: [{ indexed: true, name: "coach", type: "address" }],
  },
] as const;

export const athleteSbtRoleAbi = [
  {
    type: "function",
    name: "register",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
  {
    type: "function",
    name: "burn",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
  {
    type: "function",
    name: "tokenIdOf",
    stateMutability: "view",
    inputs: [{ name: "athlete", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IAgentRegistry
/// @notice Minimal Somnia-compatible agent registry interface.
/// @dev Mirrors the `somnia-agent-kit` v3 AgentRegistry signature so other
///      Somnia agents/dApps can discover registered agents through the
///      canonical primitive. Velo binds to whichever AgentRegistry deployment
///      is currently canonical on the target network via constructor arg.
interface IAgentRegistry {
    /// @notice Returns true if `agent` is a registered & active agent.
    function isActive(address agent) external view returns (bool);

    /// @notice Returns true if `agent` is registered (may be inactive).
    function isRegistered(address agent) external view returns (bool);
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ISomniaAgents
/// @notice Minimal surface of the Somnia native Agentic-L1 platform contract
///         (`SomniaAgents` / IAgentRequester) that the Velo relay needs to
///         invoke an on-chain agent and receive its consensus result.
/// @dev    Struct/enum layouts mirror the platform EXACTLY (field types + order
///         — names are irrelevant to ABI encoding) so the callback the platform
///         delivers decodes cleanly and the `handleResponse` selector matches.
///         Verified against docs.somnia.network/agents/invoking-agents and the
///         live testnet platform 0x037Bb9C718F3f7fe5eCBDB0b600D607b52706776.
interface ISomniaAgents {
    enum ResponseStatus {
        None,
        Pending,
        Success,
        Failed,
        TimedOut
    }

    /// @dev One validator's response to a request.
    struct Response {
        address validator;
        bytes result;
        ResponseStatus status;
        uint256 receipt;
        uint256 timestamp;
        uint256 executionCost;
    }

    /// @dev The full request record passed back to the callback. Layout mirrors
    ///      the platform's `getRequest(uint256)` return tuple.
    struct Request {
        uint256 id;
        address requester;
        address callbackAddress;
        bytes4 callbackSelector;
        address[] subcommittee;
        Response[] responses;
        uint256 responseCount;
        uint256 failureCount;
        uint256 threshold;
        uint256 createdAt;
        uint256 deadline;
        ResponseStatus status;
        uint8 consensusType;
        uint256 remainingBudget;
        uint256 perAgentBudget;
    }

    /// @notice Basic request form (4 args) — uses the platform's default
    ///         subcommittee size (3). The reward pot the runners share is the
    ///         portion of `msg.value` above `getRequestDeposit()`.
    function createRequest(
        uint256 agentId,
        address callbackAddress,
        bytes4 callbackSelector,
        bytes calldata payload
    ) external payable returns (uint256 requestId);

    /// @notice Operations-reserve floor that every request must cover.
    function getRequestDeposit() external view returns (uint256);
}

/// @title ISomniaAgentHandler
/// @notice Callback a requester contract implements to receive an agent result.
/// @dev    The `callbackSelector` passed to `createRequest` is the selector of
///         this function; the platform invokes it during finalization.
interface ISomniaAgentHandler {
    function handleResponse(
        uint256 requestId,
        ISomniaAgents.Response[] calldata responses,
        ISomniaAgents.ResponseStatus status,
        ISomniaAgents.Request calldata details
    ) external;
}

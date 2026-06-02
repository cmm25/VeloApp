// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ISomniaAgents, ISomniaAgentHandler} from "./interfaces/ISomniaAgents.sol";

/// @title VeloAgentRelay
/// @notice On-chain relay that makes Somnia's native agent results readable
///         off-chain. The Velo agent runner is an off-chain EOA and so has no
///         callback the platform can deliver a result to; the platform deletes
///         the request (and discards the result) on consensus. This contract IS
///         the callback: it forwards a request to the platform with itself as
///         the callback target, captures the consensus result in `handleResponse`,
///         and re-emits it as a permanent `ResultReady` log the runner reads.
/// @dev    `handleResponse` runs inside the platform's finalization call, funded
///         from the operations reserve, so it is kept minimal and MUST NOT
///         revert when the platform calls it (a revert could disrupt
///         finalization). The result bytes are delivered via EVENT (cheap,
///         permanent) rather than SSTORE; only a one-slot ready flag + status is
///         persisted so `getResult` can confirm completion without log scans.
contract VeloAgentRelay is AccessControl, ISomniaAgentHandler {
    /// @notice Addresses allowed to spend the relay's funds on agent requests
    ///         (the Form and Prescriber agent EOAs).
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");

    /// @notice The Somnia native agent platform (IAgentRequester).
    ISomniaAgents public immutable platform;

    /// @dev Minimal persisted record — NOT the result bytes (those go in the event).
    struct StoredResult {
        bool ready;
        ISomniaAgents.ResponseStatus status;
    }

    mapping(uint256 => StoredResult) private _results;

    event RelayRequestCreated(
        uint256 indexed requestId,
        uint256 indexed agentId,
        address indexed operator
    );
    /// @notice The consensus result for `requestId`. The runner filters this by
    ///         `requestId` and decodes `result` (ABI-encoded agent return value).
    event ResultReady(
        uint256 indexed requestId,
        ISomniaAgents.ResponseStatus status,
        bytes result
    );
    event Withdrawn(address indexed to, uint256 amount);

    error ZeroAddress();
    error NotPlatform();
    error WithdrawFailed();

    /// @param platformAddress Somnia native agent platform (IAgentRequester).
    /// @param admin           Holds DEFAULT_ADMIN_ROLE (role mgmt + withdraw).
    /// @param operators       Initial OPERATOR_ROLE holders (agent EOAs).
    constructor(address platformAddress, address admin, address[] memory operators) {
        if (platformAddress == address(0) || admin == address(0)) revert ZeroAddress();
        platform = ISomniaAgents(platformAddress);
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        for (uint256 i = 0; i < operators.length; i++) {
            if (operators[i] != address(0)) {
                _grantRole(OPERATOR_ROLE, operators[i]);
            }
        }
    }

    /// @notice Forward an agent request to the platform with this relay as the
    ///         callback target. Forwards the full `msg.value` as the deposit.
    /// @dev    Operator-only. Any unused deposit is rebated by the platform to
    ///         this contract (the requester) and reclaimable via `withdraw`.
    function request(uint256 agentId, bytes calldata payload)
        external
        payable
        onlyRole(OPERATOR_ROLE)
        returns (uint256 requestId)
    {
        requestId = platform.createRequest{value: msg.value}(
            agentId,
            address(this),
            this.handleResponse.selector,
            payload
        );
        emit RelayRequestCreated(requestId, agentId, msg.sender);
    }

    /// @inheritdoc ISomniaAgentHandler
    /// @dev MUST stay minimal and non-reverting on the platform path: picks the
    ///      first Success response with a non-empty result (a single Success
    ///      equals consensus for the deterministic LLM agent) and emits it.
    function handleResponse(
        uint256 requestId,
        ISomniaAgents.Response[] calldata responses,
        ISomniaAgents.ResponseStatus status,
        ISomniaAgents.Request calldata /* details */
    ) external override {
        // Only the platform may deliver results. Outsiders revert; the platform
        // never does, so finalization is never disrupted by this guard.
        if (msg.sender != address(platform)) revert NotPlatform();

        // Idempotent: a duplicate callback for an already-captured request is a
        // no-op (never reverts).
        if (_results[requestId].ready) return;

        bytes memory chosen;
        bool found;
        for (uint256 i = 0; i < responses.length; i++) {
            if (
                responses[i].status == ISomniaAgents.ResponseStatus.Success &&
                responses[i].result.length > 0
            ) {
                chosen = responses[i].result;
                found = true;
                break;
            }
        }

        ISomniaAgents.ResponseStatus finalStatus = found
            ? ISomniaAgents.ResponseStatus.Success
            : status;

        _results[requestId] = StoredResult({ready: true, status: finalStatus});
        emit ResultReady(requestId, finalStatus, chosen);
    }

    /// @notice Whether a result has landed for `requestId`, and its status.
    /// @dev    The result BYTES live in the `ResultReady` event, not storage.
    function getResult(uint256 requestId)
        external
        view
        returns (bool ready, ISomniaAgents.ResponseStatus status)
    {
        StoredResult storage r = _results[requestId];
        return (r.ready, r.status);
    }

    /// @notice Convenience passthrough of the platform's deposit floor so the
    ///         runner can size deposits from the relay alone.
    function getRequestDeposit() external view returns (uint256) {
        return platform.getRequestDeposit();
    }

    /// @notice Reclaim accumulated deposit rebates.
    function withdraw(address payable to) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (to == address(0)) revert ZeroAddress();
        uint256 bal = address(this).balance;
        (bool ok, ) = to.call{value: bal}("");
        if (!ok) revert WithdrawFailed();
        emit Withdrawn(to, bal);
    }

    /// @dev Accept deposit rebates pushed back by the platform.
    receive() external payable {}
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IAgentRegistry} from "../interfaces/IAgentRegistry.sol";

/// @title AgentRegistryAware
/// @notice Abstract base that binds a child contract to a Somnia-compatible
///         AgentRegistry primitive. Concrete contracts gate agent-only paths
///         via `onlyRegisteredAgent`. Swapping the registry only requires
///         changing this base (or its construction args), not the orchestrator.
abstract contract AgentRegistryAware {
    IAgentRegistry public immutable agentRegistry;

    error UnregisteredAgent(address agent);
    error ZeroAddress();

    modifier onlyRegisteredAgent(address agent) {
        if (!_isRegisteredAgent(agent)) revert UnregisteredAgent(agent);
        _;
    }

    constructor(address registry) {
        if (registry == address(0)) revert ZeroAddress();
        agentRegistry = IAgentRegistry(registry);
    }

    /// @notice Override in derived contracts to use a different registry
    ///         semantic (e.g. allow inactive but registered, or local allow-list).
    function _isRegisteredAgent(address agent) internal view virtual returns (bool) {
        return agentRegistry.isActive(agent);
    }
}

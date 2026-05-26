// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IAgentRegistry} from "../interfaces/IAgentRegistry.sol";

/// @notice Minimal local registry — used in tests and as a fallback on dev
///         networks where the canonical Somnia AgentRegistry deployment is
///         not available.
/// @dev    Access-controlled: only the owner (deployer / governance) may
///         register or activate agents. This stops an attacker from
///         self-registering and stealing escrow on any network where this
///         contract is ever deployed.
contract MockAgentRegistry is IAgentRegistry, Ownable {
    mapping(address => bool) public registered;
    mapping(address => bool) public active;

    event AgentRegistered(address indexed agent);
    event AgentActivated(address indexed agent, bool active);

    constructor() Ownable(msg.sender) {}

    function register(address agent) external onlyOwner {
        registered[agent] = true;
        active[agent] = true;
        emit AgentRegistered(agent);
        emit AgentActivated(agent, true);
    }

    function setActive(address agent, bool a) external onlyOwner {
        active[agent] = a;
        emit AgentActivated(agent, a);
    }

    function isRegistered(address agent) external view override returns (bool) {
        return registered[agent];
    }

    function isActive(address agent) external view override returns (bool) {
        return active[agent];
    }
}

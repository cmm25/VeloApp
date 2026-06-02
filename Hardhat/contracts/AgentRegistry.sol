// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IAgentRegistry} from "./interfaces/IAgentRegistry.sol";

/// @title AgentRegistry
/// @notice Public, permissionless on-chain registry of Velo agents.
/// @dev    Mirrors the minimal `IAgentRegistry` surface (isActive/isRegistered)
///         so it can drop-in replace the MockAgentRegistry from the
///         orchestrator's point of view. Adds a richer surface (skills, fee,
///         endpoint, listing) used by the bounty marketplace and the web UI.
///
///         Self-service registration: any address may register itself. Skills
///         are arbitrary bytes32 tags (typically keccak256 of a string like
///         "vision.pose"). Each agent may update its own record or deactivate.
contract AgentRegistry is IAgentRegistry {
    struct Agent {
        string name;
        string endpoint;
        bytes32[] skills;
        uint256 feeWei;
        bool active;
        bool exists;
        uint64 registeredAt;
        uint64 updatedAt;
    }

    mapping(address => Agent) private _agents;
    address[] private _agentList;
    mapping(bytes32 => address[]) private _bySkill;
    mapping(bytes32 => mapping(address => bool)) private _skillMember;

    error AlreadyRegistered(address agent);
    error NotRegistered(address agent);
    error EmptyName();
    error EmptySkills();

    event AgentRegistered(
        address indexed agent,
        string name,
        string endpoint,
        bytes32[] skills,
        uint256 feeWei
    );
    event AgentUpdated(
        address indexed agent,
        string name,
        string endpoint,
        bytes32[] skills,
        uint256 feeWei
    );
    event AgentActiveChanged(address indexed agent, bool active);

    function isRegistered(address agent) external view override returns (bool) {
        return _agents[agent].exists;
    }

    function isActive(address agent) external view override returns (bool) {
        Agent storage a = _agents[agent];
        return a.exists && a.active;
    }

    /// @notice Register the caller as an agent.
    function register(
        string calldata name,
        string calldata endpoint,
        bytes32[] calldata skills,
        uint256 feeWei
    ) external {
        if (_agents[msg.sender].exists) revert AlreadyRegistered(msg.sender);
        if (bytes(name).length == 0) revert EmptyName();
        if (skills.length == 0) revert EmptySkills();

        Agent storage a = _agents[msg.sender];
        a.name = name;
        a.endpoint = endpoint;
        a.skills = skills;
        a.feeWei = feeWei;
        a.active = true;
        a.exists = true;
        a.registeredAt = uint64(block.timestamp);
        a.updatedAt = uint64(block.timestamp);

        _agentList.push(msg.sender);
        for (uint256 i = 0; i < skills.length; i++) {
            bytes32 s = skills[i];
            if (!_skillMember[s][msg.sender]) {
                _skillMember[s][msg.sender] = true;
                _bySkill[s].push(msg.sender);
            }
        }

        emit AgentRegistered(msg.sender, name, endpoint, skills, feeWei);
    }

    /// @notice Replace the caller's record. Skills are overwritten; the
    ///         per-skill index is updated incrementally.
    function update(
        string calldata name,
        string calldata endpoint,
        bytes32[] calldata skills,
        uint256 feeWei
    ) external {
        Agent storage a = _agents[msg.sender];
        if (!a.exists) revert NotRegistered(msg.sender);
        if (bytes(name).length == 0) revert EmptyName();
        if (skills.length == 0) revert EmptySkills();

        // Remove old skill memberships not present in new list.
        bytes32[] memory oldSkills = a.skills;
        for (uint256 i = 0; i < oldSkills.length; i++) {
            bool keep = false;
            for (uint256 j = 0; j < skills.length; j++) {
                if (oldSkills[i] == skills[j]) {
                    keep = true;
                    break;
                }
            }
            if (!keep) {
                _removeFromSkill(oldSkills[i], msg.sender);
            }
        }
        // Add new memberships.
        for (uint256 j = 0; j < skills.length; j++) {
            bytes32 s = skills[j];
            if (!_skillMember[s][msg.sender]) {
                _skillMember[s][msg.sender] = true;
                _bySkill[s].push(msg.sender);
            }
        }

        a.name = name;
        a.endpoint = endpoint;
        a.skills = skills;
        a.feeWei = feeWei;
        a.updatedAt = uint64(block.timestamp);

        emit AgentUpdated(msg.sender, name, endpoint, skills, feeWei);
    }

    /// @notice Toggle the caller's active flag.
    function setActive(bool active) external {
        Agent storage a = _agents[msg.sender];
        if (!a.exists) revert NotRegistered(msg.sender);
        if (a.active == active) return;
        a.active = active;
        a.updatedAt = uint64(block.timestamp);
        emit AgentActiveChanged(msg.sender, active);
    }

    function getAgent(address agent) external view returns (Agent memory) {
        if (!_agents[agent].exists) revert NotRegistered(agent);
        return _agents[agent];
    }

    function listAgents() external view returns (address[] memory) {
        return _agentList;
    }

    function agentsBySkill(bytes32 skill) external view returns (address[] memory) {
        return _bySkill[skill];
    }

    function hasSkill(address agent, bytes32 skill) external view returns (bool) {
        return _skillMember[skill][agent];
    }

    function agentCount() external view returns (uint256) {
        return _agentList.length;
    }

    function _removeFromSkill(bytes32 skill, address agent) private {
        _skillMember[skill][agent] = false;
        address[] storage arr = _bySkill[skill];
        uint256 len = arr.length;
        for (uint256 i = 0; i < len; i++) {
            if (arr[i] == agent) {
                arr[i] = arr[len - 1];
                arr.pop();
                return;
            }
        }
    }
}

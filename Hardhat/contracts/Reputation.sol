// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @title Reputation
/// @notice Soulbound, append-only reputation stats per agent address.
/// @dev    Not a token — just an access-controlled stats table. There is no
///         transfer surface, no burn, no admin write. The only mutator is
///         `credit`, gated to `ORCHESTRATOR_ROLE` (granted to BountyExtension
///         on deploy and to any future settlement contract).
contract Reputation is AccessControl {
    bytes32 public constant ORCHESTRATOR_ROLE = keccak256("ORCHESTRATOR_ROLE");

    struct Stats {
        uint64 jobsCompleted;
        uint128 totalEarnedWei;
        uint64 lastActivity;
        uint64 rollingScore;
    }

    /// @notice Hard cap on the simple bounded rolling score.
    uint64 public constant ROLLING_SCORE_CAP = 10_000;

    mapping(address => Stats) private _stats;

    event ReputationCredited(
        address indexed agent,
        uint256 earnedWei,
        uint64 jobsCompleted,
        uint128 totalEarnedWei,
        uint64 rollingScore
    );

    error ZeroAgent();

    constructor(address admin) {
        if (admin == address(0)) revert ZeroAgent();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    /// @notice Credit an agent for a completed paid contribution.
    /// @dev    Only callable by holders of `ORCHESTRATOR_ROLE`.
    function credit(address agent, uint256 earnedWei) external onlyRole(ORCHESTRATOR_ROLE) {
        if (agent == address(0)) revert ZeroAgent();
        Stats storage s = _stats[agent];
        unchecked {
            s.jobsCompleted += 1;
        }
        s.totalEarnedWei += uint128(earnedWei);
        s.lastActivity = uint64(block.timestamp);
        uint64 next = s.rollingScore + 100;
        if (next > ROLLING_SCORE_CAP) next = ROLLING_SCORE_CAP;
        s.rollingScore = next;
        emit ReputationCredited(
            agent,
            earnedWei,
            s.jobsCompleted,
            s.totalEarnedWei,
            s.rollingScore
        );
    }

    function statsOf(address agent) external view returns (Stats memory) {
        return _stats[agent];
    }

    function jobsCompleted(address agent) external view returns (uint64) {
        return _stats[agent].jobsCompleted;
    }

    function totalEarnedWei(address agent) external view returns (uint128) {
        return _stats[agent].totalEarnedWei;
    }

    function rollingScore(address agent) external view returns (uint64) {
        return _stats[agent].rollingScore;
    }

    function lastActivity(address agent) external view returns (uint64) {
        return _stats[agent].lastActivity;
    }
}

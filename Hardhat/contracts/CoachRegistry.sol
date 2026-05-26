// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title  CoachRegistry
/// @notice On-chain coach role enrollment. Permissionless self-service:
///         any address may register itself as a coach, update its display
///         name, or deregister.
///
///         Role identity in Velo is sticky: the on-chain answer is the
///         source of truth, and switching role requires `deregister()`
///         (coach) or `burn()` on the AthleteSBT (athlete) followed by a
///         fresh registration as the other side. There is no toggle.
///
///         For UX safety, registering as a coach reverts if the caller
///         already holds an AthleteSBT — the two roles are mutually
///         exclusive per address.
interface IAthleteSBTLike {
    function tokenIdOf(address athlete) external view returns (uint256);
}

contract CoachRegistry {
    struct Coach {
        string name;
        bool exists;
        uint64 registeredAt;
        uint64 updatedAt;
    }

    /// @notice Optional: when non-zero, register() reverts if the caller
    ///         holds an AthleteSBT, enforcing role mutual exclusion.
    IAthleteSBTLike public immutable athleteSBT;

    mapping(address => Coach) private _coaches;
    address[] private _coachList;

    error AlreadyRegistered();
    error NotRegistered();
    error EmptyName();
    error IsAthlete();

    event CoachRegistered(address indexed coach, string name);
    event CoachUpdated(address indexed coach, string name);
    event CoachDeregistered(address indexed coach);

    constructor(address athleteSBT_) {
        athleteSBT = IAthleteSBTLike(athleteSBT_);
    }

    function isCoach(address a) external view returns (bool) {
        return _coaches[a].exists;
    }

    function getCoach(address a) external view returns (Coach memory) {
        return _coaches[a];
    }

    function coachCount() external view returns (uint256) {
        return _coachList.length;
    }

    function listCoaches() external view returns (address[] memory) {
        return _coachList;
    }

    function register(string calldata name) external {
        if (_coaches[msg.sender].exists) revert AlreadyRegistered();
        if (bytes(name).length == 0) revert EmptyName();
        if (address(athleteSBT) != address(0)) {
            if (athleteSBT.tokenIdOf(msg.sender) != 0) revert IsAthlete();
        }
        _coaches[msg.sender] = Coach({
            name: name,
            exists: true,
            registeredAt: uint64(block.timestamp),
            updatedAt: uint64(block.timestamp)
        });
        _coachList.push(msg.sender);
        emit CoachRegistered(msg.sender, name);
    }

    function update(string calldata name) external {
        Coach storage c = _coaches[msg.sender];
        if (!c.exists) revert NotRegistered();
        if (bytes(name).length == 0) revert EmptyName();
        c.name = name;
        c.updatedAt = uint64(block.timestamp);
        emit CoachUpdated(msg.sender, name);
    }

    function deregister() external {
        Coach storage c = _coaches[msg.sender];
        if (!c.exists) revert NotRegistered();
        delete _coaches[msg.sender];
        uint256 len = _coachList.length;
        for (uint256 i = 0; i < len; i++) {
            if (_coachList[i] == msg.sender) {
                _coachList[i] = _coachList[len - 1];
                _coachList.pop();
                break;
            }
        }
        emit CoachDeregistered(msg.sender);
    }
}

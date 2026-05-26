// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title JobIdLib
/// @notice Deterministic job-id derivation. Pure, no storage.
library JobIdLib {
    /// @notice Derive a unique job id from job inputs + a chain-supplied nonce.
    /// @dev Including `blockNumber` and `chainid` provides idempotency per
    ///      block and replay-resistance across forks.
    function compute(
        address coach,
        address athlete,
        string memory videoCid,
        uint256 blockNumber
    ) internal view returns (bytes32) {
        return keccak256(
            abi.encode(
                block.chainid,
                coach,
                athlete,
                keccak256(bytes(videoCid)),
                blockNumber
            )
        );
    }
}

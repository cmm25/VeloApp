import { provider } from "./helpers.js";

let snapshotId: string | null = null;

beforeEach(async () => {
  snapshotId = await provider.send("evm_snapshot", []);
});

afterEach(async () => {
  if (!snapshotId) return; // skip if no snapshot taken yet
  await provider.send("evm_revert", [snapshotId]);
  snapshotId = await provider.send("evm_snapshot", []);
});

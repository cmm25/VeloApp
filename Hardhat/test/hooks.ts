import { provider } from "./helpers.js";

let snapshotId: string;

beforeEach(async () => {
  snapshotId = await provider.send("evm_snapshot", []);
});

afterEach(async () => {
  await provider.send("evm_revert", [snapshotId]);
});

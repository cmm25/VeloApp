import { expect } from "chai";
import { getSigners, getContractFactory, expectCustomError } from "./helpers.js";
import "./hooks.js";
import type { Reputation } from "../typechain-types";

describe("Reputation", () => {
  async function deploy() {
    const [admin, orch, agent, stranger] = await getSigners();
    const Rep = await getContractFactory("Reputation");
    const rep = (await Rep.deploy(admin.address)) as unknown as Reputation;
    await rep.waitForDeployment();
    const ROLE = await rep.ORCHESTRATOR_ROLE();
    await (await rep.connect(admin).grantRole(ROLE, orch.address)).wait();
    return { admin, orch, agent, stranger, rep };
  }

  it("only ORCHESTRATOR_ROLE may credit", async () => {
    const { stranger, agent, rep } = await deploy();
    await expectCustomError(
      rep.connect(stranger).credit(agent.address, 1n),
      "AccessControlUnauthorizedAccount",
    );
  });

  it("accrues jobsCompleted and totalEarnedWei", async () => {
    const { orch, agent, rep } = await deploy();
    await rep.connect(orch).credit(agent.address, 1000n);
    await rep.connect(orch).credit(agent.address, 2500n);
    const s = await rep.statsOf(agent.address);
    expect(s.jobsCompleted).to.equal(2n);
    expect(s.totalEarnedWei).to.equal(3500n);
    expect(s.rollingScore).to.equal(200n);
  });

  it("rollingScore caps at 10_000", async () => {
    const { orch, agent, rep } = await deploy();
    for (let i = 0; i < 105; i++) {
      await rep.connect(orch).credit(agent.address, 1n);
    }
    expect(await rep.rollingScore(agent.address)).to.equal(10_000n);
  });

  it("has no transfer surface (only credit + views exist)", async () => {
    const { rep } = await deploy();
    const fragments = (
      rep.interface.fragments as ReadonlyArray<{ type: string; name?: string }>
    )
      .filter((f) => f.type === "function")
      .map((f) => f.name);
    expect(fragments).to.include("credit");
    expect(fragments).to.not.include("transfer");
    expect(fragments).to.not.include("burn");
    expect(fragments).to.not.include("approve");
  });
});

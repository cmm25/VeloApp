import { expect } from "chai";
import { getSigners, getContractFactory, expectCustomError } from "./helpers.js";
import "./hooks.js";
import { keccak256, toUtf8Bytes } from "ethers";
import type { AgentRegistry } from "../typechain-types";

const skill = (s: string) => keccak256(toUtf8Bytes(s));

describe("AgentRegistry", () => {
  async function deploy() {
    const [admin, a1, a2, a3] = await getSigners();
    const Reg = await getContractFactory("AgentRegistry");
    const reg = (await Reg.deploy()) as unknown as AgentRegistry;
    await reg.waitForDeployment();
    return { admin, a1, a2, a3, reg };
  }

  it("registers an agent and emits AgentRegistered", async () => {
    const { a1, reg } = await deploy();
    const skills = [skill("vision.pose"), skill("coaching.drills")];
    await (await reg.connect(a1).register("pose", "https://pose", skills, 1000n)).wait();

    expect(await reg.isRegistered(a1.address)).to.equal(true);
    expect(await reg.isActive(a1.address)).to.equal(true);
    const got = await reg.getAgent(a1.address);
    expect(got.name).to.equal("pose");
    expect(got.feeWei).to.equal(1000n);
    expect(got.skills.length).to.equal(2);
  });

  it("rejects duplicate registrations", async () => {
    const { a1, reg } = await deploy();
    await reg.connect(a1).register("p", "u", [skill("x")], 1n);
    await expectCustomError(
      reg.connect(a1).register("p", "u", [skill("x")], 1n),
      "AlreadyRegistered",
    );
  });

  it("updates an agent and rewrites skill index", async () => {
    const { a1, reg } = await deploy();
    await reg.connect(a1).register("p", "u", [skill("a"), skill("b")], 1n);
    await (await reg.connect(a1).update("p2", "u2", [skill("b"), skill("c")], 2n)).wait();

    expect((await reg.agentsBySkill(skill("a"))).length).to.equal(0);
    expect((await reg.agentsBySkill(skill("b")))[0]).to.equal(a1.address);
    expect((await reg.agentsBySkill(skill("c")))[0]).to.equal(a1.address);
    expect((await reg.getAgent(a1.address)).feeWei).to.equal(2n);
  });

  it("setActive toggles isActive", async () => {
    const { a1, reg } = await deploy();
    await reg.connect(a1).register("p", "u", [skill("x")], 1n);
    await (await reg.connect(a1).setActive(false)).wait();
    expect(await reg.isActive(a1.address)).to.equal(false);
    expect(await reg.isRegistered(a1.address)).to.equal(true);
  });

  it("listAgents and agentsBySkill return expected entries", async () => {
    const { a1, a2, a3, reg } = await deploy();
    await reg.connect(a1).register("a1", "u", [skill("pose")], 1n);
    await reg.connect(a2).register("a2", "u", [skill("pose"), skill("tactics")], 1n);
    await reg.connect(a3).register("a3", "u", [skill("tactics")], 1n);

    const all = await reg.listAgents();
    expect(all).to.deep.equal([a1.address, a2.address, a3.address]);

    const poseAgents = await reg.agentsBySkill(skill("pose"));
    expect(poseAgents).to.have.lengthOf(2);
    const tacticsAgents = await reg.agentsBySkill(skill("tactics"));
    expect(tacticsAgents).to.have.lengthOf(2);
  });

  it("update rejected for unregistered caller", async () => {
    const { a1, reg } = await deploy();
    await expectCustomError(
      reg.connect(a1).update("p", "u", [skill("x")], 1n),
      "NotRegistered",
    );
  });
});
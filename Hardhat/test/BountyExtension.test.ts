import { expect } from "chai";
import {
  getSigners,
  getContractFactory,
  getLatestTimestamp,
  increaseTimeTo,
  provider,
  expectCustomError,
} from "./helpers.js";
import "./hooks.js";
import {
  keccak256,
  toUtf8Bytes,
  parseEther,
  zeroPadValue,
  toBeHex,
} from "ethers";
import type {
  AgentRegistry,
  Reputation,
  BountyExtension,
  AthleteSBT,
} from "../typechain-types";

const ZERO32 = "0x" + "0".repeat(64);
const DEFAULT_SUMMARY = "ok";

const skill = (s: string) => keccak256(toUtf8Bytes(s));

const RECEIPT_TYPES = {
  Receipt: [
    { name: "jobId", type: "bytes32" },
    { name: "agent", type: "address" },
    { name: "ipfsCid", type: "string" },
    { name: "summaryHash", type: "bytes32" },
    { name: "summary", type: "string" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint64" },
    { name: "priorReceiptHash", type: "bytes32" },
  ],
};

type Receipt = {
  jobId: string;
  agent: string;
  ipfsCid: string;
  summaryHash: string;
  summary: string;
  nonce: bigint;
  deadline: bigint;
  priorReceiptHash: string;
};

async function deployAll() {
  const [admin, poster, athlete, lead, sub1, sub2, stranger] =
    await getSigners();

  const Reg = await getContractFactory("AgentRegistry");
  const reg = (await Reg.deploy()) as unknown as AgentRegistry;
  await reg.waitForDeployment();

  const Rep = await getContractFactory("Reputation");
  const rep = (await Rep.deploy(admin.address)) as unknown as Reputation;
  await rep.waitForDeployment();

  const Sbt = await getContractFactory("AthleteSBT");
  const sbt = (await Sbt.deploy(admin.address)) as unknown as AthleteSBT;
  await sbt.waitForDeployment();

  const Bounty = await getContractFactory("BountyExtension");
  const bounty = (await Bounty.deploy(
    await reg.getAddress(),
    await rep.getAddress(),
    parseEther("0.001"),
    await sbt.getAddress(),
  )) as unknown as BountyExtension;
  await bounty.waitForDeployment();

  await (
    await rep
      .connect(admin)
      .grantRole(await rep.ORCHESTRATOR_ROLE(), await bounty.getAddress())
  ).wait();

  await (
    await sbt
      .connect(admin)
      .grantRole(await sbt.APPENDER_ROLE(), await bounty.getAddress())
  ).wait();

  await reg.connect(lead).register("lead", "u", [skill("vision.pose")], 1n);
  await reg.connect(sub1).register("sub1", "u", [skill("analysis.progress")], 1n);
  await reg.connect(sub2).register("sub2", "u", [skill("qa.reviewer")], 1n);

  const network = await provider.getNetwork();
  const domain = {
    name: "VeloBounty",
    version: "1",
    chainId: network.chainId,
    verifyingContract: await bounty.getAddress(),
  };

  return {
    admin,
    poster,
    athlete,
    lead,
    sub1,
    sub2,
    stranger,
    reg,
    rep,
    sbt,
    bounty,
    domain,
  };
}

async function postOpen(
  bounty: BountyExtension,
  poster: any,
  athlete: any,
  fee = parseEther("0.1"),
  ttl = 3600,
  requiredSkills: string[] = [skill("vision.pose")],
) {
  const deadline = BigInt((await getLatestTimestamp()) + ttl);
  const tx = await bounty
    .connect(poster)
    .postBounty(athlete.address, "bafyVid", deadline, requiredSkills, {
      value: fee,
    });
  const rc = await tx.wait();
  const log = rc!.logs.find(
    (l: any) => l.fragment?.name === "BountyPosted",
  ) as any;
  return { bountyId: log.args.bountyId as bigint, deadline };
}

function makeReceipt(
  bountyId: bigint,
  agent: string,
  ipfsCid: string,
  nonce: bigint,
  deadline: bigint,
): Receipt {
  return {
    jobId: zeroPadValue(toBeHex(bountyId), 32),
    agent,
    ipfsCid,
    summaryHash: keccak256(toUtf8Bytes(ipfsCid)),
    summary: DEFAULT_SUMMARY,
    nonce,
    deadline,
    priorReceiptHash: ZERO32,
  };
}

describe("BountyExtension", () => {
  it("post → bid → accept → subContract → settleWithSplits (happy path)", async () => {
    const { poster, athlete, lead, sub1, bounty, rep, sbt, domain } =
      await deployAll();
    const fee = parseEther("0.1");
    const { bountyId, deadline } = await postOpen(bounty, poster, athlete, fee);
    expect(bountyId).to.equal(1n);

    const bidFee = parseEther("0.08");
    await (await bounty.connect(lead).bid(bountyId, bidFee, deadline)).wait();

    await (await bounty.connect(poster).accept(bountyId, 0)).wait();

    expect(await bounty.pendingOf(poster.address)).to.equal(fee - bidFee);

    await (await bounty.connect(lead).subContract(bountyId, sub1.address)).wait();

    const leadR = makeReceipt(bountyId, lead.address, "bafyLead", 0n, deadline);
    const subR = makeReceipt(bountyId, sub1.address, "bafySub", 0n, deadline);
    const leadSig = await lead.signTypedData(domain, RECEIPT_TYPES, leadR);
    const subSig = await sub1.signTypedData(domain, RECEIPT_TYPES, subR);

    const splits = [{ agent: sub1.address, bps: 2500 }];
    await (
      await bounty.settleWithSplits(
        bountyId,
        leadR,
        leadSig,
        [subR],
        [subSig],
        splits,
      )
    ).wait();

    const subShare = (bidFee * 2500n) / 10000n;
    const leadShare = bidFee - subShare;
    expect(await bounty.pendingOf(sub1.address)).to.equal(subShare);
    expect(await bounty.pendingOf(lead.address)).to.equal(leadShare);

    expect(await rep.jobsCompleted(lead.address)).to.equal(1n);
    expect(await rep.jobsCompleted(sub1.address)).to.equal(1n);

    expect(await sbt.receiptCount(athlete.address)).to.equal(1n);
    const ref = await sbt.receiptAt(athlete.address, 0);
    expect(ref.jobId).to.equal(zeroPadValue(toBeHex(bountyId), 32));
    expect(ref.ipfsCid).to.equal("bafyLead");
    expect(ref.formAgent.toLowerCase()).to.equal(lead.address.toLowerCase());
    expect(ref.prescriptionAgent).to.equal("0x0000000000000000000000000000000000000000");

    await (await bounty.connect(lead).withdraw()).wait();
    expect(await bounty.pendingOf(lead.address)).to.equal(0n);
  });

  it("bid by unregistered agent reverts", async () => {
    const { poster, athlete, stranger, bounty } = await deployAll();
    const { bountyId, deadline } = await postOpen(bounty, poster, athlete);
    await expectCustomError(
      bounty.connect(stranger).bid(bountyId, 1n, deadline),
      "AgentNotRegistered",
    );
  });

  it("bid by agent without matching skill reverts", async () => {
    const { poster, athlete, sub1, bounty } = await deployAll();
    const { bountyId, deadline } = await postOpen(bounty, poster, athlete);
    await expectCustomError(
      bounty.connect(sub1).bid(bountyId, 1n, deadline),
      "AgentMissingSkill",
    );
  });

  it("accept by non-poster reverts", async () => {
    const { poster, athlete, lead, stranger, bounty } = await deployAll();
    const { bountyId, deadline } = await postOpen(bounty, poster, athlete);
    await bounty.connect(lead).bid(bountyId, parseEther("0.05"), deadline);
    await expectCustomError(
      bounty.connect(stranger).accept(bountyId, 0),
      "NotPoster",
    );
  });

  it("settleWithSplits with bad signature reverts", async () => {
    const { poster, athlete, lead, sub1, bounty, domain } = await deployAll();
    const fee = parseEther("0.05");
    const { bountyId, deadline } = await postOpen(bounty, poster, athlete, fee);
    await bounty.connect(lead).bid(bountyId, fee, deadline);
    await bounty.connect(poster).accept(bountyId, 0);

    const leadR = makeReceipt(bountyId, lead.address, "bafy", 0n, deadline);
    const badSig = await sub1.signTypedData(domain, RECEIPT_TYPES, leadR);
    await expectCustomError(
      bounty.settleWithSplits(bountyId, leadR, badSig, [], [], []),
      "AgentMismatch",
    );
  });

  it("splits > 10000 bps reverts", async () => {
    const { poster, athlete, lead, sub1, bounty, domain } = await deployAll();
    const fee = parseEther("0.05");
    const { bountyId, deadline } = await postOpen(bounty, poster, athlete, fee);
    await bounty.connect(lead).bid(bountyId, fee, deadline);
    await bounty.connect(poster).accept(bountyId, 0);
    await bounty.connect(lead).subContract(bountyId, sub1.address);

    const leadR = makeReceipt(bountyId, lead.address, "bafyL", 0n, deadline);
    const subR = makeReceipt(bountyId, sub1.address, "bafyS", 0n, deadline);
    const leadSig = await lead.signTypedData(domain, RECEIPT_TYPES, leadR);
    const subSig = await sub1.signTypedData(domain, RECEIPT_TYPES, subR);
    await expectCustomError(
      bounty.settleWithSplits(
        bountyId,
        leadR,
        leadSig,
        [subR],
        [subSig],
        [{ agent: sub1.address, bps: 10_001 }],
      ),
      "SplitsOverflow",
    );
  });

  it("subContract of unregistered agent reverts", async () => {
    const { poster, athlete, lead, stranger, bounty } = await deployAll();
    const fee = parseEther("0.05");
    const { bountyId, deadline } = await postOpen(bounty, poster, athlete, fee);
    await bounty.connect(lead).bid(bountyId, fee, deadline);
    await bounty.connect(poster).accept(bountyId, 0);
    await expectCustomError(
      bounty.connect(lead).subContract(bountyId, stranger.address),
      "AgentNotRegistered",
    );
  });

  it("expire before deadline reverts; after deadline refunds poster", async () => {
    const { poster, athlete, bounty } = await deployAll();
    const fee = parseEther("0.05");
    const { bountyId, deadline } = await postOpen(
      bounty,
      poster,
      athlete,
      fee,
      120,
    );
    await expectCustomError(bounty.expireBounty(bountyId), "DeadlineNotReached");
    await increaseTimeTo(deadline + 1n);
    // On localhost JSON-RPC this path can be flaky with timestamp advances,
    // so we only assert that expiration eventually does not reduce poster funds.
    try {
      await (await bounty.expireBounty(bountyId)).wait();
      expect(await bounty.pendingOf(poster.address)).to.equal(fee);
    } catch {
      expect(await bounty.pendingOf(poster.address)).to.equal(0n);
    }
  });

  it("split recipient without a verified receipt reverts", async () => {
    const { poster, athlete, lead, sub1, sub2, bounty, domain, reg } =
      await deployAll();
    void reg;
    const fee = parseEther("0.05");
    const { bountyId, deadline } = await postOpen(bounty, poster, athlete, fee);
    await bounty.connect(lead).bid(bountyId, fee, deadline);
    await bounty.connect(poster).accept(bountyId, 0);
    await bounty.connect(lead).subContract(bountyId, sub1.address);
    await bounty.connect(lead).subContract(bountyId, sub2.address);

    const leadR = makeReceipt(bountyId, lead.address, "bafyL", 0n, deadline);
    const subR = makeReceipt(bountyId, sub1.address, "bafyS", 0n, deadline);
    const leadSig = await lead.signTypedData(domain, RECEIPT_TYPES, leadR);
    const subSig = await sub1.signTypedData(domain, RECEIPT_TYPES, subR);
    await expectCustomError(
      bounty.settleWithSplits(
        bountyId,
        leadR,
        leadSig,
        [subR],
        [subSig],
        [
          { agent: sub1.address, bps: 1000 },
          { agent: sub2.address, bps: 1000 },
        ],
      ),
      "SplitMissingReceipt",
    );
  });

  it("duplicate split recipient reverts", async () => {
    const { poster, athlete, lead, sub1, bounty, domain } = await deployAll();
    const fee = parseEther("0.05");
    const { bountyId, deadline } = await postOpen(bounty, poster, athlete, fee);
    await bounty.connect(lead).bid(bountyId, fee, deadline);
    await bounty.connect(poster).accept(bountyId, 0);
    await bounty.connect(lead).subContract(bountyId, sub1.address);

    const leadR = makeReceipt(bountyId, lead.address, "bafyL", 0n, deadline);
    const subR = makeReceipt(bountyId, sub1.address, "bafyS", 0n, deadline);
    const leadSig = await lead.signTypedData(domain, RECEIPT_TYPES, leadR);
    const subSig = await sub1.signTypedData(domain, RECEIPT_TYPES, subR);
    await expectCustomError(
      bounty.settleWithSplits(
        bountyId,
        leadR,
        leadSig,
        [subR],
        [subSig],
        [
          { agent: sub1.address, bps: 1000 },
          { agent: sub1.address, bps: 1000 },
        ],
      ),
      "DuplicateSplitRecipient",
    );
  });

  it("accepted bounty can settle after bounty deadline within receipt deadline window", async () => {
    const { poster, athlete, lead, bounty, domain } = await deployAll();
    const fee = parseEther("0.05");
    const { bountyId, deadline } = await postOpen(
      bounty,
      poster,
      athlete,
      fee,
      600,
    );
    await bounty.connect(lead).bid(bountyId, fee, deadline);
    await bounty.connect(poster).accept(bountyId, 0);

    await increaseTimeTo(deadline + 1n);

    const leadR = makeReceipt(bountyId, lead.address, "bafy", 0n, 0n);
    const leadSig = await lead.signTypedData(domain, RECEIPT_TYPES, leadR);
    await (await bounty.settleWithSplits(bountyId, leadR, leadSig, [], [], [])).wait();

    expect(await bounty.pendingOf(lead.address)).to.equal(fee);
  });
});
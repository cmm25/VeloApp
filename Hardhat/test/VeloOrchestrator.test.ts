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
  AbiCoder,
} from "ethers";
import type {
  VeloOrchestrator,
  AthleteSBT,
  MockAgentRegistry,
} from "../typechain-types";

const ZERO32 = "0x" + "0".repeat(64);
const DEFAULT_SUMMARY = "ok";

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

async function deployAll() {
  const [admin, coach, athlete, formAgent, prescriber, stranger] =
    await getSigners();

  const Registry = await getContractFactory("MockAgentRegistry");
  const registry = (await Registry.deploy()) as unknown as MockAgentRegistry;
  await registry.waitForDeployment();
  await (await registry.register(formAgent.address)).wait();
  await (await registry.register(prescriber.address)).wait();

  const SBT = await getContractFactory("AthleteSBT");
  const sbt = (await SBT.deploy(admin.address)) as unknown as AthleteSBT;
  await sbt.waitForDeployment();

  const Orch = await getContractFactory("VeloOrchestrator");
  const orch = (await Orch.deploy(
    admin.address,
    await registry.getAddress(),
    await sbt.getAddress(),
    parseEther("0.001"),
  )) as unknown as VeloOrchestrator;
  await orch.waitForDeployment();

  await (
    await sbt.grantRole(await sbt.APPENDER_ROLE(), await orch.getAddress())
  ).wait();

  const network = await provider.getNetwork();
  const domain = {
    name: "Velo",
    version: "1",
    chainId: network.chainId,
    verifyingContract: await orch.getAddress(),
  };

  return {
    admin,
    coach,
    athlete,
    formAgent,
    prescriber,
    stranger,
    registry,
    sbt,
    orch,
    domain,
  };
}

async function payJobAndGetId(
  orch: VeloOrchestrator,
  coach: any,
  athlete: any,
  videoCid: string,
  fee = parseEther("0.01"),
  ttl = 3600,
) {
  const deadline = BigInt((await getLatestTimestamp()) + ttl);
  const tx = await orch
    .connect(coach)
    .payJob(athlete.address, videoCid, deadline, { value: fee });
  const rc = await tx.wait();
  const log = rc!.logs.find(
    (l: any) => l.fragment?.name === "JobRequested",
  ) as any;
  return { jobId: log.args.jobId as string, deadline };
}

async function signReceipt(
  signer: any,
  domain: any,
  r: Receipt,
): Promise<string> {
  return signer.signTypedData(domain, RECEIPT_TYPES, r);
}

describe("VeloOrchestrator", () => {
  it("end-to-end: pay → form receipt → prescription → SBT append → withdraw", async () => {
    const { coach, athlete, formAgent, prescriber, orch, sbt, domain } =
      await deployAll();

    const { jobId, deadline } = await payJobAndGetId(
      orch,
      coach,
      athlete,
      "bafyVideo",
    );

    expect((await orch.getJob(jobId)).status).to.equal(1n);

    const formR: Receipt = {
      jobId,
      agent: formAgent.address,
      ipfsCid: "bafyFormReport",
      summaryHash: keccak256(toUtf8Bytes("form summary")),
      nonce: 0n,
      deadline,
      summary: DEFAULT_SUMMARY,
      priorReceiptHash: ZERO32,
    };
    const formSig = await signReceipt(formAgent, domain, formR);
    await (await orch.submitFormReceipt(formR, formSig)).wait();

    const stored = await orch.getFormReceipt(jobId);
    const priorDigest = keccak256(
      AbiCoder.defaultAbiCoder().encode(
        ["bytes32", "address", "string", "bytes32", "bytes32", "bytes32"],
        [
          stored.jobId,
          stored.agent,
          stored.ipfsCid,
          stored.summaryHash,
          keccak256(toUtf8Bytes(stored.summary)),
          stored.priorReceiptHash,
        ],
      ),
    );

    const presR: Receipt = {
      jobId,
      agent: prescriber.address,
      ipfsCid: "bafyPrescription",
      summaryHash: keccak256(toUtf8Bytes("prescription summary")),
      nonce: 0n,
      deadline,
      summary: DEFAULT_SUMMARY,
      priorReceiptHash: priorDigest,
    };
    const presSig = await signReceipt(prescriber, domain, presR);
    await (await orch.submitPrescription(presR, presSig)).wait();

    expect((await orch.getJob(jobId)).status).to.equal(3n);
    expect(await sbt.balanceOf(athlete.address)).to.equal(1n);
    expect(await sbt.receiptCount(athlete.address)).to.equal(1n);

    const formPending = await orch.pendingOf(formAgent.address);
    const presPending = await orch.pendingOf(prescriber.address);
    expect(formPending).to.equal((parseEther("0.01") * 4000n) / 10000n);
    expect(presPending).to.equal(parseEther("0.01") - formPending);

    await (await orch.connect(formAgent).withdraw()).wait();
    expect(await orch.pendingOf(formAgent.address)).to.equal(0n);
  });

  it("rejects prescription before form is submitted", async () => {
    const { coach, athlete, prescriber, orch, domain } = await deployAll();
    const { jobId, deadline } = await payJobAndGetId(orch, coach, athlete, "v");

    const presR: Receipt = {
      jobId,
      agent: prescriber.address,
      ipfsCid: "bafyPrescription",
      summaryHash: keccak256(toUtf8Bytes("p")),
      nonce: 0n,
      deadline,
      summary: DEFAULT_SUMMARY,
      priorReceiptHash: ZERO32,
    };
    const sig = await signReceipt(prescriber, domain, presR);
    await expectCustomError(
      orch.submitPrescription(presR, sig),
      "JobNotFormSubmitted",
    );
  });

  it("rejects unregistered agent submissions", async () => {
    const { coach, athlete, stranger, orch, domain } = await deployAll();
    const { jobId, deadline } = await payJobAndGetId(orch, coach, athlete, "v");

    const r: Receipt = {
      jobId,
      agent: stranger.address,
      ipfsCid: "bafy",
      summaryHash: keccak256(toUtf8Bytes("x")),
      nonce: 0n,
      deadline,
      summary: DEFAULT_SUMMARY,
      priorReceiptHash: ZERO32,
    };
    const sig = await signReceipt(stranger, domain, r);
    await expectCustomError(orch.submitFormReceipt(r, sig), "UnregisteredAgent");
  });

  it("rejects bad EIP-712 signature", async () => {
    const { coach, athlete, formAgent, prescriber, orch, domain } =
      await deployAll();
    const { jobId, deadline } = await payJobAndGetId(orch, coach, athlete, "v");
    const r: Receipt = {
      jobId,
      agent: formAgent.address,
      ipfsCid: "bafy",
      summaryHash: keccak256(toUtf8Bytes("x")),
      nonce: 0n,
      deadline,
      summary: DEFAULT_SUMMARY,
      priorReceiptHash: ZERO32,
    };
    const sig = await signReceipt(prescriber, domain, r);
    await expectCustomError(orch.submitFormReceipt(r, sig), "AgentMismatch");
  });

  it("rejects replayed nonce", async () => {
    const { coach, athlete, formAgent, orch, domain } = await deployAll();
    const { jobId: j1, deadline } = await payJobAndGetId(
      orch,
      coach,
      athlete,
      "v1",
    );

    const r1: Receipt = {
      jobId: j1,
      agent: formAgent.address,
      ipfsCid: "bafy1",
      summaryHash: keccak256(toUtf8Bytes("s1")),
      nonce: 0n,
      deadline,
      summary: DEFAULT_SUMMARY,
      priorReceiptHash: ZERO32,
    };
    await orch.submitFormReceipt(r1, await signReceipt(formAgent, domain, r1));

    const { jobId: j2 } = await payJobAndGetId(orch, coach, athlete, "v2");
    const r2: Receipt = { ...r1, jobId: j2, ipfsCid: "bafy2" };
    await expectCustomError(
      orch.submitFormReceipt(r2, await signReceipt(formAgent, domain, r2)),
      "BadNonce",
    );
  });

  it("rejects prescription that did not read the form from chain", async () => {
    const { coach, athlete, formAgent, prescriber, orch, domain } =
      await deployAll();
    const { jobId, deadline } = await payJobAndGetId(orch, coach, athlete, "v");

    const formR: Receipt = {
      jobId,
      agent: formAgent.address,
      ipfsCid: "bafyForm",
      summaryHash: keccak256(toUtf8Bytes("f")),
      nonce: 0n,
      deadline,
      summary: DEFAULT_SUMMARY,
      priorReceiptHash: ZERO32,
    };
    await orch.submitFormReceipt(
      formR,
      await signReceipt(formAgent, domain, formR),
    );

    const wrongPrior = keccak256(toUtf8Bytes("not the real prior"));
    const presR: Receipt = {
      jobId,
      agent: prescriber.address,
      ipfsCid: "bafyPres",
      summaryHash: keccak256(toUtf8Bytes("p")),
      nonce: 0n,
      deadline,
      summary: DEFAULT_SUMMARY,
      priorReceiptHash: wrongPrior,
    };
    await expectCustomError(
      orch.submitPrescription(
        presR,
        await signReceipt(prescriber, domain, presR),
      ),
      "PriorReceiptMismatch",
    );
  });

  it("cancelExpired refunds coach via pull-payment", async () => {
    const { coach, athlete, orch } = await deployAll();
    const fee = parseEther("0.02");
    const { jobId, deadline } = await payJobAndGetId(
      orch,
      coach,
      athlete,
      "v",
      fee,
      60,
    );
    await increaseTimeTo(deadline + 1n);
    await orch.connect(coach).cancelExpired(jobId);
    expect(await orch.pendingOf(coach.address)).to.equal(fee);
  });

  it("pause blocks state-changing entrypoints", async () => {
    const { admin, coach, athlete, orch } = await deployAll();
    await orch.connect(admin).pause();
    const deadline = BigInt((await getLatestTimestamp()) + 3600);
    await expectCustomError(
      orch.connect(coach).payJob(athlete.address, "v", deadline, {
        value: parseEther("0.01"),
      }),
      "EnforcedPause",
    );
  });

  it("rejects form receipt whose deadline outlasts the job deadline", async () => {
    const { coach, athlete, formAgent, orch, domain } = await deployAll();
    const { jobId, deadline } = await payJobAndGetId(orch, coach, athlete, "v");
    const r: Receipt = {
      jobId,
      agent: formAgent.address,
      ipfsCid: "bafy",
      summaryHash: keccak256(toUtf8Bytes("s")),
      nonce: 0n,
      deadline: deadline + 10_000n,
      summary: DEFAULT_SUMMARY,
      priorReceiptHash: ZERO32,
    };
    await expectCustomError(
      orch.submitFormReceipt(r, await signReceipt(formAgent, domain, r)),
      "ReceiptDeadlineAfterJob",
    );
  });

  it("rejects fee below minJobFee", async () => {
    const { coach, athlete, orch } = await deployAll();
    const deadline = BigInt((await getLatestTimestamp()) + 3600);
    await expectCustomError(
      orch.connect(coach).payJob(athlete.address, "v", deadline, { value: 1n }),
      "InsufficientFee",
    );
  });
});

describe("AthleteSBT (soulbound)", () => {
  it("blocks transfer / approve / setApprovalForAll", async () => {
    const { admin, athlete, stranger, sbt, orch } = await deployAll();
    await sbt.grantRole(await sbt.APPENDER_ROLE(), admin.address);
    await sbt.connect(admin).appendReceipt(athlete.address, {
      jobId: keccak256(toUtf8Bytes("j")),
      ipfsCid: "bafy",
      summaryHash: keccak256(toUtf8Bytes("s")),
      timestamp: BigInt(await getLatestTimestamp()),
      formAgent: admin.address,
      prescriptionAgent: admin.address,
    });
    const tokenId = await sbt.tokenIdOf(athlete.address);
    await expectCustomError(
      sbt.connect(athlete).transferFrom(athlete.address, stranger.address, tokenId),
      "SoulboundNonTransferable",
    );
    await expectCustomError(
      sbt.connect(athlete).approve(stranger.address, tokenId),
      "SoulboundNonApprovable",
    );
    await expectCustomError(
      sbt.connect(athlete).setApprovalForAll(stranger.address, true),
      "SoulboundNonApprovable",
    );
    expect(await sbt.locked(tokenId)).to.equal(true);

    const uri = await sbt.tokenURI(tokenId);
    expect(uri.startsWith("data:application/json;base64,")).to.equal(true);
    const json = JSON.parse(
      Buffer.from(uri.split(",")[1], "base64").toString("utf8"),
    );
    expect(json.name).to.contain("Velo Athlete History");
    expect(json.receipts).to.have.lengthOf(1);
    expect(json.receipts[0].ipfsCid).to.equal("bafy");
    void orch;
  });
});
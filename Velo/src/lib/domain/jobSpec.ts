import { keccak256, toBytes, type Hex } from "viem";

/**
 * Off-chain model-selection routing (frontend mirror of the agent runner's
 * `chain/job-spec.ts`). The direct-pay contract call has no field for the
 * coach's chosen analysis model, so when the coach picks a NON-default model the
 * selected skill is encoded into the opaque `videoCid` string:
 *
 *   velo+skill:<0x…skillHash>;<rawVideoCid>
 *
 * A default (pose/Form) selection passes the RAW cid unchanged, so existing jobs
 * are byte-for-byte identical. `useVeloContracts` decodes on read, so every
 * display surface transparently sees the raw cid again.
 */

export const JOB_SPEC_PREFIX = "velo+skill:";

export interface JobSpec {
  skill: Hex | null;
  videoCid: string;
}

const SKILL_HEX = /^0x[0-9a-fA-F]{64}$/;

/** keccak256(utf8(name)) — matches the contracts + agent registry. */
export function skillHashOf(name: string): Hex {
  return keccak256(toBytes(name));
}

/** Encode a chosen skill + raw cid into the routable videoCid string. */
export function encodeJobSpec(skill: Hex, videoCid: string): string {
  return `${JOB_SPEC_PREFIX}${skill.toLowerCase()};${videoCid}`;
}

/**
 * Decode a stored videoCid into its skill + raw cid. Anything that is not a
 * well-formed spec decodes to `{ skill: null, videoCid: <input> }`.
 */
export function decodeJobSpec(raw: string): JobSpec {
  if (!raw.startsWith(JOB_SPEC_PREFIX)) return { skill: null, videoCid: raw };
  const rest = raw.slice(JOB_SPEC_PREFIX.length);
  const sep = rest.indexOf(";");
  if (sep === -1) return { skill: null, videoCid: raw };
  const skill = rest.slice(0, sep);
  const videoCid = rest.slice(sep + 1);
  if (!SKILL_HEX.test(skill) || videoCid.length === 0) {
    return { skill: null, videoCid: raw };
  }
  return { skill: skill.toLowerCase() as Hex, videoCid };
}

import { keccak256, toUtf8Bytes } from "ethers";

/**
 * Off-chain model-selection routing.
 *
 * The direct-pay path (`payJob(athlete, videoCid, deadline)`) has no on-chain
 * field for the coach's chosen analysis model, and we deliberately avoid a
 * contract change (see task notes). Instead, when the coach picks a NON-default
 * model, the chosen skill is encoded into the opaque `videoCid` string the
 * contract already stores:
 *
 *   velo+skill:<0x…skillHash>;<rawVideoCid>
 *
 * Each agent decodes the job spec and self-filters by skill before acting:
 *   - skill === null  → legacy/default job → the Form agent handles it
 *   - skill === <its advertised skill> → that agent handles it
 *
 * A default (Form/pose) selection passes the RAW cid unchanged, so the existing
 * pipeline is byte-for-byte identical when no extra model is configured. The
 * bounty path keeps using on-chain `requiredSkills` and is unaffected.
 */

export const JOB_SPEC_PREFIX = "velo+skill:";

export interface JobSpec {
  /** Lowercased bytes32 skill hash the coach selected, or null for default. */
  skill: string | null;
  /** The raw video CID with any routing prefix stripped. */
  videoCid: string;
}

/** keccak256(utf8(name)) — the same hashing the contracts/registry use. */
export function skillHash(name: string): string {
  return keccak256(toUtf8Bytes(name)).toLowerCase();
}

const SKILL_HEX = /^0x[0-9a-fA-F]{64}$/;

/** Encode a chosen skill + raw cid into the routable videoCid string. */
export function encodeJobSpec(skillHashHex: string, videoCid: string): string {
  return `${JOB_SPEC_PREFIX}${skillHashHex.toLowerCase()};${videoCid}`;
}

/**
 * Decode a stored videoCid into its skill + raw cid. Any string that is not a
 * well-formed `velo+skill:` spec (legacy cids, bounty cids, garbage) decodes to
 * `{ skill: null, videoCid: <input> }` so it routes to the default Form agent.
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
  return { skill: skill.toLowerCase(), videoCid };
}

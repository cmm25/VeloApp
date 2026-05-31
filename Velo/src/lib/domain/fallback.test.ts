import { describe, it, expect } from "vitest";
import { cleanFallbackReason } from "./fallback";

describe("cleanFallbackReason", () => {
  it("returns an empty string for undefined input", () => {
    expect(cleanFallbackReason(undefined)).toBe("");
  });

  it("returns an empty string for empty or whitespace-only input", () => {
    expect(cleanFallbackReason("")).toBe("");
    expect(cleanFallbackReason("   ")).toBe("");
  });

  it("leaves an already-clean message untouched", () => {
    expect(cleanFallbackReason("Somnia agents timed out")).toBe(
      "Somnia agents timed out",
    );
  });

  it("trims surrounding whitespace from a clean message", () => {
    expect(cleanFallbackReason("   Somnia agents timed out   ")).toBe(
      "Somnia agents timed out",
    );
  });

  it("cuts an ethers CALL_EXCEPTION dump at the (action= marker", () => {
    const raw =
      'execution reverted: insufficient stake (action="call", data="0x1234", code=CALL_EXCEPTION, version=6.0.0)';
    expect(cleanFallbackReason(raw)).toBe(
      "execution reverted: insufficient stake",
    );
  });

  it("cuts at the Last RPC error marker", () => {
    const raw = "missing revert data Last RPC error: timeout connecting to node";
    expect(cleanFallbackReason(raw)).toBe("missing revert data");
  });

  it("cuts at the (error= marker", () => {
    const raw = "could not coalesce error (error={...}, code=UNKNOWN_ERROR)";
    expect(cleanFallbackReason(raw)).toBe("could not coalesce error");
  });

  it("cuts at a bare code=CALL_EXCEPTION marker", () => {
    const raw = "call revert exception code=CALL_EXCEPTION, version=6.0.0";
    expect(cleanFallbackReason(raw)).toBe("call revert exception");
  });

  it('cuts at the data="0x marker', () => {
    const raw = 'reverted data="0x08c379a0"';
    expect(cleanFallbackReason(raw)).toBe("reverted");
  });

  it("cuts at the earliest of several markers", () => {
    const raw =
      'reverted (action="estimateGas") Last RPC error code=CALL_EXCEPTION';
    expect(cleanFallbackReason(raw)).toBe("reverted");
  });

  it("strips a dangling em-dash / opener left behind by the cut", () => {
    const raw = 'Network unstable — (action="call", code=CALL_EXCEPTION)';
    expect(cleanFallbackReason(raw)).toBe("Network unstable");
  });

  it("does not truncate when a marker appears without its leading space (e.g. at index 0)", () => {
    // Markers require a leading space, so a string that starts with the
    // marker text (no preceding space) is kept intact rather than cut to "".
    expect(cleanFallbackReason("(action=call) failed")).toBe(
      "(action=call) failed",
    );
    expect(cleanFallbackReason("code=CALL_EXCEPTION raised")).toBe(
      "code=CALL_EXCEPTION raised",
    );
  });

  it("does not truncate a marker that is missing its leading space mid-string", () => {
    expect(cleanFallbackReason("reverted(action=call)")).toBe(
      "reverted(action=call)",
    );
  });
});

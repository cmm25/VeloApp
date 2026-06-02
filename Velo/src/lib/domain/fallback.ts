/**
 * The raw `fallbackReason` can carry an ethers `CALL_EXCEPTION` dump (action,
 * data="0x…", code, version) that overflows the card. Keep only the concise
 * human-readable lead, cutting at the first raw-detail marker.
 */
export function cleanFallbackReason(raw: string | undefined): string {
  if (!raw) return "";
  let s = raw.trim();
  const markers = [
    " Last RPC error",
    " (action=",
    " (error=",
    " code=CALL_EXCEPTION",
    ' data="0x',
  ];
  let cut = s.length;
  for (const m of markers) {
    const i = s.indexOf(m);
    if (i !== -1 && i < cut) cut = i;
  }
  s = s.slice(0, cut).trim();
  // Drop any dangling opener / dash left behind by the cut.
  return s.replace(/[\s—(]+$/, "").trim();
}

import { keccak256, toHex, type Hex } from "viem";
import { canonicalJson } from "./hash";

/**
 * Salted commitments. The decision log is public, but a business's hurdle, floor and limits are private and low-entropy: an
 * unsalted hash of them could be brute-forced from the public log. So the log carries `keccak256(canonicalJson({ salt, value }))`
 * with a 32-byte salt that never leaves the agent's machine. It proves "this decision used exactly this policy and these
 * inputs" to anyone the owner later shows the value and the salt to, and reveals nothing otherwise.
 */
export function commitTo(value: unknown, salt: Hex): Hex {
  return keccak256(toHex(canonicalJson({ salt, value })));
}

export function isHex32(v: unknown): v is Hex {
  return typeof v === "string" && /^0x[0-9a-fA-F]{64}$/.test(v);
}

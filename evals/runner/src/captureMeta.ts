import { existsSync, readFileSync, writeFileSync } from "node:fs";

/**
 * Durable provenance for the committed fixture set (L5-C18).
 *
 * L5-C18 requires the scorecard to carry the CAPTURE date. That number cannot be derived at scoring
 * time: `make evals` runs in REPLAY, so "now" is the day someone ran CI, which may be months after
 * the bytes were recorded and is exactly the misleading value the condition exists to prevent. File
 * mtimes do not survive a clone. So the capture date has to be written down WHEN THE CAPTURE
 * HAPPENS and committed alongside the fixtures it describes.
 *
 * Record mode writes this file; replay mode only reads it. It lives beside the recordings directory
 * rather than inside it, so it never has to be special-cased out of the orphan check or the
 * provenance scan (both of which walk `*.json` under `recordings/`).
 *
 * It is a CLAIM, and a thin one: nothing cryptographically binds this date to those bytes. Its value
 * is that it is written by the capture rather than asserted afterwards by a person, and that it is
 * committed in the same change as the fixtures, so `git log` can corroborate it. The scorecard
 * fields it feeds are provenance, not measurement.
 */
export interface CaptureMeta {
  /** ISO date (YYYY-MM-DD) the capture that produced the committed fixtures ran. */
  captured_at: string;
  /** `PROMPT_VERSION` at capture time. */
  prompt_version: string;
  /** sha256 of the trimmed prompt text that went on the wire, at capture time. */
  prompt_sha256: string;
  /** The distinct models that answered during the capture, sorted. */
  served_models: string[];
}

export function writeCaptureMeta(path: string, meta: CaptureMeta): void {
  writeFileSync(path, JSON.stringify(meta, null, 2) + "\n");
}

/** Null when absent, which is the honest answer for a fixture set captured before this existed. */
export function readCaptureMeta(path: string): CaptureMeta | null {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as CaptureMeta;
}

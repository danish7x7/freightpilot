/**
 * The single source of truth for the prompt version (guardian condition C5).
 *
 * `v0-none` = the PROMPTLESS baseline: the D14 turn boundary drives the loop with the user
 * message + tool schemas ALONE, no system prompt (turnService.ts:55-57). Every scorecard is
 * stamped with this, and it is mixed into the replay key (§3) so that when the L5 prompt PR
 * introduces a real system prompt it bumps this sentinel — invalidating every v0-none recording
 * and forcing a fresh capture. The v0-none recordings are THROWAWAY by design (see
 * src/recordings/README.md).
 *
 * The L5 prompt PR bumps this (e.g. to `v1`) — it is the ONLY thing that should change here.
 */
export const PROMPT_VERSION = "v0-none";

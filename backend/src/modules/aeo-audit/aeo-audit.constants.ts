/**
 * Every tuned threshold/budget for the AEO Audit module.
 *
 * @module aeo-audit/aeo-audit.constants
 */

/** Audit-wide spend ceiling across every surface x market measurement run plus stance plus narrative. */
export const DEFAULT_MAX_COST_PER_AUDIT = 10.0;

/** Raw answer text is capped before it's sent to the stance judge — long pages of quoted text add cost without adding signal. */
export const STANCE_ANSWER_CHAR_CAP = 12_000;
export const STANCE_MAX_TOKENS = 900;
export const STANCE_EVIDENCE_QUOTE_CAP = 280;

export const NARRATIVE_MAX_TOKENS = 700;
export const NARRATIVE_MAX_HEADLINES = 8;
export const NARRATIVE_HEADLINE_CHAR_CAP = 220;

/** The only numeric threshold in verdict assembly: engines are "uneven" once the gap exceeds this, else "consistent". */
export const UNEVEN_ENGINE_GAP = 0.05;

export const MAX_LOSING_PROMPTS = 25;
export const MAX_WINNING_PROMPTS = 25;

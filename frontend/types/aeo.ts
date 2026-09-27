/**
 * AI visibility tab types — a thin mirror of the AEO audit verdict.
 * Reads only; audits are created by the Day-1 pipeline or staff.
 */

export type AeoAuditStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface AeoAudit {
  id: string;
  projectId: string;
  surfaces: string[];
  markets: string[];
  status: AeoAuditStatus;
  finishedAt: string | null;
  createdAt: string;
}

export interface SliceMetrics {
  observations: number;
  mentionRate: number;
  citationRate: number;
}

export interface CompetitorStanding {
  name: string;
  timesAhead: number;
  timesBehind: number;
  coMentions: number;
}

export type Stance =
  | 'recommended_primary'
  | 'recommended_alternative'
  | 'mentioned_neutral'
  | 'mentioned_negative'
  | 'absent';

export interface AeoVerdict {
  counted: {
    overall: SliceMetrics;
    unbranded: SliceMetrics | null;
    branded: SliceMetrics | null;
    bySurface: Array<{ surface: string } & SliceMetrics>;
    byFunnelStage: Array<{ funnelStage: string } & SliceMetrics>;
    competitorStanding: CompetitorStanding[];
  };
  judged: {
    stanceCounts: Record<Stance, number>;
    losingPrompts: Array<{ observationId: string; prompt: string; losesTo: string[] }>;
    winningPrompts: Array<{ observationId: string; prompt: string }>;
  } | null;
  headlines: string[];
  narrative?: string[];
}

export const SURFACE_LABEL: Record<string, string> = {
  cloro_chatgpt: 'ChatGPT',
  cloro_perplexity: 'Perplexity',
  cloro_gemini: 'Gemini',
  cloro_ai_overview: 'AI Overview',
  cloro_ai_mode: 'AI Mode',
  mock: 'Mock',
};

export const STANCE_LABEL: Record<Stance, string> = {
  recommended_primary: 'Recommended first',
  recommended_alternative: 'Recommended alternative',
  mentioned_neutral: 'Mentioned neutrally',
  mentioned_negative: 'Mentioned negatively',
  absent: 'Absent',
};

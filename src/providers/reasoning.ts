import { APICallError, RetryError, type streamText } from 'ai';
import type { ReasoningEffort, Vendor } from '../shared/types';

export type SdkReasoning = Parameters<typeof streamText>[0]['reasoning'];

export interface StepReasoningContext {
  effort: ReasoningEffort;
  vendor: Vendor;
  modelId: string;
  /** Number of tool steps completed so far in this turn (0 on the initial call). */
  stepCount: number;
  /** True when the turn hit maxSteps and must write the final answer now. */
  atLimit: boolean;
  /** True when the model rejected tools and is answering as plain chat. */
  chatOnly: boolean;
  /** Consecutive tool errors so far. */
  consecutiveErrors: number;
  /** True when the previous step was a routine browser action that succeeded cleanly. */
  routineFollowUp: boolean;
  /** True when the turn loaded skills or has multi-stage progress sections. */
  complexTask: boolean;
  /** True when the user's request looks short and lightweight on the initial step. */
  simpleRequest: boolean;
}

/** Complex task keywords that deserve deeper planning even when phrased briefly. */
const COMPLEX_INTENT =
  /\b(?:compare|comparison|research|investigate|analy[sz]e|audit|debug|architect|design|plan|book|buy|order|checkout|monitor|watch|verify|trust|reputation|reviews?|prices?)\b|对比|比较|比价|调研|研究|分析|审计|排查|规划|设计|架构|预订|购买|下单|监控|靠谱|口碑|评价|避坑|值不值/i;

/** Clear lightweight intents that rarely benefit from long reasoning chains. */
const SIMPLE_INTENT =
  /^(?:please\s+)?(?:summari[sz]e|translate|explain|define|rewrite|polish|paraphrase|extract|list|open|click|scroll|go\s+to|what\s+is|what\s+does|who\s+is)\b|^(?:请|帮我)?(?:总结|概括|提炼|翻译|解释|改写|润色|提取|列出|打开|点一下|点击|滚动|这是什么|什么是)/i;

/**
 * Heuristic for whether an initial user request is lightweight enough to start
 * at `low` effort under `auto`. Conservative: ambiguous or analytical prompts
 * keep `medium`.
 */
export function isSimpleRequest(goal: string, hasSkills: boolean, hasAttachments: boolean): boolean {
  if (hasSkills) return false;
  const text = goal.replace(/\s+/g, ' ').trim();
  if (!text) return true;
  if (COMPLEX_INTENT.test(text)) return false;
  if (text.length <= 120 && SIMPLE_INTENT.test(text)) return true;
  if (hasAttachments && text.length <= 80) return true;
  return text.length <= 36;
}

/**
 * Lowest reasoning value accepted by a vendor/model when `off` is chosen.
 * OpenAI o-series (`o1`/`o3`/`o4-mini`) reject `'none'` and drop unsupported
 * values back to the provider default (`medium`), so we clamp to `'low'`
 * (`'minimal'` for plain `gpt-5`).
 */
export function minimumReasoningFor(vendor: Vendor, modelId: string): SdkReasoning {
  if (vendor === 'openai') {
    if (/^o[134](?:[-.]|$)/i.test(modelId)) return 'low';
    if (/^gpt-5(?:-(?:mini|nano))?(?:-\d{4}-\d{2}-\d{2})?$/i.test(modelId)) return 'minimal';
  }
  return 'none';
}

/** Reasoning effort for one model call in the main assistant loop. */
export function resolveStepReasoning(ctx: StepReasoningContext): SdkReasoning {
  switch (ctx.effort) {
    case 'off':
      return minimumReasoningFor(ctx.vendor, ctx.modelId);
    case 'low':
      return 'low';
    case 'medium':
      return 'medium';
    case 'high':
      return 'high';
    case 'auto': {
      if (ctx.consecutiveErrors >= 1) return 'medium';
      if (ctx.atLimit) return 'medium';
      if (ctx.stepCount === 0) return ctx.simpleRequest && !ctx.complexTask ? 'low' : 'medium';
      // Routine browser steps (click/type/scroll/navigate) stay fast on `low`
      // without disabling thinking mid-turn (preserving prompt cache & thinking continuity).
      if (ctx.routineFollowUp) return 'low';
      return 'medium';
    }
  }
}

/**
 * Reasoning effort for helper model calls (page extraction, per-page research
 * notes, screenshot descriptions, and background watch verdicts). Always light
 * so auxiliary tasks never burn long reasoning chains.
 */
export function auxiliaryReasoning(effort: ReasoningEffort, vendor: Vendor, modelId: string): SdkReasoning {
  return effort === 'off' || effort === 'auto' ? minimumReasoningFor(vendor, modelId) : 'low';
}

/**
 * Omits `temperature` for vendors that reject or ignore it while thinking is active.
 */
export function temperatureFor(vendor: Vendor, reasoning: SdkReasoning, configured: number | undefined): number | undefined {
  if (configured === undefined) return undefined;
  const thinkingActive = reasoning !== undefined && reasoning !== 'none' && reasoning !== 'provider-default';
  if (thinkingActive && (vendor === 'anthropic' || vendor === 'deepseek')) return undefined;
  return configured;
}

/** True when a provider or OpenAI-compatible gateway rejected the reasoning/effort parameter. */
export function rejectsReasoning(error: unknown): boolean {
  const cause = RetryError.isInstance(error) ? error.lastError : error;
  if (!APICallError.isInstance(cause)) return false;
  const status = cause.statusCode ?? 0;
  return (
    [400, 404, 422].includes(status) &&
    /reasoning|thinking|effort|budget_tokens|output_config|extra_forbidden|unrecognized_keys|unknown.*param|unsupported.*param/i.test(
      `${cause.message} ${cause.responseBody ?? ''}`,
    )
  );
}

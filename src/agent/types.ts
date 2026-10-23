import type { AgentMode, ErrorInfo, ModelRef, Usage } from '../shared/types';

/** 0 read-only · 1 reversible · 2 has effects · 3 high risk (§8.1). */
export type RiskLevel = 0 | 1 | 2 | 3;

export type AgentStatus = 'running' | 'paused' | 'waiting' | 'done' | 'failed' | 'stopped';

export const ACTIVE_STATUSES: AgentStatus[] = ['running', 'paused', 'waiting'];

export type ActionStatus = 'running' | 'awaiting' | 'done' | 'error' | 'rejected' | 'skipped';

export interface AgentAction {
  id: string;
  tool: string;
  args: Record<string, unknown>;
  /** Short description of the target element, e.g. `button "Add to cart"`. */
  target?: string;
  risk: RiskLevel;
  status: ActionStatus;
  /** Shown to the model in later steps; clipped. */
  result?: string;
}

/** One model call that used tools: the text it wrote first, then its tool calls. */
export interface AgentStep {
  index: number;
  url?: string;
  thought?: string;
  actions: AgentAction[];
}

export type HandoffReason = 'captcha' | 'login' | 'verification' | 'other';

export type WaitReason =
  | { kind: 'approval'; actionId: string; risk: RiskLevel; reason: RiskReason; site: string; target: string; tool: string }
  | { kind: 'question'; question: string }
  | { kind: 'handoff'; reason: HandoffReason; message?: string; site: string }
  | { kind: 'permission'; origin: string; url: string };

export type RiskReason = 'payment' | 'destructive' | 'submit' | 'confirmEach' | 'manualMode' | 'sensitiveField';

export type PauseReason = 'user' | 'interference' | 'debuggerDetached';

/**
 * One assistant turn: the reply to a user message. It may answer right away
 * or use tools (read the page, search, operate the browser) first (M1.5).
 */
export interface AgentTask {
  id: string;
  conversationId: string;
  /** The user's request, for notifications. */
  goal: string;
  /** The turn's view goes after this message (the request, or the last message when retrying). */
  anchorMessageId: string;
  status: AgentStatus;
  steps: AgentStep[];
  /** Text of the model call in progress, streamed to the panel. */
  draft: string;
  waiting?: WaitReason;
  pauseReason?: PauseReason;
  result?: { success: boolean; summary: string };
  error?: ErrorInfo;
  usage: Usage;
  /** Input driver, set once the turn has operated a page. */
  driver?: 'cdp' | 'dom';
  model: ModelRef;
  mode: AgentMode;
  /** The model rejected tools, so this turn is plain chat. */
  chatOnly?: boolean;
  startTabId: number;
  /** The tab the turn is working in now. */
  tabId?: number;
  /** Tabs this turn moved into its tab group (restored on a new chat). */
  groupedTabs?: number[];
  /** Tabs this turn opened. */
  openedTabs?: number[];
  maxSteps: number;
  createdAt: number;
  updatedAt: number;
}

export type ApprovalDecision = 'allowOnce' | 'allowTask' | 'allowSite' | 'deny';

export type WaitResponse =
  | { kind: 'approval'; decision: ApprovalDecision }
  | { kind: 'answer'; text: string }
  | { kind: 'continue' }
  | { kind: 'permission'; granted: boolean };

/** Port between the side panel and the background agent service. */
export const AGENT_PORT_NAME = 'agent';

export type AgentClientMessage =
  | { type: 'start'; taskId: string; conversationId: string; anchorMessageId: string; tabId?: number }
  /** A new chat: put tabs grouped by this conversation's turns back as they were. */
  | { type: 'release'; conversationId: string }
  | { type: 'closeTabs'; taskId: string }
  | { type: 'subscribe' }
  | { type: 'pause'; taskId: string }
  | { type: 'resume'; taskId: string }
  | { type: 'stop'; taskId: string }
  | { type: 'takeOver'; taskId: string }
  | { type: 'respond'; taskId: string; response: WaitResponse }
  | { type: 'ping' };

export type AgentServerMessage = { type: 'task'; task: AgentTask };

/** Sent by the in-page overlay buttons and the user-input watcher. */
export interface OverlayMessage {
  type: 'agent.overlay';
  action: 'stop' | 'continue' | 'interference';
}

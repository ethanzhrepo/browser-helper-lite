import type { ErrorInfo, ModelRef, Usage } from '../shared/types';

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

export type RiskReason = 'payment' | 'destructive' | 'submit' | 'confirmEach' | 'sensitiveField';

export type PauseReason = 'user' | 'interference' | 'debuggerDetached';

export interface AgentTask {
  id: string;
  conversationId: string;
  goal: string;
  status: AgentStatus;
  steps: AgentStep[];
  waiting?: WaitReason;
  pauseReason?: PauseReason;
  result?: { success: boolean; summary: string };
  error?: ErrorInfo;
  usage: Usage;
  driver: 'cdp' | 'dom';
  model: ModelRef;
  startTabId: number;
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
  | { type: 'start'; taskId: string; conversationId: string; goal: string; tabId: number }
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

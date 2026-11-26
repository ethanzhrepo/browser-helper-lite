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
  /** Where a click or a pointer landed, in CSS pixels of the viewport (for the replay). */
  point?: { x: number; y: number };
}

/** One model call that used tools: the text it wrote first, then its tool calls. */
export interface AgentStep {
  index: number;
  url?: string;
  thought?: string;
  actions: AgentAction[];
  /** A picture of the page before this step was stored for the replay (see StepShot). */
  shot?: boolean;
}

/**
 * A small screenshot of the tab before a step that acted on it, or after the
 * last one. Kept apart from the task: a task is sent to the panel many times
 * a second while it runs, and pictures would make that heavy.
 */
export interface StepShot {
  /** `${taskId}:${step}`. */
  id: string;
  taskId: string;
  conversationId: string;
  /** The step's index; one past the last step for the picture taken at the end. */
  step: number;
  /** Base64 JPEG. */
  image: string;
  width: number;
  height: number;
  /** How many CSS pixels of the page the picture's width shows. */
  cssWidth: number;
  url: string;
  at: number;
}

export type HandoffReason = 'captcha' | 'login' | 'verification' | 'other';

export type WaitReason =
  | {
      kind: 'approval';
      actionId: string;
      risk: RiskLevel;
      reason: RiskReason;
      site: string;
      target: string;
      tool: string;
      /** Set when the step sends a form with Enter: the form's submit button text ('' when it has none). */
      submits?: string;
      /** For a click by coordinates: the part of the screenshot around the point, as a data URL. */
      preview?: string;
    }
  | { kind: 'question'; question: string }
  | { kind: 'handoff'; reason: HandoffReason; message?: string; site: string; /** The tab the user is needed in, when it is not the one the task works in (a search). */ tabId?: number }
  | { kind: 'permission'; origin: string; url: string };

export type RiskReason =
  | 'payment'
  | 'destructive'
  | 'submit'
  | 'confirmEach'
  | 'manualMode'
  | 'sensitiveField'
  /** The turn read content that tried to instruct the assistant (§8.2). */
  | 'injection'
  /** A URL the model built carries data such as an email address or a long code. */
  | 'exfiltration'
  /** A URL the model built leads to a site that has not come up in the task. */
  | 'newSite'
  /** The text to type looks like an API key, access token or private key. */
  | 'secret'
  /** A key combination that pastes the user's clipboard. */
  | 'clipboard'
  /** The click or key lands in a frame from another site, which the extension cannot read. */
  | 'frame'
  /** A click by coordinates on drawn content (a canvas, a video), which the extension cannot read. */
  | 'unseen'
  /** Starts a watch: the page will be read again and again in the background until the condition holds. */
  | 'watch'
  /** Acts in the user's name on a forum or social site: a like, a vote, a follow, a post. */
  | 'social'
  /** Downloads a file (a program is high risk). */
  | 'download'
  /** Account security, credentials, payments or a cloud console: every change is confirmed. */
  | 'sensitivePage';

/** Content that looked like it was trying to instruct the assistant. */
export interface InjectionWarning {
  source: 'page' | 'search' | 'attachment';
  url?: string;
  excerpt: string;
  /** The text was hidden from people (invisible on the page). */
  hidden: boolean;
}

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
  /** Live reasoning of the model call in progress, streamed while thinking and cleared once the step ends. */
  thinking?: string;
  /**
   * Parts of the answer the assistant gave while still working, one for each
   * stage of a longer task (report_progress). They are shown as they come,
   * and the final reply follows them.
   */
  sections?: string[];
  /** The stage of a longer task that was reported last: its name, and where it is among the stages. */
  stage?: { name: string; step?: number; of?: number };
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
  /** Set when the turn read content that tried to instruct it; from then on it is cautious. */
  injection?: InjectionWarning;
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
  /** Replaced by a new reply: emptied and no longer shown; kept for the tabs it grouped. */
  discardedAt?: number;
}

export type ApprovalDecision = 'allowOnce' | 'allowTask' | 'allowSite' | 'deny';

export type WaitResponse =
  /** `actionId` names the action the user saw, so an answer never applies to another one. */
  | { kind: 'approval'; actionId: string; decision: ApprovalDecision; /** For a watch: how often to look, as the user chose on the card. */ everySeconds?: number }
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
  /** Something the user adds while the turn is under way ("not that brand"); the assistant reads it before its next step. */
  | { type: 'say'; taskId: string; text: string }
  | { type: 'ping' };

export type AgentServerMessage = { type: 'task'; task: AgentTask };

/** Sent by the in-page overlay buttons and the user-input watcher. */
export interface OverlayMessage {
  type: 'agent.overlay';
  action: 'stop' | 'continue' | 'panel' | 'interference';
}

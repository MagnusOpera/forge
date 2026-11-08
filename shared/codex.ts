import type { GitAction, GitActionResult, GitFileHistory, GitHistoricalTree, GitHistory, GitPreview, GitSnapshot } from "./git-explorer.js";
export type JsonObject = Record<string, unknown>;
// Raise when Forge's integration requires a newer Codex app-server release.
export const MINIMUM_CODEX_VERSION = "0.164.0";
export type CodexPreferences = {
  model: string;
  effort: string;
  speed: "normal" | "fast";
  mode: "implement" | "plan";
  followUp: "steer" | "queue";
  permissions: "ask" | "strict" | "full";
};
export const defaultCodexPreferences: CodexPreferences = {
  model: "",
  effort: "",
  speed: "normal",
  mode: "implement",
  followUp: "steer",
  permissions: "ask",
};
export type CodexEnvironment = {
  id: string;
  name: string;
  host: string;
  executable: string;
};
export type CodexEnvironmentCheck = {
  ready: boolean;
  message: string;
  version?: string;
};
export type CodexProject = {
  repositoryId: string;
  name?: string;
  path: string;
  overrides: Partial<CodexPreferences>;
  remotePaths?: Record<string, string>;
  accountOverride?: boolean;
  defaultEnvironment?: string;
  defaultThreadStart?: CodexThreadStartKind;
  warning?: string;
  dirty?: boolean;
};
export const DEFAULT_TEXT_EDITOR = "Visual Studio Code";
export type CodexSendShortcut = "enter" | "command-enter";
export type CodexConfiguration = {
  version?: number;
  environments?: CodexEnvironment[];
  sendShortcut?: CodexSendShortcut;
  defaultThreadStart?: CodexThreadStartKind;
  editor: string;
  defaults: CodexPreferences;
  executable: string;
  projects: Record<string, CodexProject>;
};
export type CodexModel = {
  id: string;
  name: string;
  efforts: string[];
  defaultEffort: string;
  isDefault: boolean;
  fast: boolean;
  images: boolean;
};
export type CodexStatus = {
  loginPending?: boolean;
  connected: boolean;
  authenticated: boolean;
  email?: string;
  plan?: string;
  error?: string;
  version?: string;
};
export type CodexFileChange = { path: string; diff: string };
export type CodexMessageAttachment = { name: string; href: string; kind: "image" | "document" };
export type CodexItem = {
  id: string;
  kind: string;
  text: string;
  images?: string[];
  attachments?: CodexMessageAttachment[];
  changes?: CodexFileChange[];
  status?: string;
  turnId?: string;
  phase?: "commentary" | "final_answer";
  createdAt?: number;
};
export function latestCodexUserMessage(
  items: CodexItem[],
): CodexItem | undefined {
  for (let index = items.length - 1; index >= 0; index--)
    if (items[index].kind === "userMessage") return items[index];
  return undefined;
}
export type CodexTurnTiming = {
  startedAt?: number;
  completedAt?: number;
  durationMs?: number;
};
export type CodexQuestion = {
  id: string;
  question: string;
  header: string;
  options: { label: string; description: string }[];
  secret?: boolean;
};
export type CodexPendingRequest = {
  id: string | number;
  method: string;
  params: JsonObject;
  questions?: CodexQuestion[];
};
export type CodexAttachment = {
  id: string;
  name: string;
  kind?: "image" | "document";
};
export function isImageAttachment(attachment: CodexAttachment): boolean {
  return attachment.kind
    ? attachment.kind === "image"
    : /\.(png|jpg|webp|gif)$/.test(attachment.id);
}
export type CodexMessage = {
  id: string;
  text: string;
  attachments: CodexAttachment[];
};
export type CodexThreadState =
  "idle" | "starting" | "running" | "waiting" | "interrupted" | "failed";
export type CodexThreadStartKind = "worktree" | "default" | "new" | "current";
export const DEFAULT_THREAD_START: CodexThreadStartKind = "worktree";
export function isThreadStartKind(value: unknown): value is CodexThreadStartKind {
  return ["worktree", "default", "new", "current"].includes(value as string);
}
export function effectiveThreadStartKind(configuration: CodexConfiguration, project?: CodexProject): CodexThreadStartKind {
  return project?.defaultThreadStart ?? configuration.defaultThreadStart ?? DEFAULT_THREAD_START;
}
export type CodexThreadStart = { kind: CodexThreadStartKind; branch: string };
export type CodexStartOptions = { defaultBranch: string; currentBranch: string };
export type CodexThreadSummary = {
  start?: CodexThreadStart;
  id: string;
  repositoryId: string;
  title: string;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
  settings: CodexPreferences;
  state: CodexThreadState;
  error?: string;
  worktree: string;
  branch: string;
  baseCommit: string;
  checkout?: "worktree" | "default";
  worktreeGeneration?: number;
  mergedInto?: {
    branch: string;
    sourceCommit: string;
    targetPath: string;
    commit: string;
    method?: "merge" | "squash";
    targetCommit?: string;
    tree?: string;
  };
  environment?: CodexEnvironment;
  sourceHome?: string;
  accountId?: string;
  historyWarning?: string;
};
export type CodexThread = CodexThreadSummary & {
  activeSettings?: CodexPreferences;
  turns?: Record<string, CodexTurnTiming>;
  replacement?: {
    itemId: string;
    turnId: string;
    previousTurnId: string | null;
    stage: "reverting" | "reverted" | "sending";
    message?: CodexMessage;
  };
  historyRevision?: number;
  serverId: string;
  repositoryPath: string;
  turnId?: string;
  items: CodexItem[];
  requests: CodexPendingRequest[];
  queue: CodexMessage[];
  queuePaused: boolean;
  draft: string;
  draftAttachments: CodexAttachment[];
  attachmentNames?: Record<string, string>;
};
export type CodexThreadSearchResult = { id: string; snippet: string };
export type CodexThreadPage = { thread: CodexThread; before: number | null };
export type CodexGitInfo = {
  status: string;
  diff: string;
  untracked: { path: string; text: string }[];
};
export type CodexMergeConflict = {
  defaultBranch: string;
  targetCommit: string;
  sourceCommit: string;
  sourceBranch: string;
  files: string[];
};
export type CodexCheckoutResult = { conflict?: CodexMergeConflict };
export type CodexMergeChoice = { method: "squash" | "merge"; message: string };
export type CodexCheckoutReview = {
  action: "merge" | "worktree";
  sourceBranch: string;
  sourcePath: string;
  targetBranch: string;
  targetPath: string;
  commits: number;
  summary: string;
};
export type CodexCheckoutPreview = CodexCheckoutReview & { token: string; message: string };
type Command<I, O> = { input: I; output: O };
type GitCheckoutInput = { repositoryId: string; revision: string; worktree?: string };
type GitFileInput = GitCheckoutInput & { path: string };
type ThreadInput = { repositoryId: string; id: string };
export type CodexThreadWindow = ThreadInput & {
  title: string;
  fullName: string;
  defaultBranch?: string | null;
  terminalOpen: boolean;
};
export type CodexCommands = {
  gitSnapshot: Command<{ repositoryId: string; worktree?: string }, GitSnapshot>;
  gitPreview: Command<GitFileInput, GitPreview>;
  gitFileHistory: Command<GitFileInput & { commit?: string }, GitFileHistory>;
  gitRepositoryHistory: Command<GitCheckoutInput, GitHistory>;
  gitHistoricalTree: Command<GitCheckoutInput & { commit: string }, GitHistoricalTree>;
  gitHistoricalPreview: Command<GitFileInput & { commit: string }, GitPreview>;
  gitFileDiff: Command<GitFileInput, CodexGitInfo>;
  gitAction: Command<{ repositoryId: string; revision: string; action: GitAction; worktree?: string }, GitActionResult>;
  displayContext: Command<Record<string, never>, { homeDirectory: string; platform: string }>;
  openThreadWindow: Command<
    ThreadInput & {
      fullName?: string;
      defaultBranch?: string | null;
      terminalOpen?: boolean;
    },
    void
  >;
  cancelThreadWindowClose: Command<Record<string, never>, void>;
  closeThreadWindow: Command<Record<string, never>, void>;
  threadWindowContext: Command<Record<string, never>, CodexThreadWindow | null>;
  threadWindows: Command<Record<string, never>, CodexThreadWindow[]>;
  openLink: Command<{ url: string }, void>;
  configuration: Command<Record<string, never>, CodexConfiguration>;
  saveEnvironments: Command<
    { environments: CodexEnvironment[] },
    CodexConfiguration
  >;
  checkEnvironment: Command<
    { environment: CodexEnvironment; repositoryPath?: string },
    CodexEnvironmentCheck
  >;
  checkProjectCheckout: Command<
    { repositoryId: string; environmentId: string },
    CodexEnvironmentCheck
  >;
  inferRemotePath: Command<{ repositoryId: string }, string | null>;
  setEnvironment: Command<ThreadInput & { environmentId: string }, void>;
  saveConfiguration: Command<
    {
      defaults: CodexPreferences;
      executable: string;
      editor?: string;
      sendShortcut?: CodexSendShortcut;
      defaultThreadStart?: CodexThreadStartKind;
    },
    CodexConfiguration
  >;
  saveProject: Command<
    {
      repositoryId: string;
      overrides: Partial<CodexPreferences>;
      remotePaths?: Record<string, string>;
      accountOverride?: boolean;
      defaultEnvironment?: string;
      defaultThreadStart?: CodexThreadStartKind | null;
      fullName?: string;
    },
    CodexConfiguration
  >;
  pickFolder: Command<
    { repositoryId: string; fullName: string },
    CodexConfiguration
  >;
  status: Command<{ repositoryId?: string }, CodexStatus>;
  login: Command<{ repositoryId?: string }, void>;
  logout: Command<{ repositoryId?: string }, void>;
  cancelLogin: Command<{ repositoryId?: string }, void>;
  models: Command<
    { repositoryId?: string; id?: string; accountOverride?: boolean },
    CodexModel[]
  >;
  search: Command<
    { repositoryId: string; query: string; archived: boolean },
    CodexThreadSearchResult[]
  >;
  list: Command<{ repositoryId: string }, CodexThreadSummary[]>;
  startOptions: Command<{ repositoryId: string; id?: string }, CodexStartOptions>;
  setStart: Command<ThreadInput & { start: CodexThreadStart }, void>;
  create: Command<{ repositoryId: string; start?: CodexThreadStart }, CodexThreadSummary>;
  thread: Command<ThreadInput & { before?: number }, CodexThreadPage>;
  update: Command<
    ThreadInput & {
      title?: string;
      archived?: boolean;
      settings?: CodexPreferences;
      draft?: string;
      draftAttachments?: CodexAttachment[];
    },
    void
  >;
  send: Command<
    ThreadInput & { text: string; attachments: CodexAttachment[] },
    void
  >;
  replaceMessage: Command<
    ThreadInput & {
      messageId: string;
      text: string;
      attachments: CodexAttachment[];
    },
    void
  >;
  quickAction: Command<
    ThreadInput & { action: import("./codexActions.js").CodexQuickAction },
    void
  >;
  checkoutPreview: Command<ThreadInput & { action: "merge" | "worktree" }, CodexCheckoutResult & { preview?: CodexCheckoutPreview }>;
  checkout: Command<ThreadInput & { action: "merge" | "worktree"; token: string; method?: "squash" | "merge"; message?: string }, CodexCheckoutResult | void>;
  resolveMergeConflicts: Command<ThreadInput, void>;
  terminalOpen: Command<
    ThreadInput & { cols: number; rows: number; attachmentId: string },
    import("./terminal.js").TerminalSnapshot
  >;
  terminalWrite: Command<
    ThreadInput & { sessionId: string; data: string },
    void
  >;
  terminalResize: Command<
    ThreadInput & { sessionId: string; cols: number; rows: number },
    void
  >;
  terminalAck: Command<
    ThreadInput & { sessionId: string; attachmentId: string; sequence: number },
    void
  >;
  terminalDetach: Command<
    ThreadInput & { sessionId: string; attachmentId: string },
    void
  >;
  terminalClose: Command<ThreadInput & { sessionId: string }, void>;
  reconnect: Command<ThreadInput, void>;
  stop: Command<ThreadInput, void>;
  answer: Command<
    ThreadInput & {
      requestId: string | number;
      answers?: Record<string, string>;
      approve?: boolean;
    },
    void
  >;
  queue: Command<
    ThreadInput & {
      action: "resume" | "remove" | "edit";
      messageId?: string;
      text?: string;
    },
    void
  >;
  attach: Command<ThreadInput & { paths?: string[]; files?: { name: string; data: Uint8Array }[] }, CodexAttachment[]>;
  outputFile: Command<
    ThreadInput & { href: string; action: "reveal" | "save" | "image" | "open" },
    string | null
  >;
  git: Command<ThreadInput, CodexGitInfo>;
  openFolder: Command<ThreadInput, void>;
  openEditor: Command<ThreadInput, void>;
  pickEditor: Command<Record<string, never>, string | null>;
};
export type CodexChange = {
  windowChanged?: boolean;
  windowCloseRequested?: boolean;
  connectionError?: string;
  environmentId?: string;
  accountId?: string;
  repositoryId?: string;
  threadId?: string;
  auth?: { success: boolean; error?: string };
};
export interface CodexApi {
  attachFiles?(input: ThreadInput, files: File[]): Promise<CodexAttachment[]>;
  request<K extends keyof CodexCommands>(
    method: K,
    input: CodexCommands[K]["input"],
  ): Promise<CodexCommands[K]["output"]>;
  onChanged(callback: (change: CodexChange) => void): () => void;
  onTerminalEvent(
    callback: (event: import("./terminal.js").TerminalEvent) => void,
  ): () => void;
}
export function effectiveCodexPreferences(
  defaults: CodexPreferences,
  overrides: Partial<CodexPreferences>,
): CodexPreferences {
  return { ...defaults, ...overrides };
}
export function resolveModelPreferences(
  settings: CodexPreferences,
  models: CodexModel[],
): CodexPreferences {
  const model = settings.model
    ? models.find((entry) => entry.id === settings.model)
    : (models.find((entry) => entry.isDefault) ?? models[0]);
  if (!model)
    throw new Error(
      settings.model
        ? `Model ${settings.model} is unavailable. Choose a model in Codex settings.`
        : "Codex returned no available models.",
    );
  const effort = settings.effort || model.defaultEffort;
  if (!model.efforts.includes(effort))
    throw new Error(
      `Effort ${effort} is unavailable for ${model.name}. Choose a supported effort.`,
    );
  if (settings.speed === "fast" && !model.fast)
    throw new Error(
      `Fast speed is unavailable for ${model.name}. Choose normal speed.`,
    );
  return { ...settings, model: model.id, effort };
}
export function codexIsActive(
  thread: Pick<CodexThreadSummary, "state">,
): boolean {
  return ["starting", "running", "waiting"].includes(thread.state);
}
export function codexEnvironmentIsFixed(thread: CodexThread): boolean {
  return Boolean(
    thread.archived ||
    thread.worktree ||
    thread.serverId ||
    thread.items.length ||
    thread.sourceHome ||
    codexIsActive(thread),
  );
}
export function validatePreferences(
  value: unknown,
  partial = false,
): Partial<CodexPreferences> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid Codex settings.");
  const result: Partial<CodexPreferences> = {};
  const options = {
    speed: ["normal", "fast"],
    mode: ["implement", "plan"],
    followUp: ["steer", "queue"],
    permissions: ["ask", "strict", "full"],
  };
  for (const key of Object.keys(
    defaultCodexPreferences,
  ) as (keyof CodexPreferences)[]) {
    const v = (value as Record<string, unknown>)[key];
    if (v === undefined && partial) continue;
    if (
      typeof v !== "string" ||
      v.length > 200 ||
      (key in options &&
        !(options[key as keyof typeof options] as string[]).includes(v))
    )
      throw new Error(`Invalid Codex ${key}.`);
    Object.assign(result, { [key]: v });
  }
  return result;
}

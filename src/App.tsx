import { accentColors, normalizeAccentColor, projectAccentColor, type AccentColor, type ProjectAccentColors } from "./appearance";
import { ChatWorkspace } from "./chatgpt/workspace";
import { ReleasesSection } from "./releases";
import { releaseDate, releasesForTab, type ReleaseTab } from "../shared/releases";
import { useContentAttachmentShortcut } from "./content-attachment-shortcut";
import { contentItemKey, retainedContentItems } from "./content-items";
import { hasOpenKeyboardOverlay, isDomNode, isHtmlElement } from "./dom";
import { displayPath, displayPathText } from "./paths";
import { DetachablePane, useDetachablePane } from "./detachable-pane";
import { usePaneSurface } from "./pane-surface";
import { ThreadWorkspace } from "./codex/thread-workspace";
import { Combobox } from "./components/combobox";
import { useSlidingUnderline } from "./useSlidingUnderline";
import {
  Tag,
  Activity,
  AlertCircle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  CircleCheckBig,
  Clock,
  Code2,
  Command,
  Construction,
  TerminalSquare,
  AppWindowMac,
  createLucideIcon,
  ExternalLink,
  FileCode2,
  FileText,
  GitBranch,
  GitPullRequest,
  Inbox,
  Loader2,
  Moon,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  PictureInPicture2,
  Orbit,
  Pencil,
  Play,
  Plus,
  Settings,
  Bot,
  Search,
  Star,
  StarOff,
  Sun,
  SwatchBook,
  ThumbsDown,
  ThumbsUp,
  Workflow,
  X,
  XCircle
} from "lucide-react";
import { Github } from "./GithubIcon";
import type { PatchDiffProps } from "@pierre/diffs/react";
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import ReactMarkdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import {
  addPullRequestLabelOptimistically,
  activeProjectPollingIntervalMs,
  adjacentFavoriteRepositoryKey,
  adjacentProjectFocusView,
  appKeyboardShortcut,
  canManagePullRequest,
  canSubmitPullRequestReviewForPullRequest,
  canUpdatePullRequestDraftState,
  canUpdatePullRequestLabels,
  canUpdatePullRequestTitle,
  canPollGithub,
  failedWorkflowRunNotificationKeys,
  findNewFailedWorkflowRuns,
  findNewOpenPullRequests,
  favoriteProjectPollingIntervalMs,
  formatDuration,
  githubUrlClickActionForDetail,
  groupRepositoriesByOwner,
  isLiveStatus,
  isTabNavigation,
  latestViewerPullRequestReviewEvent,
  mergeFavoriteRepoSnapshots,
  middlePaneSelectionDelta,
  missingWorkflowDispatchInputs,
  openPullRequestNotificationKeys,
  pollingBackoffMs,
  pollingIntervalMs,
  pullRequestTabForState,
  pullRequestWorkflowState,
  projectViewNavigationDirection,
  repositorySelectionFocusView,
  repositoryAllowsPullRequestAutoMerge,
  removePullRequestLabelOptimistically,
  reviewDecisionForReviewEvent,
  shortSha,
  statusTone,
  workflowDispatchDefaultInputs,
  workflowDispatchRequiresPrompt,
  type FavoriteRepoSnapshots,
  type ProjectFocusView,
  type ProjectPullRequestTab,
  type PullRequestWorkflowState
} from "./appLogic";
import { userFacingError } from "../shared/errors";
import { DEFAULT_SIDEBAR_APPEARANCE_MODE } from "../shared/github";
import type {
  AuthStatus,
  CheckSummary,
  ChangedFileSummary,
  GithubFocusApi,
  ReleaseSummary,
  IssueSummary,
  LabelSummary,
  NativeNotificationPayload,
  NativeNotificationPermission,
  NativeNotificationSource,
  NativeThemeSource,
  OrganizationSummary,
  PullRequestDetail,
  PullRequestReview,
  PullRequestReviewEvent,
  PullRequestSummary,
  RepoRef,
  RepoSummary,
  SidebarAppearanceMode,
  WorkflowDispatchConfig,
  WorkflowDispatchInputSummary,
  WorkflowJobLogDetail,
  WorkflowRunDetail,
  WorkflowRunSummary,
  WorkflowSummary
} from "../shared/github";

import { CodexQuickActions } from "./codex/quick-actions";
import { CodexSettingsDialog } from "./codex/settings";
import { CodexThreadList } from "./codex/threads";
import { useCodexThreads } from "./codex/api";

const sidebarRailWidth = 48;

const PatchDiff = lazy(async () => {
  const module = await import("@pierre/diffs/react");
  return { default: module.PatchDiff };
});

type ContentSelection =
  | { kind: "repo" }
  | { kind: "codex"; threadId: string }
  | { kind: "pr"; pr: PullRequestSummary }
  | { kind: "release"; release: ReleaseSummary }
  | { kind: "issue"; issue: IssueSummary }
  | { kind: "run"; run: WorkflowRunSummary; focusedJobId?: number | null }
  | { kind: "workflow"; workflow: WorkflowSummary };

type MiddleItem =
  | { id: string; kind: "release"; release: ReleaseSummary }
  | { id: string; kind: "pr"; pr: PullRequestSummary }
  | { id: string; kind: "issue"; issue: IssueSummary }
  | { id: string; kind: "run"; run: WorkflowRunSummary }
  | { id: string; kind: "workflow"; workflow: WorkflowSummary };

type PaletteItemKind =
  | "action"
  | "repo"
  | "pr"
  | "issue"
  | "run"
  | "workflow";

interface PaletteItem {
  id: string;
  kind: PaletteItemKind;
  title: string;
  subtitle?: string;
  run: () => void;
}

type ThemeMode = "dark" | "light";
type ThemePreference = ThemeMode | "system";
type SidebarRepoTab = "favorites" | "all";
type StoredProjectFocusView = ProjectFocusView | "starred-actions";
type ProjectWorkflowTab = "favorites" | "all";
type PatchDiffOptions = NonNullable<PatchDiffProps<unknown, undefined>["options"]>;
type NavigationEntry = {
  focusView: ProjectFocusView;
  pullRequestTab: ProjectPullRequestTab;
  repo: RepoSummary | null;
  selection: ContentSelection;
  workflowTab: ProjectWorkflowTab;
  releaseTab: ReleaseTab;
};
type NavigationState = {
  entries: NavigationEntry[];
  index: number;
};
type ProjectSnapshot = {
  repo: RepoSummary;
  labels: LabelSummary[];
  pullRequests: PullRequestSummary[];
  releases: ReleaseSummary[];
  issues: IssueSummary[];
  workflows: WorkflowSummary[];
  workflowRuns: WorkflowRunSummary[];
};
type WorkflowJobLogLoadState = {
  loading: boolean;
  refreshing?: boolean;
  error?: string | null;
  detail?: WorkflowJobLogDetail | null;
};
type FavoriteProjectNotificationSnapshot = {
  failedWorkflowRunKeys: string[];
  pullRequestKeys: string[];
};
type FavoriteProjectMonitorStatus = {
  checking: boolean;
  lastCheckedAt: string | null;
};
type WorkflowDispatchDialogState = {
  workflow: WorkflowSummary;
  config: WorkflowDispatchConfig | null;
  values: Record<string, string>;
  loading: boolean;
  submitting: boolean;
  error: string | null;
};
type ConfirmationDialogState = {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm(): Promise<boolean>;
};

interface WorkflowCheckGroup {
  check: CheckSummary;
  checks: CheckSummary[];
  conclusion?: string | null;
  key: string;
  name: string;
  recency: number;
  run?: WorkflowRunSummary | null;
  status?: string | null;
  url?: string | null;
  workflowRunId?: number | null;
}

const sidebarAppearanceTransitionMs = 360;
const themeTransitionMs = 320;
const themeTransitionClass = "theme-transitioning";
const ClockCheck = createLucideIcon("ClockCheck", [
  ["path", { d: "M12 6v6l4 2", key: "mmk7yg" }],
  ["path", { d: "M22 12a10 10 0 1 0-11 9.95", key: "17dhok" }],
  ["path", { d: "m22 16-5.5 5.5L14 19", key: "1eibut" }]
]);
const defaultAccentByTheme: Record<ThemeMode, AccentColor> = {
  dark: accentColors[0],
  light: accentColors[1]
};
const themePreferenceOptions: ThemePreference[] = ["system", "light", "dark"];
type AppCssVars = React.CSSProperties & Record<"--accent", string>;
type SwatchCssVars = React.CSSProperties & Record<"--swatch-color", string>;
type ViewTransitionHandle = { finished: Promise<void> };
type DocumentWithViewTransition = Document & {
  startViewTransition?: (updateCallback: () => void) => ViewTransitionHandle;
};

function useAdaptivePolling(
  callback: () => Promise<void>,
  intervalMs: number,
  enabled: boolean,
  options: { immediately?: boolean; document?: Document } = {}
): void {
  "use no memo"; // React Compiler does not yet support this try/finally control flow.

  const document = options.document ?? globalThis.document;
  const callbackRef = useRef(callback);
  const immediately = Boolean(options.immediately);

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  useEffect(() => {
    if (!enabled) {
      return undefined;
    }

    let cancelled = false;
    let consecutiveFailures = 0;
    let running = false;
    let timer: number | null = null;

    function schedule(delayMs: number): void {
      if (cancelled) {
        return;
      }
      if (timer !== null) {
        window.clearTimeout(timer);
      }
      timer = window.setTimeout(run, delayMs);
    }

    async function run(): Promise<void> {
      timer = null;
      if (cancelled) {
        return;
      }
      if (running) {
        return;
      }

      if (!canPollGithub(document.visibilityState, navigator.onLine !== false)) {
        schedule(intervalMs);
        return;
      }

      running = true;
      try {
        await callbackRef.current();
        consecutiveFailures = 0;
      } catch (error) {
        consecutiveFailures += 1;
        console.warn("GitHub background refresh failed", error);
      } finally {
        running = false;
      }
      schedule(pollingBackoffMs(intervalMs, consecutiveFailures));
    }

    function resume(): void {
      if (!running && canPollGithub(document.visibilityState, navigator.onLine !== false)) {
        schedule(0);
      }
    }

    document.addEventListener("visibilitychange", resume);
    window.addEventListener("online", resume);
    schedule(immediately ? 0 : intervalMs);

    return () => {
      cancelled = true;
      if (timer !== null) {
        window.clearTimeout(timer);
      }
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("online", resume);
    };
  }, [enabled, immediately, intervalMs, document]);
}

function clearPointerActivatedControlFocus(event: React.MouseEvent<HTMLElement>): void {
  if (event.detail === 0) {
    return;
  }

  const target = event.target;
  if (!isHtmlElement(target)) {
    return;
  }

  const control = target.closest("button, [role='button'], a[href], input, textarea, select, [contenteditable='true']");
  if (!isHtmlElement(control)) {
    return;
  }

  const tagName = control.tagName;
  if (
    tagName === "INPUT" ||
    tagName === "TEXTAREA" ||
    tagName === "SELECT" ||
    control.getAttribute("contenteditable") === "true"
  ) {
    return;
  }

  const activeElement = control.ownerDocument.activeElement;
  if (isHtmlElement(activeElement) && (activeElement === control || control.contains(activeElement))) {
    activeElement.blur();
  }
}

function preventTitlebarPointerControlFocus(event: React.MouseEvent<HTMLElement>): void {
  if (event.button !== 0) {
    return;
  }

  const target = event.target;
  if (!isHtmlElement(target)) {
    return;
  }

  const control = target.closest("button, [role='button'], a[href]");
  if (!isHtmlElement(control)) {
    return;
  }

  if (!control.closest(".pane-header, .content-header, .titlebar-picker")) {
    return;
  }

  event.preventDefault();
}

function ipcUnavailable<T>(): Promise<T> {
  return Promise.reject(new Error("GitHub IPC is available only inside the Electron app."));
}

const browserApi: GithubFocusApi = {
  platform: "browser",
  getAuthStatus: async () => ({ configured: false, encryptionAvailable: false, viewerLogin: null }),
  signInGithub: () => ipcUnavailable(),
  cancelGithubSignIn: () => ipcUnavailable(),
  clearToken: () => ipcUnavailable(),
  getRepositories: () => ipcUnavailable(),
  getStarredRepos: () => ipcUnavailable(),
  getRecentRepos: () => ipcUnavailable(),
  getOrganizations: () => ipcUnavailable(),
  getRepo: () => ipcUnavailable(),
  getRepoLabels: () => ipcUnavailable(),
  getPullRequests: () => ipcUnavailable(),
  publishRelease: () => ipcUnavailable(),
  getReleases: () => ipcUnavailable(),
  getIssues: () => ipcUnavailable(),
  getWorkflows: () => ipcUnavailable(),
  getWorkflowDispatchConfig: () => ipcUnavailable(),
  getWorkflowRuns: () => ipcUnavailable(),
  getPullRequest: () => ipcUnavailable(),
  getWorkflowRun: () => ipcUnavailable(),
  getWorkflowJob: () => ipcUnavailable(),
  dispatchWorkflow: () => ipcUnavailable(),
  confirmPullRequestApproval: async (pullNumber: number) => window.confirm(`Approve PR #${pullNumber}?`),
  submitPullRequestReview: () => ipcUnavailable(),
  addPullRequestComment: () => ipcUnavailable(),
  updatePullRequestTitle: () => ipcUnavailable(),
  updatePullRequestDraftState: () => ipcUnavailable(),
  addPullRequestLabel: () => ipcUnavailable(),
  removePullRequestLabel: () => ipcUnavailable(),
  enablePullRequestAutoMerge: () => ipcUnavailable(),
  disablePullRequestAutoMerge: () => ipcUnavailable(),
  mergePullRequest: () => ipcUnavailable(),
  closePullRequest: () => ipcUnavailable(),
  openInGitHub: () => ipcUnavailable(),
  requestNotificationPermission: async () => {
    if (typeof Notification === "undefined") {
      return "unsupported";
    }
    if (Notification.permission !== "default" || typeof Notification.requestPermission !== "function") {
      return Notification.permission;
    }
    return Notification.requestPermission();
  },
  showNativeNotification: async () => false,
  onNativeNotificationClicked: () => () => undefined,
  onCacheUpdated: () => () => undefined,
  setNativeThemeSource: async () => undefined,
  setSidebarAppearanceMode: async () => undefined
};

const api: GithubFocusApi =
  window.githubFocus && typeof window.githubFocus.getAuthStatus === "function" ? window.githubFocus : browserApi;

function useStoredState<T>(key: string, initialValue: T): [T, (next: T | ((value: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => {
    const stored = localStorage.getItem(key);
    if (!stored) {
      return initialValue;
    }

    try {
      return JSON.parse(stored) as T;
    } catch {
      return initialValue;
    }
  });

  useEffect(() => {
    const changed = (event: StorageEvent) => {
      if (event.key !== key || event.newValue === null) return;
      try { setValue(JSON.parse(event.newValue) as T); } catch { /* Ignore invalid preferences. */ }
    };
    window.addEventListener("storage", changed);
    return () => window.removeEventListener("storage", changed);
  }, [key]);

  const setStoredValue = useCallback(
    (next: T | ((value: T) => T)) => {
      setValue((current) => {
        const resolved = typeof next === "function" ? (next as (value: T) => T)(current) : next;
        localStorage.setItem(key, JSON.stringify(resolved));
        return resolved;
      });
    },
    [key]
  );

  return [value, setStoredValue];
}

function readStoredAccentColor(key: string): string | null {
  const stored = localStorage.getItem(key);
  if (!stored) {
    return null;
  }

  try {
    const value = JSON.parse(stored);
    return typeof value === "string" && accentColors.includes(value as AccentColor) ? value : null;
  } catch {
    return null;
  }
}

function getSystemTheme(): ThemeMode {
  if (typeof window.matchMedia !== "function") {
    return "dark";
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function normalizeThemePreference(value: ThemePreference): ThemePreference {
  return themePreferenceOptions.includes(value) ? value : themePreferenceOptions[0];
}

function normalizeSidebarAppearanceMode(value: SidebarAppearanceMode): SidebarAppearanceMode {
  return value === "normal" ? "normal" : DEFAULT_SIDEBAR_APPEARANCE_MODE;
}

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function readStoredSidebarAppearance(key: string): SidebarAppearanceMode | null {
  const stored = localStorage.getItem(key);
  if (!stored) {
    return null;
  }

  try {
    const value = JSON.parse(stored);
    return value === "normal" || value === "glass" ? value : null;
  } catch {
    return null;
  }
}

function nextThemePreference(preference: ThemePreference): ThemePreference {
  const currentIndex = themePreferenceOptions.indexOf(preference);
  return themePreferenceOptions[(currentIndex + 1) % themePreferenceOptions.length];
}

function themePreferenceLabel(preference: ThemePreference, activeTheme: ThemeMode): string {
  if (preference === "system") {
    return `system (${activeTheme})`;
  }
  return preference;
}

function useSystemTheme(): ThemeMode {
  const [systemTheme, setSystemTheme] = useState<ThemeMode>(() => getSystemTheme());

  useEffect(() => {
    if (typeof window.matchMedia !== "function") {
      return undefined;
    }

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setSystemTheme(media.matches ? "dark" : "light");

    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  return systemTheme;
}


function repoKey(repo: { owner: string; name: string }): string {
  return `${repo.owner}/${repo.name}`;
}

function isPullRequestCacheUpdate(key: string): boolean {
  return key.includes(":pulls:") || key.includes(":pull:");
}

function isGithubUrl(rawUrl?: string | null): boolean {
  if (!rawUrl) {
    return false;
  }

  try {
    const url = new URL(rawUrl);
    return url.protocol === "https:" && (url.hostname === "github.com" || url.hostname === "www.github.com");
  } catch {
    return false;
  }
}

function workflowRunFallbackFromCheck(repo: RepoRef, check: CheckSummary): WorkflowRunSummary {
  const runId = check.workflowRunId ?? 0;
  return {
    id: runId,
    workflowId: 0,
    name: check.name,
    displayTitle: check.name,
    status: check.status,
    conclusion: check.conclusion,
    url: `https://github.com/${repo.owner}/${repo.name}/actions/runs/${runId}`
  };
}

function selectionRouteKey(selection: ContentSelection): string {
  if (selection.kind === "codex") return `codex:${selection.threadId}`;
  if (selection.kind === "pr") {
    return `pr:${selection.pr.number}`;
  }
  if (selection.kind === "release") return `release:${selection.release.id}`;
  if (selection.kind === "issue") {
    return `issue:${selection.issue.number}`;
  }
  if (selection.kind === "run") {
    return `run:${selection.run.id}`;
  }
  if (selection.kind === "workflow") {
    return `workflow:${selection.workflow.id}`;
  }
  return "repo";
}

function navigationEntryKey(entry: NavigationEntry): string {
  return [
    entry.repo ? repoKey(entry.repo) : "none",
    entry.focusView,
    entry.pullRequestTab,
    entry.workflowTab,
    entry.releaseTab,
    selectionRouteKey(entry.selection)
  ].join(":");
}

function refreshSelectionFromProject(selection: ContentSelection, project: ProjectSnapshot | null): ContentSelection {
  if (!project) {
    return selection;
  }

  if (selection.kind === "pr") {
    const refreshed = project.pullRequests.find((pr) => pr.number === selection.pr.number);
    return refreshed ? { kind: "pr", pr: refreshed } : selection;
  }

  if (selection.kind === "release") {
    const refreshed = project.releases.find(release => release.id === selection.release.id);
    return refreshed ? { kind: "release", release: refreshed } : selection;
  }
  if (selection.kind === "issue") {
    const refreshed = project.issues.find((issue) => issue.number === selection.issue.number);
    return refreshed ? { kind: "issue", issue: refreshed } : selection;
  }

  if (selection.kind === "run") {
    const refreshed = project.workflowRuns.find((run) => run.id === selection.run.id);
    return refreshed ? { kind: "run", run: refreshed, focusedJobId: selection.focusedJobId ?? null } : selection;
  }

  if (selection.kind === "workflow") {
    const refreshed = project.workflows.find((workflow) => workflow.id === selection.workflow.id);
    return refreshed ? { kind: "workflow", workflow: refreshed } : selection;
  }

  return selection;
}

function uniqueRepos(repos: RepoSummary[]): RepoSummary[] {
  const seen = new Set<string>();
  return repos.filter((repo) => {
    const key = repoKey(repo);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function moveListItem<T>(items: T[], source: T, target: T): T[] {
  if (source === target) {
    return items;
  }

  const sourceIndex = items.indexOf(source);
  const targetIndex = items.indexOf(target);
  if (sourceIndex === -1 || targetIndex === -1) {
    return items;
  }

  const next = [...items];
  const [item] = next.splice(sourceIndex, 1);
  next.splice(targetIndex, 0, item);
  return next;
}

function formatRelative(value?: string | null): string {
  if (!value) {
    return "";
  }

  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) {
    return "";
  }

  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) {
    return "now";
  }

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h`;
  }

  const days = Math.floor(hours / 24);
  if (days < 30) {
    return `${days}d`;
  }

  const months = Math.floor(days / 30);
  if (months < 12) {
    return `${months}mo`;
  }

  return `${Math.floor(months / 12)}y`;
}

function formatAbsoluteDateTime(value?: string | null): string {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function formatReviewMeta(state: string, submittedAt?: string | null): string {
  const date = formatRelative(submittedAt);
  return date ? `${state} - ${date}` : state;
}

async function copyTextToClipboard(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  document.body.removeChild(textarea);
  if (!copied) {
    throw new Error("Clipboard copy failed.");
  }
}

function cx(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ");
}

function blurFocusedElementIn(container: HTMLElement): void {
  const activeElement = container.ownerDocument.activeElement;
  if (isHtmlElement(activeElement) && container.contains(activeElement)) {
    activeElement.blur();
  }
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!isHtmlElement(target)) {
    return false;
  }

  const tagName = target.tagName.toLowerCase();
  return tagName === "input" || tagName === "textarea" || target.isContentEditable;
}

function workflowDispatchInputValue(input: WorkflowDispatchInputSummary, values: Record<string, string>): string {
  const current = values[input.key];
  if (current !== undefined) {
    return current;
  }
  return input.defaultValue ?? (input.type === "boolean" ? "false" : "");
}

function workflowDispatchPayloadValues(
  config: WorkflowDispatchConfig,
  values: Record<string, string>
): Record<string, string> {
  return config.inputs.reduce<Record<string, string>>((result, input) => {
    const value = workflowDispatchInputValue(input, values);
    const normalized = input.type === "boolean" ? value : value.trim();
    if (normalized !== "") {
      result[input.key] = normalized;
    }
    return result;
  }, {});
}

function StatusIcon({ status, conclusion }: { status?: string | null; conclusion?: string | null }) {
  const tone = statusTone(status, conclusion);
  if (tone === "good") {
    return <CheckCircle2 size={15} />;
  }
  if (tone === "bad") {
    return <XCircle size={15} />;
  }
  if (tone === "running") {
    return <Loader2 size={15} className="spin" />;
  }
  return <Circle size={15} />;
}

function IconForPalette({ kind }: { kind: PaletteItemKind }) {
  if (kind === "repo") {
    return <Code2 size={16} />;
  }
  if (kind === "pr") {
    return <GitPullRequest size={16} />;
  }
  if (kind === "issue") {
    return <Inbox size={16} />;
  }
  if (kind === "run") {
    return <Activity size={16} />;
  }
  if (kind === "workflow") {
    return <Workflow size={16} />;
  }
  return <Command size={16} />;
}

function openUrlForSelection(selection: ContentSelection, repo: RepoSummary | null): string | null {
  if (!repo) {
    return null;
  }

  if (selection.kind === "repo" || selection.kind === "codex") {
    return repo.url;
  }
  if (selection.kind === "pr") {
    return selection.pr.url;
  }
  if (selection.kind === "release") return selection.release.url;
  if (selection.kind === "issue") {
    return selection.issue.url;
  }
  if (selection.kind === "run") {
    return selection.run.url;
  }
  if (selection.kind === "workflow") {
    return selection.workflow.htmlUrl ?? `${repo.url}/actions/workflows/${selection.workflow.path.split("/").pop()}`;
  }

  return null;
}

function workflowRunDisplayName(run: WorkflowRunSummary): string {
  return run.displayTitle || run.name || `Run ${run.id}`;
}

function pullRequestNotificationPayload(repo: RepoSummary, pr: PullRequestSummary): NativeNotificationPayload {
  return {
    id: `favorite-project:${repoKey(repo)}:pull-request:${pr.number}:${pr.id}`,
    title: `New pull request in ${repo.fullName}`,
    body: `#${pr.number} ${pr.title}`,
    source: {
      kind: "pull-request",
      repo,
      pullRequest: pr
    }
  };
}

function workflowFailureNotificationPayload(repo: RepoSummary, run: WorkflowRunSummary): NativeNotificationPayload {
  const branch = run.branch ? ` on ${run.branch}` : "";
  return {
    id: `favorite-project:${repoKey(repo)}:workflow-run:${run.id}`,
    title: `Workflow failed in ${repo.fullName}`,
    body: `${workflowRunDisplayName(run)}${branch}`,
    source: {
      kind: "workflow-run",
      repo,
      run
    }
  };
}

function GithubUrlActionButton(props: {
  url?: string | null;
  className?: string;
  ariaLabel?: string;
  onCopyText(value: string): Promise<boolean>;
  onOpenUrl(url: string): void;
}) {
  const { ariaLabel, className, onCopyText, onOpenUrl, url } = props;
  const [copied, setCopied] = useState(false);
  const copyFeedbackTimer = useRef<number | null>(null);
  const copyFeedbackFrame = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (copyFeedbackTimer.current) {
        window.clearTimeout(copyFeedbackTimer.current);
      }
      if (copyFeedbackFrame.current) {
        window.cancelAnimationFrame(copyFeedbackFrame.current);
      }
    },
    []
  );

  const showCopied = useCallback(() => {
    if (copyFeedbackTimer.current) {
      window.clearTimeout(copyFeedbackTimer.current);
    }
    if (copyFeedbackFrame.current) {
      window.cancelAnimationFrame(copyFeedbackFrame.current);
    }

    setCopied(false);
    copyFeedbackFrame.current = window.requestAnimationFrame(() => {
      setCopied(true);
      copyFeedbackFrame.current = null;
      copyFeedbackTimer.current = window.setTimeout(() => {
        setCopied(false);
        copyFeedbackTimer.current = null;
      }, 620);
    });
  }, []);

  const handleClick = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      if (!url) {
        return;
      }

      if (githubUrlClickActionForDetail(event.detail) === "open") {
        onOpenUrl(url);
        return;
      }

      void onCopyText(url).then((didCopy) => {
        if (didCopy) {
          showCopied();
        }
      });
    },
    [onCopyText, onOpenUrl, showCopied, url]
  );

  return (
    <button
      className={cx("icon-button underline-action github-url-action", className, copied && "copied")}
      aria-label={ariaLabel ?? "Copy GitHub URL. Double-click to open in GitHub"}
      onClick={handleClick}
      disabled={!url}
    >
      <ExternalLink size={16} />
    </button>
  );
}

function ClipboardTextButton(props: {
  ariaLabel: string;
  children: React.ReactNode;
  className?: string;
  value?: string | null;
  onCopyText(value: string): Promise<boolean>;
}) {
  const { ariaLabel, children, className, onCopyText, value } = props;
  const [copied, setCopied] = useState(false);
  const copyFeedbackTimer = useRef<number | null>(null);
  const copyFeedbackFrame = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (copyFeedbackTimer.current) {
        window.clearTimeout(copyFeedbackTimer.current);
      }
      if (copyFeedbackFrame.current) {
        window.cancelAnimationFrame(copyFeedbackFrame.current);
      }
    },
    []
  );

  const showCopied = useCallback(() => {
    if (copyFeedbackTimer.current) {
      window.clearTimeout(copyFeedbackTimer.current);
    }
    if (copyFeedbackFrame.current) {
      window.cancelAnimationFrame(copyFeedbackFrame.current);
    }

    setCopied(false);
    copyFeedbackFrame.current = window.requestAnimationFrame(() => {
      setCopied(true);
      copyFeedbackFrame.current = null;
      copyFeedbackTimer.current = window.setTimeout(() => {
        setCopied(false);
        copyFeedbackTimer.current = null;
      }, 620);
    });
  }, []);

  const handleClick = useCallback(() => {
    if (!value) {
      return;
    }

    void onCopyText(value).then((didCopy) => {
      if (didCopy) {
        showCopied();
      }
    });
  }, [onCopyText, showCopied, value]);

  return (
    <button
      type="button"
      className={cx(className, copied && "copied")}
      aria-label={ariaLabel}
      onClick={handleClick}
      disabled={!value}
    >
      {children}
    </button>
  );
}

function CommitActionButton(props: {
  sha?: string | null;
  url?: string | null;
  className?: string;
  onCopyText(value: string): Promise<boolean>;
  onOpenUrl(url: string): void;
}) {
  const { className, onCopyText, onOpenUrl, sha, url } = props;
  const [copied, setCopied] = useState(false);
  const copyFeedbackTimer = useRef<number | null>(null);
  const copyFeedbackFrame = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (copyFeedbackTimer.current) {
        window.clearTimeout(copyFeedbackTimer.current);
      }
      if (copyFeedbackFrame.current) {
        window.cancelAnimationFrame(copyFeedbackFrame.current);
      }
    },
    []
  );

  const showCopied = useCallback(() => {
    if (copyFeedbackTimer.current) {
      window.clearTimeout(copyFeedbackTimer.current);
    }
    if (copyFeedbackFrame.current) {
      window.cancelAnimationFrame(copyFeedbackFrame.current);
    }

    setCopied(false);
    copyFeedbackFrame.current = window.requestAnimationFrame(() => {
      setCopied(true);
      copyFeedbackFrame.current = null;
      copyFeedbackTimer.current = window.setTimeout(() => {
        setCopied(false);
        copyFeedbackTimer.current = null;
      }, 620);
    });
  }, []);

  const handleClick = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      if (!sha) {
        return;
      }

      if (url && githubUrlClickActionForDetail(event.detail) === "open") {
        onOpenUrl(url);
        return;
      }

      void onCopyText(sha).then((didCopy) => {
        if (didCopy) {
          showCopied();
        }
      });
    },
    [onCopyText, onOpenUrl, sha, showCopied, url]
  );

  return (
    <button
      type="button"
      className={cx(className, copied && "copied")}
      aria-label={`Copy commit ${shortSha(sha)}. Double-click to open in GitHub`}
      onClick={handleClick}
      disabled={!sha}
    >
      {shortSha(sha)}
    </button>
  );
}

type ContentItemTarget = { key: string; repo: RepoSummary | null; selection: ContentSelection; focusView: ProjectFocusView };
type ItemPaneControl = ReturnType<typeof useDetachablePane>;
type ItemAppearance = { themePreference: ThemePreference; theme: ThemeMode; sidebarAppearance: SidebarAppearanceMode; accent: string };
type WorkspaceProps = {
  item?: ContentItemTarget;
  sharedAuth?: AuthStatus | null;
  onAuthChange?: (auth: AuthStatus) => void;
  appearance?: ItemAppearance;
  onPaneState?: (target: ContentItemTarget, pane: ItemPaneControl) => void;
  onNavigateItem?: (target: ContentItemTarget) => void;
};
export function App() { return <ForgeWorkspace />; }

function ForgeWorkspace({ item, sharedAuth, onAuthChange, appearance, onPaneState, onNavigateItem }: WorkspaceProps) {
  "use no memo"; // React Compiler does not yet support this try/finally control flow.

  const initialItem = useRef(item).current;
  const [chatMode, setChatMode] = useState(false);
  const [chatOpened, setChatOpened] = useState(false);
  const [chatSidebarHost, setChatSidebarHost] = useState<HTMLDivElement | null>(null);
  const [chatDetached, setChatDetached] = useState(false);
  const contentPane = useDetachablePane({ onReattach: () => { if (initialItem) onNavigateItem?.(initialItem); } });
  const [detachedItems, setDetachedItems] = useState<Map<string, { target: ContentItemTarget; pane: ItemPaneControl }>>(new Map());
  const reportItemPane = useCallback((target: ContentItemTarget, pane: ItemPaneControl) => {
    setDetachedItems(current => {
      const previous = current.get(target.key);
      if (!pane.detached && !pane.opening) {
        if (!previous) return current;
        const next = new Map(current); next.delete(target.key); return next;
      }
      if (previous?.pane.surface === pane.surface && previous.pane.opening === pane.opening && previous.pane.detached === pane.detached) return current;
      return new Map(current).set(target.key, { target, pane });
    });
  }, []);
  useLayoutEffect(() => { if (initialItem) onPaneState?.(initialItem, contentPane); }, [initialItem, onPaneState, contentPane.detached, contentPane.opening, contentPane.surface]);
  const [openTerminals, setOpenTerminals] = useState<Record<string, boolean>>({});
  const [auth, setAuth] = useState<AuthStatus | null>(sharedAuth ?? null);
  const [authChecking, setAuthChecking] = useState(!initialItem);
  useEffect(() => { if (auth && !auth.configured) contentPane.reattach(); }, [auth?.configured, contentPane.reattach]);
  const [githubSigningIn, setGithubSigningIn] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [initialLoading, setInitialLoading] = useState(false);
  const [projectLoading, setProjectLoading] = useState(false);
  const [projectError, setProjectError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const [repositories, setRepositories] = useState<RepoSummary[]>([]);
  const [starredRepos, setStarredRepos] = useState<RepoSummary[]>([]);
  const [recentRepos, setRecentRepos] = useState<RepoSummary[]>([]);
  const [organizations, setOrganizations] = useState<OrganizationSummary[]>([]);
  const [selectedRepo, setSelectedRepo] = useState<RepoSummary | null>(initialItem?.repo ?? null);
  const [settingsScope, setSettingsScope] = useState<"global" | "project" | null>(null);
  const codexThreads = useCodexThreads(selectedRepo?.id);
  useEffect(() => {
    const archivedKeys = codexThreads.threads
      .filter((thread) => thread.archived)
      .map((thread) => `${selectedRepo?.id}:${thread.id}`);
    setOpenTerminals((current) => {
      if (!archivedKeys.some((key) => current[key])) return current;
      const next = { ...current };
      archivedKeys.forEach((key) => delete next[key]);
      return next;
    });
  }, [codexThreads.threads, selectedRepo?.id]);
  const [repoLabels, setRepoLabels] = useState<LabelSummary[]>([]);
  const [pullRequests, setPullRequests] = useState<PullRequestSummary[]>([]);
  const [releases, setReleases] = useState<ReleaseSummary[]>([]);
  const [releaseTab, setReleaseTab] = useState<ReleaseTab>("active");
  const [issues, setIssues] = useState<IssueSummary[]>([]);
  const [workflowRuns, setWorkflowRuns] = useState<WorkflowRunSummary[]>([]);
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);

  const [selection, setSelection] = useState<ContentSelection>(initialItem?.selection ?? { kind: "repo" });
  useEffect(() => {
    if (!initialItem && auth && !auth.configured) { setSelectedRepo(null); setSelection({ kind: "repo" }); }
  }, [auth?.configured]);
  const [prDetail, setPrDetail] = useState<PullRequestDetail | null>(null);
  const [runDetail, setRunDetail] = useState<WorkflowRunDetail | null>(null);
  const [contentLoading, setContentLoading] = useState(false);
  const [contentError, setContentError] = useState<string | null>(null);
  const [prActionSubmitting, setPrActionSubmitting] = useState(false);
  const [prTab, setPrTab] = useState("Description");
  const [runTab, setRunTab] = useState("Jobs");

  const [sidebarCollapsed, setSidebarCollapsed] = useStoredState("github-focus:sidebar-collapsed", false);
  const [favoriteKeys, setFavoriteKeys] = useStoredState<string[]>("github-focus:favorites", []);
  const [favoriteRepoSnapshots, setFavoriteRepoSnapshots] = useStoredState<FavoriteRepoSnapshots>(
    "github-focus:favorite-repos",
    {}
  );
  const [localRecentKeys, setLocalRecentKeys] = useStoredState<string[]>("github-focus:local-recents", []);
  const [starredWorkflowKeys, setStarredWorkflowKeys] = useStoredState<Record<string, number[]>>(
    "github-focus:starred-workflows",
    {}
  );
  const [storedProjectFocusView, setStoredProjectFocusView] = useStoredState<StoredProjectFocusView>(
    "github-focus:project-focus-view",
    "pull-requests"
  );
  const [projectPullRequestTab, setProjectPullRequestTab] = useStoredState<ProjectPullRequestTab>(
    "github-focus:project-pull-request-tab",
    "open"
  );
  const [projectWorkflowTab, setProjectWorkflowTab] = useStoredState<ProjectWorkflowTab>(
    "github-focus:project-workflow-tab",
    "favorites"
  );
  const [storedThemePreference, setStoredThemePreference] = useStoredState<ThemePreference>("github-focus:theme", "system");
  const themePreference = appearance?.themePreference ?? normalizeThemePreference(storedThemePreference);
  const systemTheme = useSystemTheme();
  const activeTheme: ThemeMode = appearance?.theme ?? (themePreference === "system" ? systemTheme : themePreference);
  const nativeThemeSource: NativeThemeSource = themePreference === "system" ? "system" : activeTheme;
  const legacySidebarAppearance = useMemo(() => readStoredSidebarAppearance("github-focus:sidebar-appearance"), []);
  const [darkSidebarAppearance, setDarkSidebarAppearance] = useStoredState<SidebarAppearanceMode>(
    "github-focus:sidebar-appearance:dark",
    legacySidebarAppearance ?? DEFAULT_SIDEBAR_APPEARANCE_MODE
  );
  const [lightSidebarAppearance, setLightSidebarAppearance] = useStoredState<SidebarAppearanceMode>(
    "github-focus:sidebar-appearance:light",
    legacySidebarAppearance ?? DEFAULT_SIDEBAR_APPEARANCE_MODE
  );
  const sidebarAppearance = appearance?.sidebarAppearance ?? normalizeSidebarAppearanceMode(
    activeTheme === "dark" ? darkSidebarAppearance : lightSidebarAppearance
  );
  const legacyAccentColor = useMemo(() => readStoredAccentColor("github-focus:accent-color"), []);
  const [darkAccentColor, setDarkAccentColor] = useStoredState<string>(
    "github-focus:accent-color:dark",
    activeTheme === "dark" ? legacyAccentColor ?? defaultAccentByTheme.dark : defaultAccentByTheme.dark
  );
  const [lightAccentColor, setLightAccentColor] = useStoredState<string>(
    "github-focus:accent-color:light",
    activeTheme === "light" ? legacyAccentColor ?? defaultAccentByTheme.light : defaultAccentByTheme.light
  );
  const [projectAccentColors, setProjectAccentColors] = useStoredState<ProjectAccentColors>("github-focus:project-accent-colors", {});
  const [leftWidth, setLeftWidth] = useStoredState("github-focus:left-width", 280);
  const [middleWidth, setMiddleWidth] = useStoredState("github-focus:middle-width", 392);
  const [sidebarSearch, setSidebarSearch] = useState("");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState("");
  const [paletteIndex, setPaletteIndex] = useState(0);
  const [workflowDispatchDialog, setWorkflowDispatchDialog] = useState<WorkflowDispatchDialogState | null>(null);
  const [confirmationDialog, setConfirmationDialog] = useState<ConfirmationDialogState | null>(null);
  const [confirmationSubmitting, setConfirmationSubmitting] = useState(false);
  const [navigation, setNavigation] = useState<NavigationState>({ entries: [], index: -1 });
  const [favoriteProjectMonitorStatus, setFavoriteProjectMonitorStatus] = useState<FavoriteProjectMonitorStatus>({
    checking: false,
    lastCheckedAt: null
  });
  const [layoutAnimating, setLayoutAnimating] = useState(false);
  const [middleKeyboardNavigating, setMiddleKeyboardNavigating] = useState(false);
  const lastGPress = useRef(0);
  const layoutAnimationTimer = useRef<number | null>(null);
  const nativeSidebarAppearanceTimer = useRef<number | null>(null);
  const previousSidebarAppearance = useRef<SidebarAppearanceMode | null>(null);
  const themeTransitionTimer = useRef<number | null>(null);
  const optimisticMutationSequence = useRef(0);
  const optimisticMutationIds = useRef(new Map<string, number>());
  const restoringNavigation = useRef(false);
  const authConfiguredRef = useRef(false);
  const favoriteReposRef = useRef<RepoSummary[]>([]);
  const selectedRepoRef = useRef<RepoSummary | null>(null);
  const selectedRepoKeyRef = useRef("");
  const activeProjectLastFullRefreshAt = useRef(0);
  const favoriteProjectNotificationSnapshots = useRef(new Map<string, FavoriteProjectNotificationSnapshot>());
  const favoriteProjectRefreshInFlight = useRef(false);
  const nativeNotificationPermission = useRef<NativeNotificationPermission | null>(null);

  const loadedRepos = useMemo(
    () => uniqueRepos([...(selectedRepo ? [selectedRepo] : []), ...starredRepos, ...recentRepos, ...repositories]),
    [selectedRepo, starredRepos, recentRepos, repositories]
  );

  useEffect(() => {
    if (initialItem) return;
    setFavoriteRepoSnapshots((current) => mergeFavoriteRepoSnapshots(current, favoriteKeys, loadedRepos));
  }, [favoriteKeys, loadedRepos, setFavoriteRepoSnapshots]);

  const favoriteRepoFallbacks = useMemo(
    () => favoriteKeys.map((key) => favoriteRepoSnapshots[key]).filter(Boolean) as RepoSummary[],
    [favoriteKeys, favoriteRepoSnapshots]
  );

  const allRepos = useMemo(() => uniqueRepos([...loadedRepos, ...favoriteRepoFallbacks]), [
    favoriteRepoFallbacks,
    loadedRepos
  ]);

  const reposByKey = useMemo(() => new Map(allRepos.map((repo) => [repoKey(repo), repo])), [allRepos]);

  const favoriteRepos = useMemo(
    () => favoriteKeys.map((key) => reposByKey.get(key)).filter(Boolean) as RepoSummary[],
    [favoriteKeys, reposByKey]
  );
  const favoriteProjectRefreshKey = useMemo(() => favoriteRepos.map(repoKey).join("|"), [favoriteRepos]);

  const selectedRepoKey = selectedRepo ? repoKey(selectedRepo) : "";
  const selectedPullRequestNumber = selection.kind === "pr" ? selection.pr.number : null;
  const selectedWorkflowRunId = selection.kind === "run" ? selection.run.id : null;
  const hasLiveWorkflow = useMemo(
    () => workflowRuns.some((run) => isLiveStatus(run.status)) || isLiveStatus(runDetail?.status),
    [runDetail?.status, workflowRuns]
  );
  const selectedWorkflowStars = useMemo(
    () => (selectedRepoKey ? starredWorkflowKeys[selectedRepoKey] ?? [] : []),
    [selectedRepoKey, starredWorkflowKeys]
  );
  const workflowsById = useMemo(() => new Map(workflows.map((workflow) => [workflow.id, workflow])), [workflows]);
  const starredWorkflows = useMemo(
    () => selectedWorkflowStars.map((id) => workflowsById.get(id)).filter(Boolean) as WorkflowSummary[],
    [selectedWorkflowStars, workflowsById]
  );
  const projectFocusView: ProjectFocusView =
    initialItem?.focusView ?? (storedProjectFocusView === "starred-actions" ? "workflows" : storedProjectFocusView);
  const openPullRequests = useMemo(
    () => pullRequests.filter((pr) => pr.state !== "CLOSED" && pr.state !== "MERGED"),
    [pullRequests]
  );
  const closedPullRequests = useMemo(
    () => pullRequests.filter((pr) => pr.state === "CLOSED" || pr.state === "MERGED"),
    [pullRequests]
  );
  const visiblePullRequests = projectPullRequestTab === "closed" ? closedPullRequests : openPullRequests;

  useEffect(() => {
    if (!auth) {
      return;
    }

    authConfiguredRef.current = auth.configured;
    if (!auth.configured) {
      favoriteProjectNotificationSnapshots.current.clear();
      setFavoriteProjectMonitorStatus({ checking: false, lastCheckedAt: null });
    }
  }, [auth]);

  useEffect(() => {
    selectedRepoRef.current = selectedRepo;
    selectedRepoKeyRef.current = selectedRepoKey;
    activeProjectLastFullRefreshAt.current = 0;
  }, [selectedRepo, selectedRepoKey]);

  useEffect(() => {
    favoriteReposRef.current = favoriteRepos;
    const activeKeys = new Set(favoriteRepos.map(repoKey));
    for (const key of favoriteProjectNotificationSnapshots.current.keys()) {
      if (!activeKeys.has(key)) {
        favoriteProjectNotificationSnapshots.current.delete(key);
      }
    }
  }, [favoriteRepos]);

  const visibleRepos = useMemo(() => {
    const needle = sidebarSearch.trim().toLowerCase();
    if (!needle) {
      return allRepos;
    }
    return allRepos.filter((repo) => repo.fullName.toLowerCase().includes(needle));
  }, [allRepos, sidebarSearch]);

  const repoGroups = useMemo(() => {
    return groupRepositoriesByOwner(visibleRepos);
  }, [visibleRepos]);

  const middleItems = useMemo<MiddleItem[]>(() => {
    if (projectFocusView === "codex") return [];
    if (projectFocusView === "workflow-runs") {
      return workflowRuns.map((run) => ({ id: `run:${run.id}`, kind: "run" as const, run }));
    }
    if (projectFocusView === "releases") {
      return releasesForTab(releases, releaseTab).map(release => ({ id: `release:${release.id}`, kind: "release" as const, release }));
    }
    if (projectFocusView === "issues") {
      return issues.map((issue) => ({ id: `issue:${issue.number}`, kind: "issue" as const, issue }));
    }
    if (projectFocusView === "workflows") {
      const visibleWorkflows = projectWorkflowTab === "favorites" ? starredWorkflows : workflows;
      return visibleWorkflows.map((workflow) => ({ id: `workflow:${workflow.id}`, kind: "workflow" as const, workflow }));
    }
    return visiblePullRequests.map((pr) => ({ id: `pr:${pr.number}`, kind: "pr" as const, pr }));
  }, [releases, releaseTab, issues, projectFocusView, projectWorkflowTab, starredWorkflows, visiblePullRequests, workflowRuns, workflows]);

  const currentGithubUrl = openUrlForSelection(selection, selectedRepo);
  const currentNavigationEntry = useMemo<NavigationEntry>(
    () => ({
      focusView: projectFocusView,
      pullRequestTab: projectPullRequestTab,
      repo: selectedRepo,
      selection,
      releaseTab,
      workflowTab: projectWorkflowTab
    }),
    [releaseTab, projectFocusView, projectPullRequestTab, projectWorkflowTab, selectedRepo, selection]
  );

  const flash = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 2600);
  }, []);

  const openConfirmation = useCallback((dialog: ConfirmationDialogState) => {
    setConfirmationDialog(dialog);
  }, []);

  const closeConfirmation = useCallback(() => {
    if (!confirmationSubmitting) {
      setConfirmationDialog(null);
    }
  }, [confirmationSubmitting]);

  const submitConfirmation = useCallback(async () => {
    if (!confirmationDialog) {
      return;
    }

    setConfirmationSubmitting(true);
    try {
      if (await confirmationDialog.onConfirm()) {
        setConfirmationDialog(null);
      }
    } finally {
      setConfirmationSubmitting(false);
    }
  }, [confirmationDialog]);

  const beginOptimisticMutation = useCallback((key: string): number => {
    const id = optimisticMutationSequence.current + 1;
    optimisticMutationSequence.current = id;
    optimisticMutationIds.current.set(key, id);
    return id;
  }, []);

  const isCurrentOptimisticMutation = useCallback(
    (key: string, id: number): boolean => optimisticMutationIds.current.get(key) === id,
    []
  );

  const finishOptimisticMutation = useCallback((key: string, id: number): void => {
    if (optimisticMutationIds.current.get(key) === id) {
      optimisticMutationIds.current.delete(key);
    }
  }, []);

  const copyToClipboard = useCallback(
    async (value: string) => {
      try {
        await copyTextToClipboard(value);
        return true;
      } catch (error) {
        flash(error instanceof Error ? error.message : "Unable to copy to clipboard.");
        return false;
      }
    },
    [flash]
  );

  const setActiveAccentColor = useCallback(
    (color: string) => {
      if (activeTheme === "light") {
        setLightAccentColor(color);
      } else {
        setDarkAccentColor(color);
      }
    },
    [activeTheme, setDarkAccentColor, setLightAccentColor]
  );

  const setThemePreferenceWithTransition = useCallback(
    (preference: ThemePreference) => {
      const root = document.documentElement;
      const updateThemePreference = () => setStoredThemePreference(preference);

      if (themeTransitionTimer.current) {
        window.clearTimeout(themeTransitionTimer.current);
        themeTransitionTimer.current = null;
      }

      if (prefersReducedMotion()) {
        root.classList.remove(themeTransitionClass);
        updateThemePreference();
        return;
      }

      const viewTransitionDocument = document as DocumentWithViewTransition;
      if (typeof viewTransitionDocument.startViewTransition === "function") {
        const transition = viewTransitionDocument.startViewTransition(() => {
          flushSync(updateThemePreference);
        });
        void transition.finished.catch(() => undefined);
        return;
      }

      root.classList.add(themeTransitionClass);
      flushSync(updateThemePreference);
      themeTransitionTimer.current = window.setTimeout(() => {
        root.classList.remove(themeTransitionClass);
        themeTransitionTimer.current = null;
      }, themeTransitionMs);
    },
    [setStoredThemePreference]
  );

  const toggleThemePreference = useCallback(() => {
    setThemePreferenceWithTransition(nextThemePreference(themePreference));
  }, [setThemePreferenceWithTransition, themePreference]);

  useEffect(() => {
    return () => {
      if (themeTransitionTimer.current) {
        window.clearTimeout(themeTransitionTimer.current);
        themeTransitionTimer.current = null;
      }
      if (!initialItem) document.documentElement.classList.remove(themeTransitionClass);
    };
  }, []);

  const setSidebarCollapsedWithAnimation = useCallback(
    (next: boolean | ((value: boolean) => boolean)) => {
      setLayoutAnimating(true);
      if (layoutAnimationTimer.current) {
        window.clearTimeout(layoutAnimationTimer.current);
      }
      layoutAnimationTimer.current = window.setTimeout(() => {
        setLayoutAnimating(false);
        layoutAnimationTimer.current = null;
      }, 220);
      setSidebarCollapsed(next);
    },
    [setSidebarCollapsed]
  );

  const loadInitial = useCallback(
    async (showSpinner = true) => {
      if (!auth?.configured) {
        return;
      }

      if (showSpinner) {
        setInitialLoading(true);
      }
      setAuthError(null);

      try {
        const [repositoriesResult, starred, recent, orgs] = await Promise.all([
          api.getRepositories(),
          api.getStarredRepos(),
          api.getRecentRepos(),
          api.getOrganizations()
        ]);
        setRepositories(repositoriesResult.data);
        setStarredRepos(starred.data);
        setRecentRepos(recent.data);
        setOrganizations(orgs.data);

        setSelectedRepo((current) => {
          const selectableRepos = uniqueRepos([...repositoriesResult.data, ...starred.data, ...recent.data]);
          if (current) {
            const refreshed = selectableRepos.find((repo) => repoKey(repo) === repoKey(current));
            return refreshed ?? current;
          }
          const firstRecent = localRecentKeys.map((key) => selectableRepos.find((repo) => repoKey(repo) === key)).find(Boolean);
          return firstRecent ?? favoriteKeys.map((key) => selectableRepos.find((repo) => repoKey(repo) === key)).find(Boolean) ?? starred.data[0] ?? recent.data[0] ?? repositoriesResult.data[0] ?? null;
        });
      } catch (error) {
        setAuthError(error instanceof Error ? error.message : "Unable to load GitHub data.");
      } finally {
        if (showSpinner) {
          setInitialLoading(false);
        }
      }
    },
    [auth, favoriteKeys, localRecentKeys]
  );

  const loadProject = useCallback(
    async (repo: RepoSummary, showSpinner = true, force = false): Promise<ProjectSnapshot | null> => {
      if (showSpinner) {
        setProjectLoading(true);
      }
      setProjectError(null);
      const options = force ? { force: true } : undefined;

      try {
        const [repoDetail, labels, prs, repoIssues, repoWorkflows, runs, repoReleases] = await Promise.all([
          api.getRepo(repo, options),
          api.getRepoLabels(repo, options),
          api.getPullRequests(repo, options),
          api.getIssues(repo, options),
          api.getWorkflows(repo, options),
          api.getWorkflowRuns(repo, options),
          api.getReleases(repo, options)
        ]);

        const project = {
          repo: repoDetail.data,
          labels: labels.data,
          pullRequests: prs.data,
          releases: repoReleases.data,
          issues: repoIssues.data,
          workflows: repoWorkflows.data,
          workflowRuns: runs.data
        };

        setSelectedRepo(project.repo);
        setRepoLabels(project.labels);
        setPullRequests(project.pullRequests);
        setReleases(project.releases);
        setIssues(project.issues);
        setWorkflows(project.workflows);
        setWorkflowRuns(project.workflowRuns);
        return project;
      } catch (error) {
        setProjectError(error instanceof Error ? error.message : "Unable to load repository data.");
        return null;
      } finally {
        if (showSpinner) {
          setProjectLoading(false);
        }
      }
    },
    []
  );

  const selectRepo = useCallback(
    (repo: RepoSummary) => {
      setChatMode(false);
      setSelectedRepo(repo);
      setStoredProjectFocusView((current) => repositorySelectionFocusView(
        current === "starred-actions" ? "workflows" : current,
        favoriteKeys.includes(repoKey(repo))
      ));
      setSelection({ kind: "repo" });
      setRepoLabels([]);
      setPrDetail(null);
      setRunDetail(null);
      setLocalRecentKeys((current) => [repoKey(repo), ...current.filter((key) => key !== repoKey(repo))].slice(0, 20));
    },
    [setLocalRecentKeys, favoriteKeys, setStoredProjectFocusView]
  );

  const toggleFavorite = useCallback(
    (repo: RepoSummary) => {
      const key = repoKey(repo);
      setFavoriteKeys((current) =>
        current.includes(key) ? current.filter((item) => item !== key) : [key, ...current]
      );
    },
    [setFavoriteKeys]
  );

  const reorderFavoriteRepos = useCallback(
    (sourceKey: string, targetKey: string) => {
      setFavoriteKeys((current) => moveListItem(current, sourceKey, targetKey));
    },
    [setFavoriteKeys]
  );

  const toggleWorkflowStar = useCallback(
    (workflow: WorkflowSummary) => {
      if (!selectedRepo) {
        return;
      }

      const key = repoKey(selectedRepo);
      setStarredWorkflowKeys((current) => {
        const existing = current[key] ?? [];
        const next = existing.includes(workflow.id)
          ? existing.filter((id) => id !== workflow.id)
          : [workflow.id, ...existing];
        return {
          ...current,
          [key]: next
        };
      });
    },
    [selectedRepo, setStarredWorkflowKeys]
  );

  const reorderFavoriteWorkflows = useCallback(
    (sourceId: number, targetId: number) => {
      if (!selectedRepo) {
        return;
      }

      const key = repoKey(selectedRepo);
      setStarredWorkflowKeys((current) => ({
        ...current,
        [key]: moveListItem(current[key] ?? [], sourceId, targetId)
      }));
    },
    [selectedRepo, setStarredWorkflowKeys]
  );

  const dispatchWorkflowWithConfig = useCallback(
    async (
      workflow: WorkflowSummary,
      config: WorkflowDispatchConfig,
      values: Record<string, string>
    ): Promise<boolean> => {
      if (!selectedRepo) {
        return false;
      }

      try {
        await api.dispatchWorkflow({
          repo: selectedRepo,
          workflowId: workflow.id,
          ref: config.ref,
          inputs: workflowDispatchPayloadValues(config, values)
        });
        flash(`Started ${workflow.name}`);
        void loadProject(selectedRepo, false);
        return true;
      } catch (error) {
        flash(error instanceof Error ? error.message : "Workflow dispatch failed.");
        return false;
      }
    },
    [flash, loadProject, selectedRepo]
  );

  const loadWorkflowDispatchConfig = useCallback(
    async (workflow: WorkflowSummary): Promise<WorkflowDispatchConfig | null> => {
      if (!selectedRepo) {
        return null;
      }

      try {
        return await api.getWorkflowDispatchConfig(selectedRepo, workflow.id, selectedRepo.defaultBranch ?? "main");
      } catch (error) {
        flash(error instanceof Error ? error.message : "Unable to load workflow inputs.");
        return null;
      }
    },
    [flash, selectedRepo]
  );

  const openWorkflowDispatchDialog = useCallback(
    async (workflow: WorkflowSummary, initialConfig?: WorkflowDispatchConfig) => {
      if (!selectedRepo) {
        return;
      }

      if (initialConfig) {
        setWorkflowDispatchDialog({
          workflow,
          config: initialConfig,
          values: workflowDispatchDefaultInputs(initialConfig),
          loading: false,
          submitting: false,
          error: null
        });
        return;
      }

      setWorkflowDispatchDialog({
        workflow,
        config: null,
        values: {},
        loading: true,
        submitting: false,
        error: null
      });

      try {
        const config = await api.getWorkflowDispatchConfig(selectedRepo, workflow.id, selectedRepo.defaultBranch ?? "main");
        setWorkflowDispatchDialog((current) => {
          if (!current || current.workflow.id !== workflow.id) {
            return current;
          }

          return {
            ...current,
            config,
            values: workflowDispatchDefaultInputs(config),
            loading: false,
            error: null
          };
        });
      } catch (error) {
        setWorkflowDispatchDialog((current) => {
          if (!current || current.workflow.id !== workflow.id) {
            return current;
          }

          return {
            ...current,
            loading: false,
            error: error instanceof Error ? error.message : "Unable to load workflow inputs."
          };
        });
      }
    },
    [selectedRepo]
  );

  const runWorkflow = useCallback(
    async (workflow: WorkflowSummary) => {
      if (!selectedRepo) {
        return;
      }

      const config = await loadWorkflowDispatchConfig(workflow);
      if (!config) {
        return;
      }

      if (workflowDispatchRequiresPrompt(config)) {
        await openWorkflowDispatchDialog(workflow, config);
        return;
      }

      openConfirmation({
        title: "Run workflow?",
        message: `Run "${workflow.name}" on ${selectedRepo.fullName}@${config.ref}?`,
        confirmLabel: "Run",
        onConfirm: () => dispatchWorkflowWithConfig(workflow, config, workflowDispatchDefaultInputs(config))
      });
    },
    [dispatchWorkflowWithConfig, loadWorkflowDispatchConfig, openConfirmation, openWorkflowDispatchDialog, selectedRepo]
  );

  const runWorkflowWithArguments = useCallback(
    async (workflow: WorkflowSummary) => {
      await openWorkflowDispatchDialog(workflow);
    },
    [openWorkflowDispatchDialog]
  );

  useEffect(() => {
    setWorkflowDispatchDialog(null);
  }, [selectedRepoKey]);

  const closeWorkflowDispatchDialog = useCallback(() => {
    setWorkflowDispatchDialog(null);
  }, []);

  const updateWorkflowDispatchDialogValue = useCallback((key: string, value: string) => {
    setWorkflowDispatchDialog((current) => (current ? { ...current, values: { ...current.values, [key]: value } } : current));
  }, []);

  const submitWorkflowDispatchDialog = useCallback(async () => {
    if (!workflowDispatchDialog?.config) {
      return;
    }

    const missingInputs = missingWorkflowDispatchInputs(workflowDispatchDialog.config, workflowDispatchDialog.values);
    if (missingInputs.length) {
      setWorkflowDispatchDialog((current) =>
        current
          ? {
              ...current,
              error: `Required: ${missingInputs.map((input) => input.label).join(", ")}`
            }
          : current
      );
      return;
    }

    setWorkflowDispatchDialog((current) => (current ? { ...current, submitting: true, error: null } : current));
    const started = await dispatchWorkflowWithConfig(
      workflowDispatchDialog.workflow,
      workflowDispatchDialog.config,
      workflowDispatchDialog.values
    );

    if (started) {
      closeWorkflowDispatchDialog();
      return;
    }

    setWorkflowDispatchDialog((current) => (current ? { ...current, submitting: false } : current));
  }, [closeWorkflowDispatchDialog, dispatchWorkflowWithConfig, workflowDispatchDialog]);

  const refreshPullRequest = useCallback(
    async (
      repo: RepoSummary,
      pullNumber: number,
      options: { force?: boolean; showProjectSpinner?: boolean } = {}
    ): Promise<PullRequestDetail> => {
      const cacheOptions = options.force ? { force: true } : undefined;
      const [detailResponse] = await Promise.all([
        api.getPullRequest(repo, pullNumber, cacheOptions),
        loadProject(repo, options.showProjectSpinner ?? false, true)
      ]);
      setPrDetail(detailResponse.data);
      setSelection((current) =>
        current.kind === "pr" && current.pr.number === pullNumber ? { kind: "pr", pr: detailResponse.data } : current
      );
      return detailResponse.data;
    },
    [loadProject]
  );

  const patchPullRequestOptimistically = useCallback(
    (pullNumber: number, patch: Partial<PullRequestSummary>): void => {
      setPullRequests((current) =>
        current.map((item) => (item.number === pullNumber ? { ...item, ...patch } : item))
      );
      setPrDetail((current) => (current?.number === pullNumber ? { ...current, ...patch } : current));
      setSelection((current) =>
        current.kind === "pr" && current.pr.number === pullNumber
          ? { kind: "pr", pr: { ...current.pr, ...patch } }
          : current
      );
    },
    []
  );

  const updatePullRequestLabelsOptimistically = useCallback(
    (pullNumber: number, updateLabels: (labels: LabelSummary[]) => LabelSummary[]): void => {
      setPullRequests((current) =>
        current.map((item) =>
          item.number === pullNumber ? { ...item, labels: updateLabels(item.labels) } : item
        )
      );
      setPrDetail((current) =>
        current?.number === pullNumber ? { ...current, labels: updateLabels(current.labels) } : current
      );
      setSelection((current) =>
        current.kind === "pr" && current.pr.number === pullNumber
          ? { kind: "pr", pr: { ...current.pr, labels: updateLabels(current.pr.labels) } }
          : current
      );
    },
    []
  );

  const refreshActivePane = useCallback(async () => {
    if (!selectedRepo) {
      return;
    }

    const activeSelection = selection;
    const project = await loadProject(selectedRepo, true, true);
    const refreshedRepo = project?.repo ?? selectedRepo;
    const refreshedSelection = refreshSelectionFromProject(activeSelection, project);
    if (refreshedSelection !== activeSelection) {
      setSelection(refreshedSelection);
    }

    if (activeSelection.kind === "pr") {
      setContentLoading(true);
      setContentError(null);
      try {
        const response = await api.getPullRequest(refreshedRepo, activeSelection.pr.number, { force: true });
        setPrDetail(response.data);
        setSelection((current) =>
          current.kind === "pr" && current.pr.number === activeSelection.pr.number
            ? { kind: "pr", pr: response.data }
            : current
        );
      } catch (error) {
        setContentError(error instanceof Error ? error.message : "Unable to refresh pull request.");
      } finally {
        setContentLoading(false);
      }
      return;
    }

    if (activeSelection.kind === "run") {
      setContentLoading(true);
      setContentError(null);
      try {
        const response = await api.getWorkflowRun(refreshedRepo, activeSelection.run.id, { force: true });
        setRunDetail(response.data);
        setSelection((current) =>
          current.kind === "run" && current.run.id === activeSelection.run.id
            ? { ...current, run: response.data }
            : current
        );
      } catch (error) {
        setContentError(error instanceof Error ? error.message : "Unable to refresh workflow run.");
      } finally {
        setContentLoading(false);
      }
      return;
    }
  }, [loadProject, selectedRepo, selection]);

  useEffect(() => {
    if (!initialItem) return;
    const refresh = () => { void refreshActivePane(); };
    const host = contentPane.host;
    host.addEventListener("forge:refresh-item", refresh);
    return () => host.removeEventListener("forge:refresh-item", refresh);
  }, [refreshActivePane, contentPane.host]);

  const submitPullRequestReview = useCallback(
    (pr: PullRequestSummary, event: PullRequestReviewEvent) => {
      if (!selectedRepo) {
        return;
      }
      const viewerLogin = auth?.viewerLogin;
      if (!canSubmitPullRequestReviewForPullRequest(selectedRepo, pr, viewerLogin)) {
        flash("Cannot review this pull request with the current account.");
        return;
      }

      let body: string | undefined;
      if (event === "REQUEST_CHANGES") {
        const message = window.prompt(`Request changes on PR #${pr.number}`);
        if (message === null) {
          return;
        }
        body = message.trim();
        if (!body) {
          flash("Request changes needs a message.");
          return;
        }
      }

      const previousReviewDecision = pr.reviewDecision;
      const previousReviews = prDetail?.number === pr.number ? prDetail.reviews : null;
      const reviewDecision = reviewDecisionForReviewEvent(event);
      const mutationKey = `pr:${pr.number}:review`;
      const mutationId = beginOptimisticMutation(mutationKey);
      const optimisticReview: PullRequestReview | null = viewerLogin
        ? {
            id: `optimistic-review:${pr.id}:${event}:${Date.now()}`,
            state: reviewDecision,
            author: { login: viewerLogin },
            body: body ?? null,
            submittedAt: new Date().toISOString()
          }
        : null;

      patchPullRequestOptimistically(pr.number, { reviewDecision });
      if (optimisticReview) {
        setPrDetail((current) =>
          current?.number === pr.number
            ? { ...current, reviews: [...current.reviews, optimisticReview] }
            : current
        );
      }

      void api
        .submitPullRequestReview({
          repo: selectedRepo,
          pullNumber: pr.number,
          event,
          body
        })
        .then(() => {
          if (!isCurrentOptimisticMutation(mutationKey, mutationId)) {
            return;
          }
          void refreshPullRequest(selectedRepo, pr.number).catch((error) => {
            flash(error instanceof Error ? error.message : "Review submitted, but refresh failed.");
          });
        })
        .catch((error) => {
          if (isCurrentOptimisticMutation(mutationKey, mutationId)) {
            patchPullRequestOptimistically(pr.number, { reviewDecision: previousReviewDecision });
            if (previousReviews) {
              setPrDetail((current) =>
                current?.number === pr.number ? { ...current, reviews: previousReviews } : current
              );
            }
          }
          flash(error instanceof Error ? error.message : "Unable to submit review.");
        })
        .finally(() => {
          finishOptimisticMutation(mutationKey, mutationId);
        });
    },
    [
      auth?.viewerLogin,
      beginOptimisticMutation,
      finishOptimisticMutation,
      flash,
      isCurrentOptimisticMutation,
      patchPullRequestOptimistically,
      prDetail?.number,
      prDetail?.reviews,
      refreshPullRequest,
      selectedRepo
    ]
  );

  const addPullRequestComment = useCallback(
    async (pr: PullRequestSummary, bodyValue: string): Promise<boolean> => {
      if (!selectedRepo) {
        return false;
      }

      const body = bodyValue.trim();
      if (!body) {
        flash("Comment cannot be empty.");
        return false;
      }

      setPrActionSubmitting(true);
      try {
        await api.addPullRequestComment({
          repo: selectedRepo,
          pullNumber: pr.number,
          body
        });
        await refreshPullRequest(selectedRepo, pr.number);
        setPrTab("Comments");
        return true;
      } catch (error) {
        flash(error instanceof Error ? error.message : "Unable to add comment.");
        return false;
      } finally {
        setPrActionSubmitting(false);
      }
    },
    [flash, refreshPullRequest, selectedRepo]
  );

  const updatePullRequestTitle = useCallback(
    async (pr: PullRequestSummary, titleValue: string): Promise<boolean> => {
      if (!selectedRepo || !canUpdatePullRequestTitle(selectedRepo, pr, auth?.viewerLogin)) {
        return false;
      }

      const title = titleValue.trim();
      if (!title) {
        flash("Pull request title cannot be empty.");
        return false;
      }
      if (title === pr.title) {
        return true;
      }

      setPrActionSubmitting(true);
      try {
        await api.updatePullRequestTitle({
          repo: selectedRepo,
          pullNumber: pr.number,
          title
        });
        await refreshPullRequest(selectedRepo, pr.number);
        return true;
      } catch (error) {
        flash(error instanceof Error ? error.message : "Unable to update title.");
        return false;
      } finally {
        setPrActionSubmitting(false);
      }
    },
    [auth?.viewerLogin, flash, refreshPullRequest, selectedRepo]
  );

  const updatePullRequestDraftState = useCallback(
    async (pr: PullRequestSummary, draft: boolean): Promise<boolean> => {
      if (!selectedRepo || !canUpdatePullRequestDraftState(selectedRepo, pr, auth?.viewerLogin)) {
        return false;
      }
      if (draft === pr.isDraft) {
        return true;
      }

      const previousIsDraft = pr.isDraft;
      const mutationKey = `pr:${pr.number}:draft`;
      const mutationId = beginOptimisticMutation(mutationKey);
      patchPullRequestOptimistically(pr.number, { isDraft: draft });
      try {
        await api.updatePullRequestDraftState({
          repo: selectedRepo,
          pullNumber: pr.number,
          pullRequestId: pr.id,
          draft
        });
        if (isCurrentOptimisticMutation(mutationKey, mutationId)) {
          await refreshPullRequest(selectedRepo, pr.number).catch((error) => {
            flash(error instanceof Error ? error.message : "Pull request state updated, but refresh failed.");
          });
        }
        return true;
      } catch (error) {
        if (isCurrentOptimisticMutation(mutationKey, mutationId)) {
          patchPullRequestOptimistically(pr.number, { isDraft: previousIsDraft });
        }
        flash(error instanceof Error ? error.message : "Unable to update pull request state.");
        return false;
      } finally {
        finishOptimisticMutation(mutationKey, mutationId);
      }
    },
    [
      auth?.viewerLogin,
      beginOptimisticMutation,
      finishOptimisticMutation,
      flash,
      isCurrentOptimisticMutation,
      patchPullRequestOptimistically,
      refreshPullRequest,
      selectedRepo
    ]
  );

  const addPullRequestLabel = useCallback(
    async (pr: PullRequestSummary, labelNameValue: string): Promise<boolean> => {
      if (!selectedRepo || !canUpdatePullRequestLabels(selectedRepo)) {
        return false;
      }

      const labelName = labelNameValue.trim();
      if (!labelName) {
        flash("Pull request label cannot be empty.");
        return false;
      }

      if (pr.labels.some((label) => label.name.toLowerCase() === labelName.toLowerCase())) {
        return true;
      }

      const mutationKey = `pr:${pr.number}:label:${labelName.toLowerCase()}`;
      const mutationId = beginOptimisticMutation(mutationKey);
      updatePullRequestLabelsOptimistically(pr.number, (labels) =>
        addPullRequestLabelOptimistically(labels, repoLabels, labelName)
      );
      void api
        .addPullRequestLabel({
          repo: selectedRepo,
          pullNumber: pr.number,
          labelName
        })
        .catch((error) => {
          if (isCurrentOptimisticMutation(mutationKey, mutationId)) {
            updatePullRequestLabelsOptimistically(pr.number, (labels) =>
              removePullRequestLabelOptimistically(labels, labelName)
            );
          }
          flash(error instanceof Error ? error.message : "Unable to add label.");
        })
        .finally(() => {
          finishOptimisticMutation(mutationKey, mutationId);
        });
      return true;
    },
    [
      beginOptimisticMutation,
      finishOptimisticMutation,
      flash,
      isCurrentOptimisticMutation,
      repoLabels,
      selectedRepo,
      updatePullRequestLabelsOptimistically
    ]
  );

  const removePullRequestLabel = useCallback(
    async (pr: PullRequestSummary, labelNameValue: string): Promise<boolean> => {
      if (!selectedRepo || !canUpdatePullRequestLabels(selectedRepo)) {
        return false;
      }

      const labelName = labelNameValue.trim();
      if (!labelName) {
        flash("Pull request label cannot be empty.");
        return false;
      }

      if (!pr.labels.some((label) => label.name.toLowerCase() === labelName.toLowerCase())) {
        return true;
      }

      const removedLabel = pr.labels.find((label) => label.name.toLowerCase() === labelName.toLowerCase());
      const mutationKey = `pr:${pr.number}:label:${labelName.toLowerCase()}`;
      const mutationId = beginOptimisticMutation(mutationKey);
      updatePullRequestLabelsOptimistically(pr.number, (labels) =>
        removePullRequestLabelOptimistically(labels, labelName)
      );
      void api
        .removePullRequestLabel({
          repo: selectedRepo,
          pullNumber: pr.number,
          labelName
        })
        .catch((error) => {
          if (isCurrentOptimisticMutation(mutationKey, mutationId)) {
            updatePullRequestLabelsOptimistically(pr.number, (labels) =>
              addPullRequestLabelOptimistically(labels, removedLabel ? [removedLabel] : pr.labels, labelName)
            );
          }
          flash(error instanceof Error ? error.message : "Unable to remove label.");
        })
        .finally(() => {
          finishOptimisticMutation(mutationKey, mutationId);
        });
      return true;
    },
    [
      beginOptimisticMutation,
      finishOptimisticMutation,
      flash,
      isCurrentOptimisticMutation,
      selectedRepo,
      updatePullRequestLabelsOptimistically
    ]
  );

  const enablePullRequestAutoMerge = useCallback(
    async (pr: PullRequestSummary): Promise<boolean> => {
      if (!selectedRepo || !canManagePullRequest(selectedRepo)) {
        return false;
      }
      if (pr.state !== "OPEN") {
        flash("Only open pull requests can enable auto-merge.");
        return false;
      }
      if (pr.autoMergeEnabled) {
        flash("Auto-merge is already enabled.");
        return false;
      }
      if (selectedRepo.autoMergeAllowed === false) {
        flash("Auto-merge is not enabled for this repository.");
        return false;
      }

      setPrActionSubmitting(true);
      try {
        await api.enablePullRequestAutoMerge({
          repo: selectedRepo,
          pullNumber: pr.number,
          pullRequestId: pr.id
        });
        const refreshed = await refreshPullRequest(selectedRepo, pr.number);
        setProjectPullRequestTab(pullRequestTabForState(refreshed));
        flash(`Enabled auto-merge for PR #${pr.number}`);
        return true;
      } catch (error) {
        flash(userFacingError(error, "Unable to enable auto-merge."));
        return false;
      } finally {
        setPrActionSubmitting(false);
      }
    },
    [flash, refreshPullRequest, selectedRepo, setProjectPullRequestTab]
  );

  const disablePullRequestAutoMerge = useCallback(
    async (pr: PullRequestSummary): Promise<boolean> => {
      if (!selectedRepo || !canManagePullRequest(selectedRepo)) {
        return false;
      }
      if (pr.state !== "OPEN") {
        flash("Only open pull requests can disable auto-merge.");
        return false;
      }
      if (!pr.autoMergeEnabled) {
        flash("Auto-merge is already disabled.");
        return false;
      }

      setPrActionSubmitting(true);
      try {
        await api.disablePullRequestAutoMerge({
          repo: selectedRepo,
          pullNumber: pr.number,
          pullRequestId: pr.id
        });
        const refreshed = await refreshPullRequest(selectedRepo, pr.number);
        setProjectPullRequestTab(pullRequestTabForState(refreshed));
        flash(`Disabled auto-merge for PR #${pr.number}`);
        return true;
      } catch (error) {
        flash(userFacingError(error, "Unable to disable auto-merge."));
        return false;
      } finally {
        setPrActionSubmitting(false);
      }
    },
    [flash, refreshPullRequest, selectedRepo, setProjectPullRequestTab]
  );

  const mergePullRequest = useCallback(
    async (pr: PullRequestSummary): Promise<boolean> => {
      if (!selectedRepo || !canManagePullRequest(selectedRepo)) {
        return false;
      }
      if (pr.state !== "OPEN") {
        flash("Only open pull requests can be merged.");
        return false;
      }
      if (!window.confirm(`Merge PR #${pr.number}?`)) {
        return false;
      }

      setPrActionSubmitting(true);
      try {
        await api.mergePullRequest({
          repo: selectedRepo,
          pullNumber: pr.number
        });
        const refreshed = await refreshPullRequest(selectedRepo, pr.number);
        setProjectPullRequestTab(pullRequestTabForState(refreshed));
        flash(`Merged PR #${pr.number}`);
        return true;
      } catch (error) {
        flash(error instanceof Error ? error.message : "Unable to merge pull request.");
        return false;
      } finally {
        setPrActionSubmitting(false);
      }
    },
    [flash, refreshPullRequest, selectedRepo, setProjectPullRequestTab]
  );

  const closePullRequest = useCallback(
    async (pr: PullRequestSummary): Promise<boolean> => {
      if (!selectedRepo || !canManagePullRequest(selectedRepo)) {
        return false;
      }
      if (pr.state !== "OPEN") {
        flash("Only open pull requests can be closed.");
        return false;
      }
      if (!window.confirm(`Close PR #${pr.number}?`)) {
        return false;
      }

      setPrActionSubmitting(true);
      try {
        await api.closePullRequest({
          repo: selectedRepo,
          pullNumber: pr.number
        });
        const refreshed = await refreshPullRequest(selectedRepo, pr.number);
        setProjectPullRequestTab(pullRequestTabForState(refreshed));
        flash(`Closed PR #${pr.number}`);
        return true;
      } catch (error) {
        flash(error instanceof Error ? error.message : "Unable to close pull request.");
        return false;
      } finally {
        setPrActionSubmitting(false);
      }
    },
    [flash, refreshPullRequest, selectedRepo, setProjectPullRequestTab]
  );

  const selectRun = useCallback(
    (run: WorkflowRunSummary) => {
      if (initialItem) {
        onNavigateItem?.({ key: contentItemKey(selectedRepo?.id, `run:${run.id}`), repo: selectedRepo, selection: { kind: "run", run }, focusView: "workflow-runs" });
        return;
      }
      setStoredProjectFocusView("workflow-runs");
      setSelection({ kind: "run", run });
      setRunTab("Jobs");
    },
    [setStoredProjectFocusView, selectedRepo, onNavigateItem]
  );

  const selectMiddleItem = useCallback(
    (item: MiddleItem) => {
      if (item.kind === "pr") {
        setProjectPullRequestTab(pullRequestTabForState(item.pr));
        setSelection({ kind: "pr", pr: item.pr });
        setPrTab("Description");
      }
      if (item.kind === "release") setSelection({ kind: "release", release: item.release });
      if (item.kind === "issue") {
        setSelection({ kind: "issue", issue: item.issue });
      }
      if (item.kind === "run") {
        selectRun(item.run);
      }
      if (item.kind === "workflow") {
        setSelection({ kind: "workflow", workflow: item.workflow });
      }
    },
    [selectRun, setProjectPullRequestTab]
  );

  const ensureNativeNotificationPermission = useCallback(async (): Promise<boolean> => {
    if (nativeNotificationPermission.current === "granted") {
      return true;
    }

    const permission = await api.requestNotificationPermission();
    nativeNotificationPermission.current = permission;
    return permission !== "denied";
  }, []);

  const showFavoriteProjectNotification = useCallback(
    async (payload: NativeNotificationPayload): Promise<void> => {
      if (!(await ensureNativeNotificationPermission())) {
        return;
      }

      await api.showNativeNotification(payload);
    },
    [ensureNativeNotificationPermission]
  );

  const focusNotificationSource = useCallback(
    (source: NativeNotificationSource) => {
      const repo = reposByKey.get(repoKey(source.repo)) ?? source.repo;
      const targetRepoKey = repoKey(repo);
      const alreadySelectedRepo = selectedRepoKeyRef.current === targetRepoKey;
      selectedRepoKeyRef.current = targetRepoKey;
      setSelectedRepo(repo);
      setRepoLabels([]);
      setContentError(null);
      setPaletteOpen(false);
      setLocalRecentKeys((current) => [targetRepoKey, ...current.filter((key) => key !== targetRepoKey)].slice(0, 20));

      if (source.kind === "pull-request") {
        setStoredProjectFocusView("pull-requests");
        setProjectPullRequestTab(pullRequestTabForState(source.pullRequest));
        if (alreadySelectedRepo) {
          setPullRequests((current) =>
            current.some((pr) => pr.number === source.pullRequest.number)
              ? current.map((pr) => (pr.number === source.pullRequest.number ? source.pullRequest : pr))
              : [source.pullRequest, ...current]
          );
        } else {
          setPullRequests([source.pullRequest]);
          setWorkflowRuns([]);
          setIssues([]);
          setReleases([]);
          setWorkflows([]);
        }
        setPrDetail(null);
        setRunDetail(null);
        setPrTab("Description");
        setSelection({ kind: "pr", pr: source.pullRequest });
        return;
      }

      setStoredProjectFocusView("workflow-runs");
      if (alreadySelectedRepo) {
        setWorkflowRuns((current) =>
          current.some((run) => run.id === source.run.id)
            ? current.map((run) => (run.id === source.run.id ? source.run : run))
            : [source.run, ...current]
        );
      } else {
        setWorkflowRuns([source.run]);
        setPullRequests([]);
        setIssues([]);
        setReleases([]);
        setWorkflows([]);
      }
      setPrDetail(null);
      setRunDetail(null);
      setRunTab("Jobs");
      setSelection({ kind: "run", run: source.run });
    },
    [
      reposByKey,
      setLocalRecentKeys,
      setProjectPullRequestTab,
      setStoredProjectFocusView
    ]
  );

  const refreshFavoriteProjectsForNotifications = useCallback(async (): Promise<void> => {
    if (!authConfiguredRef.current || favoriteProjectRefreshInFlight.current) {
      return;
    }

    const favoriteReposToRefresh = favoriteReposRef.current;
    if (!favoriteReposToRefresh.length) {
      setFavoriteProjectMonitorStatus({ checking: false, lastCheckedAt: null });
      return;
    }

    favoriteProjectRefreshInFlight.current = true;
    setFavoriteProjectMonitorStatus((current) => ({ ...current, checking: true }));
    let firstError: unknown = null;
    try {
      for (const repo of favoriteReposToRefresh) {
        const key = repoKey(repo);
        try {
          const [prs, runs] = await Promise.all([
            api.getPullRequests(repo, { force: true }),
            api.getWorkflowRuns(repo, { force: true })
          ]);
          const previous = favoriteProjectNotificationSnapshots.current.get(key);
          const nextSnapshot: FavoriteProjectNotificationSnapshot = {
            pullRequestKeys: openPullRequestNotificationKeys(prs.data),
            failedWorkflowRunKeys: failedWorkflowRunNotificationKeys(runs.data)
          };

          if (previous) {
            const newPullRequests = findNewOpenPullRequests(previous.pullRequestKeys, prs.data);
            const newFailedRuns = findNewFailedWorkflowRuns(previous.failedWorkflowRunKeys, runs.data);
            for (const pr of newPullRequests) {
              await showFavoriteProjectNotification(pullRequestNotificationPayload(repo, pr));
            }
            for (const run of newFailedRuns) {
              await showFavoriteProjectNotification(workflowFailureNotificationPayload(repo, run));
            }
          }

          favoriteProjectNotificationSnapshots.current.set(key, nextSnapshot);
          if (selectedRepoKeyRef.current === key) {
            setPullRequests(prs.data);
            setWorkflowRuns(runs.data);
            setSelection((current) => {
              if (current.kind === "pr") {
                const refreshed = prs.data.find((pr) => pr.number === current.pr.number);
                return refreshed ? { kind: "pr", pr: refreshed } : current;
              }
              if (current.kind === "run") {
                const refreshed = runs.data.find((run) => run.id === current.run.id);
                return refreshed ? { ...current, run: refreshed } : current;
              }
              return current;
            });
          }
        } catch (error) {
          firstError ??= error;
          console.warn(`Unable to background refresh ${key}`, error);
        }
      }
    } finally {
      favoriteProjectRefreshInFlight.current = false;
      setFavoriteProjectMonitorStatus({
        checking: false,
        lastCheckedAt: new Date().toISOString()
      });
    }
    if (firstError) {
      throw firstError;
    }
  }, [showFavoriteProjectNotification]);

  const refreshSelectedProjectForPolling = useCallback(async (): Promise<void> => {
    const repo = selectedRepoRef.current;
    if (!repo) {
      return;
    }

    if (initialItem) {
      // Detached items refresh only their own content; navigation owns project lists.
      if (selection.kind === "pr") {
        const [detail, runs] = await Promise.all([api.getPullRequest(repo, selection.pr.number, { force: true }), api.getWorkflowRuns(repo)]);
        setPrDetail(detail.data); setWorkflowRuns(runs.data);
      } else if (selection.kind === "run") {
        setRunDetail((await api.getWorkflowRun(repo, selection.run.id, { force: true })).data);
      } else if (selection.kind === "workflow") {
        setWorkflowRuns((await api.getWorkflowRuns(repo, { force: true })).data);
      } else if (selection.kind === "release") {
        const refreshed = (await api.getReleases(repo, { force: true })).data.find(release => release.id === selection.release.id);
        if (refreshed) setSelection({ kind: "release", release: refreshed });
      } else if (selection.kind === "issue") {
        const refreshed = (await api.getIssues(repo, { force: true })).data.find(issue => issue.id === selection.issue.id);
        if (refreshed) setSelection({ kind: "issue", issue: refreshed });
      }
      return;
    }

    const key = repoKey(repo);
    const now = Date.now();
    const shouldRefreshFullProject =
      !hasLiveWorkflow || now - activeProjectLastFullRefreshAt.current >= activeProjectPollingIntervalMs;
    const pullRequestsPromise = shouldRefreshFullProject
      ? api.getPullRequests(repo, { force: true })
      : Promise.resolve(null);
    const issuesPromise = shouldRefreshFullProject
      ? api.getIssues(repo, { force: true })
      : Promise.resolve(null);
    const pullRequestDetailPromise = initialItem && shouldRefreshFullProject && selectedPullRequestNumber !== null
      ? api.getPullRequest(repo, selectedPullRequestNumber, { force: true })
      : Promise.resolve(null);
    const workflowRunDetailPromise = initialItem && selectedWorkflowRunId !== null
      ? api.getWorkflowRun(repo, selectedWorkflowRunId, { force: true })
      : Promise.resolve(null);

    const [prs, repoIssues, runs, pullRequestDetail, workflowRunDetail, repoReleases] = await Promise.all([
      pullRequestsPromise,
      issuesPromise,
      api.getWorkflowRuns(repo, { force: true }),
      pullRequestDetailPromise,
      workflowRunDetailPromise,
      shouldRefreshFullProject ? api.getReleases(repo, { force: true }) : Promise.resolve(null)
    ]);

    if (selectedRepoKeyRef.current !== key) {
      return;
    }

    if (shouldRefreshFullProject) {
      activeProjectLastFullRefreshAt.current = now;
    }
    if (prs) {
      setPullRequests(prs.data);
    }
    if (repoReleases) setReleases(repoReleases.data);
    if (repoIssues) {
      setIssues(repoIssues.data);
    }
    setWorkflowRuns(runs.data);
    if (pullRequestDetail) {
      setPrDetail(pullRequestDetail.data);
    }
    if (workflowRunDetail) {
      setRunDetail(workflowRunDetail.data);
    }
    setSelection((current) => {
      if (current.kind === "pr" && prs) {
        const refreshed = prs.data.find((pr) => pr.number === current.pr.number);
        return refreshed ? { kind: "pr", pr: refreshed } : current;
      }
      if (current.kind === "release" && repoReleases) {
        const refreshed = repoReleases.data.find(release => release.id === current.release.id);
        return refreshed ? { kind: "release", release: refreshed } : current;
      }
      if (current.kind === "issue" && repoIssues) {
        const refreshed = repoIssues.data.find((issue) => issue.number === current.issue.number);
        return refreshed ? { kind: "issue", issue: refreshed } : current;
      }
      if (current.kind === "run") {
        const refreshed = runs.data.find((run) => run.id === current.run.id);
        return refreshed ? { ...current, run: refreshed } : current;
      }
      return current;
    });
  }, [hasLiveWorkflow, selectedPullRequestNumber, selectedWorkflowRunId, initialItem ? selection : null]);

  useAdaptivePolling(
    refreshSelectedProjectForPolling,
    pollingIntervalMs(hasLiveWorkflow),
    Boolean(auth?.configured && selectedRepoKey),
    { document: contentPane.surface.document }
  );

  useAdaptivePolling(
    refreshFavoriteProjectsForNotifications,
    favoriteProjectPollingIntervalMs,
    Boolean(!initialItem && auth?.configured && favoriteProjectRefreshKey),
    { immediately: true, document: contentPane.surface.document }
  );

  const openGithub = useCallback(() => {
    if (currentGithubUrl) {
      void api.openInGitHub(currentGithubUrl);
    }
  }, [currentGithubUrl]);

  const openGithubUrl = useCallback((url: string) => {
    void api.openInGitHub(url);
  }, []);

  const restoreNavigationEntry = useCallback(
    (entry: NavigationEntry) => {
      restoringNavigation.current = true;
      setSelectedRepo(entry.repo);
      setSelection(entry.selection);
      setStoredProjectFocusView(entry.focusView);
      setProjectPullRequestTab(entry.pullRequestTab);
      setProjectWorkflowTab(entry.workflowTab);
      setReleaseTab(entry.releaseTab);
      if (entry.selection.kind === "pr") {
        setPrTab("Description");
      }
      if (entry.selection.kind === "run") {
        const restoredRun = entry.selection.run;
        setRunTab("Jobs");
        setWorkflowRuns((current) =>
          current.some((run) => run.id === restoredRun.id)
            ? current
            : [restoredRun, ...current]
        );
      }
      if (entry.selection.kind === "repo") {
        setPrDetail(null);
        setRunDetail(null);
      }
    },
    [setProjectPullRequestTab, setProjectWorkflowTab, setStoredProjectFocusView]
  );

  const navigateHistory = useCallback(
    (delta: -1 | 1) => {
      const nextIndex = navigation.index + delta;
      const entry = navigation.entries[nextIndex];
      if (!entry) {
        return;
      }

      setNavigation((current) => ({
        entries: current.entries,
        index: nextIndex
      }));
      restoreNavigationEntry(entry);
    },
    [navigation, restoreNavigationEntry]
  );

  const openWorkflowRunFromCheck = useCallback(
    (check: CheckSummary) => {
      if (!selectedRepo || !check.workflowRunId) {
        if (isGithubUrl(check.url)) {
          void api.openInGitHub(check.url ?? "");
        }
        return;
      }

      const run =
        workflowRuns.find((item) => item.id === check.workflowRunId)
        ?? workflowRunFallbackFromCheck(selectedRepo, check);
      if (initialItem) {
        onNavigateItem?.({ key: contentItemKey(selectedRepo.id, `run:${run.id}`), repo: selectedRepo, selection: { kind: "run", run, focusedJobId: check.jobId ?? null }, focusView: "workflow-runs" });
        return;
      }
      setStoredProjectFocusView("workflow-runs");
      setWorkflowRuns((current) => (current.some((item) => item.id === run.id) ? current : [run, ...current]));
      setSelection({ kind: "run", run, focusedJobId: check.jobId ?? null });
      setRunTab("Jobs");
    },
    [selectedRepo, setStoredProjectFocusView, workflowRuns, onNavigateItem]
  );

  const moveMiddleSelection = useCallback(
    (delta: number) => {
      if (!middleItems.length) {
        return;
      }

      const currentId =
        selection.kind === "release" ? `release:${selection.release.id}` : selection.kind === "pr"
          ? `pr:${selection.pr.number}`
          : selection.kind === "issue"
            ? `issue:${selection.issue.number}`
            : selection.kind === "run"
              ? `run:${selection.run.id}`
              : selection.kind === "workflow"
                ? `workflow:${selection.workflow.id}`
                : "";
      const index = middleItems.findIndex((item) => item.id === currentId);
      const nextIndex =
        index === -1
          ? delta > 0
            ? 0
            : middleItems.length - 1
          : (index + delta + middleItems.length) % middleItems.length;
      selectMiddleItem(middleItems[nextIndex]);
    },
    [middleItems, selectMiddleItem, selection]
  );

  const paletteItems = useMemo<PaletteItem[]>(() => {
    const items: PaletteItem[] = [
      {
        id: "action:toggle-sidebar",
        kind: "action",
        title: "Toggle sidebar",
        run: () => setSidebarCollapsedWithAnimation((value) => !value)
      }
    ];

    if (currentGithubUrl) {
      items.push({
        id: "action:open-github",
        kind: "action",
        title: "Open in GitHub",
        subtitle: currentGithubUrl,
        run: openGithub
      });
    }

    for (const repo of allRepos) {
      items.push({
        id: `repo:${repo.fullName}`,
        kind: "repo",
        title: repo.fullName,
        subtitle: repo.description ?? "",
        run: () => selectRepo(repo)
      });
    }

    if (selectedRepo) {
      for (const pr of pullRequests) {
        items.push({
          id: `pr:${pr.number}`,
          kind: "pr",
          title: `#${pr.number} ${pr.title}`,
          subtitle: selectedRepo.fullName,
          run: () => {
            setStoredProjectFocusView("pull-requests");
            setProjectPullRequestTab(pullRequestTabForState(pr));
            setSelection({ kind: "pr", pr });
          }
        });
      }

      for (const issue of issues) {
        items.push({
          id: `issue:${issue.number}`,
          kind: "issue",
          title: `#${issue.number} ${issue.title}`,
          subtitle: selectedRepo.fullName,
          run: () => setSelection({ kind: "issue", issue })
        });
      }

      for (const run of workflowRuns) {
        items.push({
          id: `run:${run.id}`,
          kind: "run",
          title: run.displayTitle || run.name || `Run ${run.id}`,
          subtitle: `${selectedRepo.fullName} ${run.branch ?? ""}`,
          run: () => setSelection({ kind: "run", run })
        });
      }

      for (const workflow of workflows) {
        items.push({
          id: `workflow:${workflow.id}`,
          kind: "workflow",
          title: workflow.name,
          subtitle: selectedRepo.fullName,
          run: () => setSelection({ kind: "workflow", workflow })
        });
      }
    }

    return items;
  }, [
    allRepos,
    currentGithubUrl,
    issues,
    openGithub,
    pullRequests,
    selectRepo,
    selectedRepo,
    setProjectPullRequestTab,
    setSidebarCollapsedWithAnimation,
    setStoredProjectFocusView,
    workflowRuns,
    workflows
  ]);

  const filteredPaletteItems = useMemo(() => {
    const needle = paletteQuery.trim().toLowerCase();
    if (!needle) {
      return paletteItems.slice(0, 80);
    }

    return paletteItems
      .filter((item) => `${item.title} ${item.subtitle ?? ""}`.toLowerCase().includes(needle))
      .slice(0, 80);
  }, [paletteItems, paletteQuery]);

  useEffect(() => {
    if (initialItem) { setAuth(sharedAuth ?? null); return; }
    let cancelled = false;

    void (async () => {
      try {
        const nextAuth = await api.getAuthStatus();
        if (!cancelled) {
          setAuth(nextAuth);
        }
      } catch (error) {
        if (!cancelled) {
          setAuth({ configured: false, encryptionAvailable: false, viewerLogin: null });
          setAuthError(userFacingError(error, "Unable to check GitHub sign-in."));
        }
      } finally {
        if (!cancelled) {
          setAuthChecking(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [sharedAuth]);

  useEffect(
    () => () => {
      if (layoutAnimationTimer.current) {
        window.clearTimeout(layoutAnimationTimer.current);
      }
    },
    []
  );

  useEffect(() => {
    if (auth?.configured && !initialItem) {
      void loadInitial();
    }
  }, [auth?.configured, loadInitial]);

  useEffect(() => {
    if (!currentNavigationEntry.repo) {
      return;
    }

    if (restoringNavigation.current) {
      restoringNavigation.current = false;
      return;
    }

    setNavigation((current) => {
      const active = current.entries[current.index];
      const nextKey = navigationEntryKey(currentNavigationEntry);
      if (active && navigationEntryKey(active) === nextKey) {
        const entries = [...current.entries];
        entries[current.index] = currentNavigationEntry;
        return { entries, index: current.index };
      }

      const entries = [...current.entries.slice(0, current.index + 1), currentNavigationEntry].slice(-80);
      return {
        entries,
        index: entries.length - 1
      };
    });
  }, [currentNavigationEntry]);

  useEffect(() => {
    if (selectedRepo && auth?.configured) {
      void loadProject(selectedRepo);
    }
  }, [auth?.configured, loadProject, selectedRepoKey]);

  useEffect(() => {
    if (!initialItem || !selectedRepo || selectedPullRequestNumber === null) {
      return;
    }

    let cancelled = false;
    setContentLoading(true);
    setContentError(null);
    setPrDetail(null);
    void api
      .getPullRequest(selectedRepo, selectedPullRequestNumber)
      .then((response) => {
        if (!cancelled) {
          setPrDetail(response.data);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setContentError(error instanceof Error ? error.message : "Unable to load pull request.");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setContentLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [selectedPullRequestNumber, selectedRepoKey]);

  useEffect(() => {
    if (!initialItem || !selectedRepo || selectedWorkflowRunId === null) {
      return;
    }

    let cancelled = false;
    setContentLoading(true);
    setContentError(null);
    setRunDetail(null);
    void api
      .getWorkflowRun(selectedRepo, selectedWorkflowRunId)
      .then((response) => {
        if (!cancelled) {
          setRunDetail(response.data);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setContentError(error instanceof Error ? error.message : "Unable to load workflow run.");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setContentLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [selectedRepoKey, selectedWorkflowRunId]);

  useEffect(() => {
    const unsubscribe = api.onCacheUpdated((key) => {
      if (!initialItem && key.startsWith("viewer:")) {
        void loadInitial(false);
      }
      if (selectedRepo && key === `repo:${repoKey(selectedRepo)}:releases`) {
        const refreshedRepoKey = repoKey(selectedRepo);
        void api.getReleases(selectedRepo, { force: true }).then(response => {
          if (selectedRepoKeyRef.current !== refreshedRepoKey) return;
          setReleases(response.data);
          setSelection(current => {
            if (current.kind !== "release") return current;
            const release = response.data.find(release => release.id === current.release.id);
            return release ? { kind: "release", release } : current;
          });
        }).catch(error => setProjectError(userFacingError(error, "Unable to refresh releases.")));
        return;
      }
      if (selectedRepo && key.startsWith(`repo:${repoKey(selectedRepo)}`) && !isPullRequestCacheUpdate(key)) {
        void loadProject(selectedRepo, false);
      }
    });
    return unsubscribe;
  }, [loadInitial, loadProject, selectedRepo]);

  useEffect(() => initialItem ? undefined : api.onNativeNotificationClicked(focusNotificationSource), [focusNotificationSource]);

  useEffect(() => {
    if (paletteIndex >= filteredPaletteItems.length) {
      setPaletteIndex(0);
    }
  }, [filteredPaletteItems.length, paletteIndex]);

  useEffect(() => {
    if (initialItem) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (chatMode && !appKeyboardShortcut(event) && !((event.metaKey || event.ctrlKey) && ["b", "k"].includes(event.key.toLowerCase()))) return;
      if (isHtmlElement(event.target) && event.target.closest(".codex-terminal-screen")) return;
      if (hasOpenKeyboardOverlay((event.target as Node | null)?.ownerDocument ?? (event.currentTarget as Window).document)) return;
      if (isTabNavigation(event) && (projectFocusView === "codex" || settingsScope)) return;
      if (isTabNavigation(event)) {
        event.preventDefault();
        return;
      }

      const shortcut = appKeyboardShortcut(event);
      if (shortcut) {
        setChatMode(false);
        event.preventDefault();

        if (shortcut === "refresh-repository") {
          const source = [...detachedItems.values()].find(entry => entry.pane.surface.document === (event.target as Node | null)?.ownerDocument);
          if (source) source.pane.host.dispatchEvent(new Event("forge:refresh-item"));
          else void refreshActivePane();
          return;
        }

        if (shortcut === "previous-favorite-repository" || shortcut === "next-favorite-repository") {
          const favoriteKey = adjacentFavoriteRepositoryKey(
            favoriteKeys,
            selectedRepoKey,
            shortcut === "previous-favorite-repository" ? -1 : 1
          );
          const repo = favoriteKey ? reposByKey.get(favoriteKey) : null;
          if (repo) {
            selectRepo(repo);
          }
          return;
        }

        if (shortcut === "open-pull-requests") {
          setStoredProjectFocusView("pull-requests");
          if (selection.kind === "codex") setSelection({ kind: "repo" });
          setProjectPullRequestTab("open");
          return;
        }

        setStoredProjectFocusView(shortcut);
        if (shortcut !== "codex" && selection.kind === "codex") setSelection({ kind: "repo" });
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen(true);
        setPaletteQuery("");
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "b") {
        event.preventDefault();
        setSidebarCollapsedWithAnimation((value) => !value);
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.key === "[") {
        event.preventDefault();
        navigateHistory(-1);
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.key === "]") {
        event.preventDefault();
        navigateHistory(1);
        return;
      }

      if (paletteOpen || isTypingTarget(event.target)) {
        return;
      }

      if (event.key === "Escape" && selection.kind !== "repo") {
        setSelection({ kind: "repo" });
        return;
      }

      const selectionDelta = middlePaneSelectionDelta(event);
      if (selectionDelta !== null && projectFocusView !== "codex") {
        event.preventDefault();
        setMiddleKeyboardNavigating(true);
        moveMiddleSelection(selectionDelta);
        return;
      }

      const viewDirection = projectViewNavigationDirection(event);
      if (viewDirection !== null) {
        event.preventDefault();
        const nextView = adjacentProjectFocusView(projectFocusView, viewDirection);
        setStoredProjectFocusView(nextView);
        if (nextView !== "codex" && selection.kind === "codex") setSelection({ kind: "repo" });
        if (nextView === "pull-requests") {
          setProjectPullRequestTab("open");
        }
        return;
      }

      if (event.key.toLowerCase() === "g") {
        const now = Date.now();
        if (now - lastGPress.current < 650) {
          event.preventDefault();
          const source = [...detachedItems.values()].find(entry => entry.pane.surface.document === (event.target as Node | null)?.ownerDocument);
          const url = source ? openUrlForSelection(source.target.selection, source.target.repo) : currentGithubUrl;
          if (url) openGithubUrl(url);
          lastGPress.current = 0;
        } else {
          lastGPress.current = now;
        }
      }
    };

    const targets = [window, ...[...detachedItems.values()].map(entry => entry.pane.surface).filter(surface => surface !== window)];
    targets.forEach(target => target.addEventListener("keydown", onKeyDown, true));
    return () => targets.forEach(target => target.removeEventListener("keydown", onKeyDown, true));
  }, [
    chatMode,
    detachedItems,
    favoriteKeys,
    moveMiddleSelection,
    navigateHistory,
    openGithub,
    paletteOpen,
    projectFocusView,
    refreshActivePane,
    reposByKey,
    selectRepo,
    selection.kind,
    selectedRepoKey,
    setProjectPullRequestTab,
    setSidebarCollapsedWithAnimation,
    setStoredProjectFocusView,
    sidebarCollapsed,
    settingsScope
  ]);

  const signInGithub = async () => {
    setAuthError(null);
    setGithubSigningIn(true);
    try {
      const nextAuth = await api.signInGithub();
      setAuth(nextAuth);
      onAuthChange?.(nextAuth);
    } catch (error) {
      setAuthError(userFacingError(error, "Unable to sign in with GitHub."));
    } finally {
      setGithubSigningIn(false);
    }
  };

  const resetGitHubWorkspace = useCallback(() => {
    setRepositories([]);
    setStarredRepos([]);
    setRecentRepos([]);
    setOrganizations([]);
    setSelectedRepo(null);
    setRepoLabels([]);
    setPullRequests([]);
    setIssues([]);
    setReleases([]);
    setWorkflows([]);
    setWorkflowRuns([]);
    setSelection({ kind: "repo" });
  }, []);

  const clearStoredToken = useCallback(async (): Promise<boolean> => {
    try {
      const nextAuth = await api.clearToken();
      setAuth(nextAuth);
      onAuthChange?.(nextAuth);
      resetGitHubWorkspace();
      return true;
    } catch (error) {
      flash(userFacingError(error, "Unable to sign out of GitHub."));
      return false;
    }
  }, [flash, onAuthChange, resetGitHubWorkspace]);

  const requestClearStoredToken = useCallback(() => {
    openConfirmation({
      title: "Sign out of GitHub?",
      message: "Your saved GitHub credentials will be removed from this Mac. Sign in again to continue using Forge.",
      confirmLabel: "Sign out",
      onConfirm: clearStoredToken
    });
  }, [clearStoredToken, openConfirmation]);

  const startResize = (pane: "left" | "middle", startEvent: React.PointerEvent) => {
    startEvent.currentTarget.setPointerCapture(startEvent.pointerId);
    const startX = startEvent.clientX;
    const startWidth = pane === "left" ? leftWidth : middleWidth;

    const onMove = (event: PointerEvent) => {
      const delta = event.clientX - startX;
      const next = Math.max(pane === "left" ? 220 : 300, Math.min(startWidth + delta, pane === "left" ? 420 : 520));
      if (pane === "left") {
        setLeftWidth(next);
      } else {
        setMiddleWidth(next);
      }
    };

    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const terminalThread = selection.kind === "codex" ? codexThreads.threads.find((thread) => thread.id === selection.threadId) : undefined;
  const toggleContentAttachment = () => {
    try {
      if (contentPane.detached) contentPane.reattach();
      else contentPane.detach();
    } catch (error) { flash(error instanceof Error ? error.message : String(error)); }
  };
  const contentRoute = `${selectedRepo?.id}:${selectionRouteKey(selection)}`;
  const contentTitle = selection.kind === "codex" ? (terminalThread ? `Codex - ${terminalThread.title}` : "Codex")
    : selection.kind === "pr" ? selection.pr.title
    : selection.kind === "release" ? selection.release.name || selection.release.tagName
    : selection.kind === "issue" ? selection.issue.title
    : selection.kind === "run" ? workflowRunDisplayName(selection.run)
    : selection.kind === "workflow" ? selection.workflow.name
    : selectedRepo?.fullName;
  const activeTarget: ContentItemTarget = {
    key: contentItemKey(selectedRepo?.id, projectFocusView === "codex" && selection.kind !== "codex" ? "codex-empty" : selectionRouteKey(selection)),
    repo: selectedRepo,
    selection: projectFocusView === "codex" && selection.kind !== "codex" ? { kind: "repo" } : selection,
    focusView: projectFocusView,
  };
  const activeDetached = !initialItem && (chatMode ? chatDetached : Boolean(detachedItems.get(activeTarget.key)?.pane.detached));
  const focusSelectedItem = (targetSelection: ContentSelection) => detachedItems.get(contentItemKey(selectedRepo?.id, selectionRouteKey(targetSelection)))?.pane.focus();
  const navigateToItem = useCallback((target: ContentItemTarget) => {
    setChatMode(false);
    setSelectedRepo(target.repo); setSelection(target.selection); setStoredProjectFocusView(target.focusView);
    if (target.selection.kind === "release") setReleaseTab(target.selection.release.isDraft ? "draft" : target.selection.release.isPrerelease ? "preview" : "active");
    if (target.selection.kind === "pr") setProjectPullRequestTab(pullRequestTabForState(target.selection.pr));
    detachedItems.get(target.key)?.pane.focus();
  }, [detachedItems, setStoredProjectFocusView, setProjectPullRequestTab]);
  useEffect(() => { if (!initialItem) detachedItems.get(activeTarget.key)?.pane.focus(); }, [contentRoute]);
  useEffect(() => { if (contentPane.error) flash(contentPane.error); }, [contentPane.error, flash]);
  const terminalKey = `${selectedRepo?.id}:${terminalThread?.id}`;
  const terminalOpen = Boolean(terminalThread && !terminalThread.archived && openTerminals[terminalKey]);
  const toggleTerminal = () => { if (terminalThread) setOpenTerminals((current) => ({ ...current, [terminalKey]: !current[terminalKey] })); };
  useEffect(() => {
    if (initialItem) return;
    void api.setContentPaneLayout?.({
      detached: activeDetached,
      cssWidth: middleWidth + (sidebarCollapsed ? sidebarRailWidth + 1 : leftWidth + 1),
    }).catch(error => console.warn("Unable to resize the content layout", error));
  }, [activeDetached, sidebarCollapsed, leftWidth, middleWidth]);
  const gridTemplateColumns = activeDetached
    ? (sidebarCollapsed ? `${sidebarRailWidth}px 1px minmax(0, 1fr)` : `${leftWidth}px 1px minmax(0, 1fr)`)
    : sidebarCollapsed
    ? `${sidebarRailWidth}px 1px ${middleWidth}px 1px minmax(0, 1fr)`
    : `${leftWidth}px 1px ${middleWidth}px 1px minmax(0, 1fr)`;
  const globalAccent = normalizeAccentColor(activeTheme === "dark" ? darkAccentColor : lightAccentColor, defaultAccentByTheme[activeTheme]);
  const selectedAccent = appearance?.accent ?? projectAccentColor(projectAccentColors, chatMode ? undefined : selectedRepo?.id, globalAccent);
  const appStyle: AppCssVars = {
    gridTemplateColumns,
    "--accent": selectedAccent
  };
  const authScreenStyle: AppCssVars = {
    "--accent": selectedAccent
  };
  const toggleSidebarAppearance = useCallback(() => {
    const setAppearance = activeTheme === "dark" ? setDarkSidebarAppearance : setLightSidebarAppearance;
    setAppearance((current) => (normalizeSidebarAppearanceMode(current) === "glass" ? "normal" : "glass"));
  }, [activeTheme, setDarkSidebarAppearance, setLightSidebarAppearance]);

  useEffect(() => {
    if (initialItem) return;
    if (nativeSidebarAppearanceTimer.current) {
      window.clearTimeout(nativeSidebarAppearanceTimer.current);
      nativeSidebarAppearanceTimer.current = null;
    }

    const previous = previousSidebarAppearance.current;
    previousSidebarAppearance.current = sidebarAppearance;
    const prefersReducedMotion =
      typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const shouldDelayNativeNormalMode =
      api.platform === "darwin" &&
      previous === "glass" &&
      sidebarAppearance === "normal" &&
      !prefersReducedMotion;

    if (!shouldDelayNativeNormalMode) {
      void api.setSidebarAppearanceMode(sidebarAppearance).catch(() => undefined);
      return;
    }

    nativeSidebarAppearanceTimer.current = window.setTimeout(() => {
      nativeSidebarAppearanceTimer.current = null;
      void api.setSidebarAppearanceMode(sidebarAppearance).catch(() => undefined);
    }, sidebarAppearanceTransitionMs);

    return () => {
      if (nativeSidebarAppearanceTimer.current) {
        window.clearTimeout(nativeSidebarAppearanceTimer.current);
        nativeSidebarAppearanceTimer.current = null;
      }
    };
  }, [sidebarAppearance]);

  useEffect(() => {
    if (initialItem) return;
    void api.setNativeThemeSource(nativeThemeSource).catch(() => undefined);
  }, [nativeThemeSource]);

  const overlays = <>{settingsScope && (
        <CodexSettingsDialog
          project={settingsScope === "project" ? selectedRepo ?? undefined : undefined}
          projectAccent={selectedRepo ? projectAccentColors?.[selectedRepo.id] : undefined}
          onSaveProjectAccent={(color) => {
            if (!selectedRepo) return;
            setProjectAccentColors(current => {
              const next = { ...current };
              if (color) next[selectedRepo.id] = color;
              else delete next[selectedRepo.id];
              return next;
            });
          }}
          auth={auth}
          onClose={() => setSettingsScope(null)}
          onSignInGithub={async () => {
            const next = await api.signInGithub();
            resetGitHubWorkspace();
            setAuth(next);
            onAuthChange?.(next);
          }}
          onCancelGithubSignIn={() => api.cancelGithubSignIn()}
          onRemoveGithub={() => {
            setSettingsScope(null);
            requestClearStoredToken();
          }}
          onOpenUrl={openGithubUrl}
        />
      )}
      {confirmationDialog && (
        <ConfirmationDialog
          title={confirmationDialog.title}
          message={confirmationDialog.message}
          confirmLabel={confirmationDialog.confirmLabel}
          submitting={confirmationSubmitting}
          onClose={closeConfirmation}
          onConfirm={() => void submitConfirmation()}
        />
      )}
      {workflowDispatchDialog && selectedRepo && (
        <WorkflowDispatchDialog
          repo={selectedRepo}
          state={workflowDispatchDialog}
          onClose={closeWorkflowDispatchDialog}
          onChangeValue={updateWorkflowDispatchDialogValue}
          onSubmit={() => void submitWorkflowDispatchDialog()}
        />
      )}
      {paletteOpen && (
        <CommandPalette
          query={paletteQuery}
          items={filteredPaletteItems}
          index={paletteIndex}
          onQuery={setPaletteQuery}
          onIndex={setPaletteIndex}
          onClose={() => setPaletteOpen(false)}
        />
      )}
      {toast && <div className="toast">{toast}</div>}</>;
  if (initialItem) return (
    <DetachablePane pane={contentPane} theme={activeTheme} accent={selectedAccent} appearance={sidebarAppearance} title={displayPathText(contentTitle ?? "Forge", Boolean(terminalThread?.environment))}>
      <ContentPane
        detached={contentPane.detached}
        attachmentOpening={contentPane.opening || !selectedRepo || (projectFocusView === "codex" && selection.kind !== "codex")}
        onToggleAttachment={toggleContentAttachment}
        codexActions={projectFocusView === "codex" ? (
          <>
            <CodexQuickActions
              key={`${selectedRepo?.id}:${selection.kind === "codex" ? selection.threadId : "none"}`}
              thread={selection.kind === "codex" ? codexThreads.threads.find((thread) => thread.id === selection.threadId) : undefined}
              theme={activeTheme}
              group="checkout"
            />
            <button className="icon-button codex-terminal-toggle" aria-label="Toggle terminal" title={terminalThread ? "Toggle terminal" : "Select a chat to open its terminal"} aria-pressed={terminalOpen} disabled={!terminalThread || terminalThread.archived} onClick={toggleTerminal}>
              <TerminalSquare size={16} />
            </button>
          </>
        ) : undefined}
        codexTitle={terminalThread ? displayPathText(terminalThread.title, Boolean(terminalThread.environment)) : undefined}
        codexContent={projectFocusView === "codex" && selectedRepo ? (
          <ThreadWorkspace repositoryId={selectedRepo.id} id={selection.kind === "codex" ? selection.threadId : undefined}
            thread={terminalThread} theme={activeTheme} terminalOpen={terminalOpen} loading={projectLoading}
            onConfigure={() => setSettingsScope("project")} onHideTerminal={() => setOpenTerminals(current => ({ ...current, [terminalKey]: false }))}
            quickActions={<CodexQuickActions group="git" thread={terminalThread} theme={activeTheme} defaultBranch={selectedRepo.defaultBranch} />} />
        ) : undefined}
        auth={auth}
        repo={selectedRepo}
        selection={projectFocusView === "codex" && selection.kind !== "codex" ? { kind: "repo" } : selection}
        prDetail={prDetail}
        runDetail={runDetail}
        prTab={prTab}
        runTab={runTab}
        repoLabels={repoLabels}
        onPrTabChange={setPrTab}
        onRunTabChange={setRunTab}
        loading={contentLoading}
        error={contentError}
        onPublishRelease={async release => {
          if (!selectedRepo || !release.databaseId) throw new Error("Release ID is required.");
          const published = await api.publishRelease({ repo: selectedRepo, releaseId: release.databaseId });
          setSelection(current => current.kind === "release" && current.release.id === published.id
            ? { kind: "release", release: published } : current);
          return published;
        }}
        prActionSubmitting={prActionSubmitting}
        theme={activeTheme}
        onOpenGithubUrl={openGithubUrl}
        onOpenWorkflowRunFromCheck={openWorkflowRunFromCheck}
        onCopyText={copyToClipboard}
        onSubmitPullRequestReview={submitPullRequestReview}
        onAddPullRequestComment={addPullRequestComment}
        onUpdatePullRequestTitle={updatePullRequestTitle}
        onUpdatePullRequestDraftState={updatePullRequestDraftState}
        onAddPullRequestLabel={addPullRequestLabel}
        onRemovePullRequestLabel={removePullRequestLabel}
        onEnablePullRequestAutoMerge={enablePullRequestAutoMerge}
        onDisablePullRequestAutoMerge={disablePullRequestAutoMerge}
        onMergePullRequest={mergePullRequest}
        onClosePullRequest={closePullRequest}
        onSelectRun={selectRun}
        onRunWorkflow={runWorkflow}
        onRunWorkflowWithArguments={runWorkflowWithArguments}
        workflowRuns={workflowRuns}
      />
      {overlays}
    </DetachablePane>
  );

  if (authChecking || !auth?.configured) {
    return (
      <div
        className={cx("app-shell", "auth-screen")}
        data-theme={activeTheme}
        data-sidebar-appearance={sidebarAppearance}
        onMouseDownCapture={preventTitlebarPointerControlFocus}
        onClickCapture={clearPointerActivatedControlFocus}
        style={authScreenStyle}
      >
        {authChecking ? (
          <EmptyPane icon={<Loader2 className="spin" size={24} />} title="Checking GitHub sign-in" />
        ) : (
          <GitHubSignInGate
            auth={auth}
            error={authError}
            busy={githubSigningIn}
            onSignIn={() => void signInGithub()}
            onCancel={() => void api.cancelGithubSignIn().catch(error => setAuthError(userFacingError(error, "Unable to cancel sign-in.")))}
          />
        )}
      </div>
    );
  }

  return (
    <div
      className={cx(
        "app-shell",
        "workspace-shell",
        layoutAnimating && "layout-animating",
        middleKeyboardNavigating && "middle-keyboard-navigating"
      )}
      data-theme={activeTheme}
      data-sidebar-appearance={sidebarAppearance}
      onMouseDownCapture={(event) => {
        setMiddleKeyboardNavigating(false);
        preventTitlebarPointerControlFocus(event);
      }}
      onPointerMove={() => setMiddleKeyboardNavigating(false)}
      onClickCapture={clearPointerActivatedControlFocus}
      style={appStyle}
    >
      <div className="workspace-body-divider" aria-hidden="true" />
      <Sidebar
        chatActive={chatMode}
        chatSidebarRef={setChatSidebarHost}
        onBuild={() => setChatMode(false)}
        onChat={() => { setChatOpened(true); setChatMode(true); setSettingsScope(null); }}
        globalConfiguration={<button className="icon-button" aria-label="Global configuration" title="Global configuration" onClick={() => setSettingsScope("global")}>
            <Settings size={17} />
          </button>}
        themeControl={<div className="theme-accent-control">
            <button
              className="theme-toggle-button"
              aria-label={`Current theme: ${themePreferenceLabel(themePreference, systemTheme)}. Switch to ${themePreferenceLabel(nextThemePreference(themePreference), systemTheme)} theme.`}
              onClick={toggleThemePreference}
            >
              <ThemePreferenceIcon preference={themePreference} />
            </button>
            <div className="accent-picker" role="group" aria-label="Theme appearance">
              <button
                className={cx("accent-picker-glass-toggle", sidebarAppearance === "glass" && "active")}
                type="button"
                aria-label={`${sidebarAppearance === "glass" ? "Disable" : "Enable"} glass mode for ${activeTheme} theme`}
                aria-pressed={sidebarAppearance === "glass"}
                onClick={(event) => {
                  toggleSidebarAppearance();
                  event.currentTarget.blur();
                }}
              >
                <SwatchBook size={16} />
              </button>
              <div className="accent-swatch-grid" role="radiogroup" aria-label="Accent color">
                {accentColors.map((color, index) => (
                  <button
                    key={color}
                    className={cx("accent-swatch", globalAccent === color && "active")}
                    style={{ "--swatch-color": color } as SwatchCssVars}
                    role="radio"
                    aria-checked={globalAccent === color}
                    aria-label={`Accent ${index + 1}`}
                    onClick={(event) => {
                      setActiveAccentColor(color);
                      event.currentTarget.blur();
                    }}
                  />
                ))}
              </div>
            </div>
          </div>}
        collapsed={sidebarCollapsed}
        favoriteRepos={favoriteRepos}
        repoGroups={repoGroups}
        selectedRepo={selectedRepo}
        search={sidebarSearch}
        onSearch={setSidebarSearch}
        onToggle={() => setSidebarCollapsedWithAnimation(value => !value)}
        onSelectRepo={selectRepo}
        onToggleFavorite={toggleFavorite}
        onReorderFavoriteRepo={reorderFavoriteRepos}
        favoriteKeys={favoriteKeys}
        favoriteMonitorChecking={favoriteProjectMonitorStatus.checking}
        favoriteMonitorLastCheckedAt={favoriteProjectMonitorStatus.lastCheckedAt}
        onRefreshFavorites={() => void refreshFavoriteProjectsForNotifications().catch(error => {
          flash(error instanceof Error ? error.message : "Unable to refresh favorites.");
        })}
        loading={initialLoading}
      />
      <div
        className={cx("resize-handle", "left-resize-handle", sidebarCollapsed && "collapsed")}
        onPointerDown={(event) => {
          if (!sidebarCollapsed) {
            startResize("left", event);
          }
        }}
      />
      {!chatMode && <ProjectPane
        onProjectConfiguration={() => { setSettingsScope("project"); }}
        codexCount={codexThreads.threads.filter((thread) => !thread.archived).length}
        codexList={selectedRepo ? (
          <CodexThreadList
            key={selectedRepo.id}
            repositoryId={selectedRepo.id}
            loading={projectLoading}
            threads={codexThreads.threads}
            selectedId={selection.kind === "codex" ? selection.threadId : undefined}
            onSelect={(threadId) => { setSelection({ kind: "codex", threadId }); focusSelectedItem({ kind: "codex", threadId }); }}
            onConfigure={() => setSettingsScope("project")}
            configurationOpen={settingsScope !== null}
            error={codexThreads.error}
          />
        ) : null}
        repo={selectedRepo}
        sidebarCollapsed={sidebarCollapsed}
        releases={releases}
        releaseTab={releaseTab}
        onReleaseTab={setReleaseTab}
        onSelectRelease={(release) => { setSelection({ kind: "release", release }); focusSelectedItem({ kind: "release", release }); }}
        issues={issues}
        workflowRuns={workflowRuns}
        workflows={workflows}
        starredWorkflows={starredWorkflows}
        starredWorkflowIds={selectedWorkflowStars}
        openPullRequests={openPullRequests}
        closedPullRequests={closedPullRequests}
        focusView={projectFocusView}
        pullRequestTab={projectPullRequestTab}
        workflowTab={projectWorkflowTab}
        loading={projectLoading}
        error={projectError}
        selection={selection}
        onFocusView={(view) => {
          setStoredProjectFocusView(view);
          if (view !== "codex" && selection.kind === "codex") setSelection({ kind: "repo" });
        }}
        onPullRequestTab={setProjectPullRequestTab}
        onWorkflowTab={setProjectWorkflowTab}
        onRefresh={() => void refreshActivePane()}
        onOpenGithubUrl={openGithubUrl}
        onCopyText={copyToClipboard}
        onSelectPr={(pr) => {
          setProjectPullRequestTab(pullRequestTabForState(pr));
          setSelection({ kind: "pr", pr });
          focusSelectedItem({ kind: "pr", pr });
        }}
        onSelectIssue={(issue) => { setSelection({ kind: "issue", issue }); focusSelectedItem({ kind: "issue", issue }); }}
        onSelectRun={(run) => { selectRun(run); focusSelectedItem({ kind: "run", run }); }}
        onSelectWorkflow={(workflow) => { setSelection({ kind: "workflow", workflow }); focusSelectedItem({ kind: "workflow", workflow }); }}
        onToggleWorkflowStar={toggleWorkflowStar}
        onReorderFavoriteWorkflow={reorderFavoriteWorkflows}
      />}
      {!chatMode && !activeDetached && <div className="resize-handle" onPointerDown={(event) => startResize("middle", event)} />}
      {chatOpened && <ChatWorkspace sidebarHost={chatSidebarHost} active={chatMode} theme={activeTheme} accent={selectedAccent} appearance={sidebarAppearance}
        onActivate={() => setChatMode(true)} onDetachedLayout={setChatDetached}
        onResize={event => startResize("middle", event)} sidebarCollapsed={sidebarCollapsed} />}
      <div style={{ display: chatMode ? "none" : "contents" }}>
      {retainedContentItems(activeTarget, [...detachedItems.values()].map(entry => entry.target)).map(target => (
        <ForgeWorkspace key={target.key} item={target} sharedAuth={auth} onAuthChange={setAuth}
          appearance={{ themePreference, theme: activeTheme, sidebarAppearance, accent: projectAccentColor(projectAccentColors, target.repo?.id, globalAccent) }}
          onPaneState={reportItemPane} onNavigateItem={navigateToItem} />
      ))}
      </div>
      {overlays}
    </div>
  );
}

interface SidebarProps {
  chatSidebarRef(node: HTMLDivElement | null): void;
  onBuild(): void;
  chatActive: boolean;
  onChat(): void;
  globalConfiguration: React.ReactNode;
  themeControl: React.ReactNode;
  collapsed: boolean;
  favoriteRepos: RepoSummary[];
  repoGroups: Array<[string, RepoSummary[]]>;
  selectedRepo: RepoSummary | null;
  search: string;
  favoriteKeys: string[];
  favoriteMonitorChecking: boolean;
  favoriteMonitorLastCheckedAt: string | null;
  onRefreshFavorites(): void;
  loading: boolean;
  onSearch(value: string): void;
  onToggle(): void;
  onSelectRepo(repo: RepoSummary): void;
  onToggleFavorite(repo: RepoSummary): void;
  onReorderFavoriteRepo(sourceKey: string, targetKey: string): void;
}

function Sidebar(props: SidebarProps) {
  "use no memo"; // Preserve the live ref handling at this imperative UI boundary.

  const sidebarRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useStoredState<Record<string, boolean>>(
    "github-focus:collapsed-orgs",
    {}
  );
  const [repoTab, setRepoTab] = useStoredState<SidebarRepoTab>("github-focus:sidebar-repo-tab", "favorites");
  const searchActive = props.search.trim().length > 0;
  const allRepoCount = props.repoGroups.reduce((total, [, repos]) => total + repos.length, 0);
  const repoTabsUnderline = useSlidingUnderline(`${props.chatActive}:${repoTab}:${props.favoriteRepos.length}:${allRepoCount}`);
  const modeUnderline = useSlidingUnderline(String(props.chatActive));
  const favoriteMonitorText = props.favoriteMonitorChecking
    ? "Checking favorites"
    : props.favoriteMonitorLastCheckedAt
      ? `Checked ${formatRelative(props.favoriteMonitorLastCheckedAt)}`
      : "Monitoring favorites";

  useEffect(() => {
    const sidebar = sidebarRef.current;
    if (!sidebar) {
      return;
    }
    if (props.collapsed) {
      sidebar.setAttribute("inert", "");
    } else {
      sidebar.removeAttribute("inert");
    }
  }, [props.collapsed]);

  return (
    <aside className={cx("sidebar", props.collapsed && "sidebar-collapsed")}>
      <div className="sidebar-rail" role="toolbar" aria-label="Global controls" aria-orientation="vertical">
        <button className="icon-button" aria-label={props.collapsed ? "Open sidebar" : "Collapse sidebar"} title={props.collapsed ? "Open sidebar" : "Collapse sidebar"} aria-expanded={!props.collapsed} onClick={props.onToggle}>
          {props.collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
        </button>
        {props.themeControl}
        <div className="sidebar-rail-spacer" />
        {props.globalConfiguration}
      </div>
      <div ref={sidebarRef} className="sidebar-navigation" tabIndex={props.collapsed ? -1 : 0} aria-hidden={props.collapsed}>
      <div className="pane-header app-drag">
        <div className="header-actions">
          <div ref={modeUnderline.containerRef} className="project-view-switcher workspace-mode-selector" role="toolbar" aria-label="Workspace mode">
            <button className={cx("icon-button project-view-button", !props.chatActive && "active")} data-active-tab={!props.chatActive ? "true" : undefined} aria-label="Build" title="Build" aria-pressed={!props.chatActive} onClick={props.onBuild}><Code2 size={15} /></button>
            <button className={cx("icon-button project-view-button chatgpt-nav-button", props.chatActive && "active")} data-active-tab={props.chatActive ? "true" : undefined} aria-label="Chat" title="Chat" aria-pressed={props.chatActive} onClick={props.onChat}><MessageSquare size={15} /></button>
            <span className="sliding-tab-underline" style={modeUnderline.underlineStyle} aria-hidden="true" />
          </div>
        </div>
      </div>
      <div ref={props.chatSidebarRef} className="chatgpt-sidebar-host" style={{ display: props.chatActive ? "flex" : "none" }} />
      <div className="sidebar-build-view" style={{ display: props.chatActive ? "none" : "flex" }}>
      <div ref={repoTabsUnderline.containerRef} className="sidebar-tabs" role="tablist" aria-label="Repository view">
        <button
          className={cx("sidebar-tab", repoTab === "favorites" && "active")}
          data-active-tab={repoTab === "favorites" ? "true" : undefined}
          role="tab"
          aria-selected={repoTab === "favorites"}
          onClick={() => {
            setRepoTab("favorites");
            props.onSearch("");
          }}
        >
          <Star size={14} />
          Favorites
          <span>{props.favoriteRepos.length}</span>
        </button>
        <button
          className={cx("sidebar-tab", repoTab === "all" && "active")}
          data-active-tab={repoTab === "all" ? "true" : undefined}
          role="tab"
          aria-selected={repoTab === "all"}
          onClick={() => setRepoTab("all")}
        >
          <Code2 size={14} />
          All
          <span>{allRepoCount}</span>
        </button>
        <span className="sliding-tab-underline" style={repoTabsUnderline.underlineStyle} aria-hidden="true" />
      </div>
      <nav className="sidebar-scroll">
        {!searchActive && repoTab === "favorites" ? (
          <RepoSection
            title="Favorites"
            icon={<Star size={15} />}
            repos={props.favoriteRepos}
            emptyText="No favorite repositories."
            selectedRepo={props.selectedRepo}
            favoriteKeys={props.favoriteKeys}
            onSelectRepo={props.onSelectRepo}
            onToggleFavorite={props.onToggleFavorite}
            onReorderFavoriteRepo={props.onReorderFavoriteRepo}
          />
        ) : (
          <>
            <div className="search-box">
              <Search size={16} />
              <input
                ref={searchInputRef}
                value={props.search}
                onChange={(event) => props.onSearch(event.target.value)}
                placeholder="Search"
                aria-label="Search repositories"
              />
              {searchActive && (
                <button
                  className="search-clear-button"
                  type="button"
                  aria-label="Clear search"
                  onClick={() => {
                    props.onSearch("");
                    searchInputRef.current?.focus();
                  }}
                >
                  <X size={14} />
                </button>
              )}
            </div>
            <RepoGroupList
              title={searchActive ? "Results" : "Repositories"}
              repoGroups={props.repoGroups}
              collapsedGroups={collapsedGroups}
              loading={props.loading}
              emptyText={searchActive ? "No matching repositories." : "No repositories."}
              selectedRepo={props.selectedRepo}
              favoriteKeys={props.favoriteKeys}
              onSelectRepo={props.onSelectRepo}
              onToggleFavorite={props.onToggleFavorite}
              onToggleGroup={(owner) =>
                setCollapsedGroups((current) => ({
                  ...current,
                  [owner]: !(current[owner] ?? false)
                }))
              }
            />
          </>
        )}
      </nav>
      {!searchActive && repoTab === "favorites" && props.favoriteRepos.length > 0 && (
        <div className="sidebar-monitor-status" aria-live="polite">
          <button
            className="icon-button sidebar-monitor-refresh"
            aria-label="Refresh favorite repositories"
            title="Refresh favorite repositories"
            disabled={props.favoriteMonitorChecking}
            onClick={props.onRefreshFavorites}
          >
            {props.favoriteMonitorChecking ? <Loader2 className="spin" size={13} /> : <Activity size={13} />}
          </button>
          <span>{favoriteMonitorText}</span>
        </div>
      )}
      </div>
      </div>
    </aside>
  );
}

function RepoGroupList(props: {
  title: string;
  repoGroups: Array<[string, RepoSummary[]]>;
  collapsedGroups: Record<string, boolean>;
  loading: boolean;
  emptyText: string;
  selectedRepo: RepoSummary | null;
  favoriteKeys: string[];
  onSelectRepo(repo: RepoSummary): void;
  onToggleFavorite(repo: RepoSummary): void;
  onToggleGroup(owner: string): void;
}) {
  const repoCount = props.repoGroups.reduce((total, [, repos]) => total + repos.length, 0);

  return (
    <div className="repo-section">
      <div className="section-title">
        <Github size={15} />
        <span>{props.title}</span>
        {props.loading ? <Loader2 className="spin" size={14} /> : <span className="count">{repoCount}</span>}
      </div>
      {props.repoGroups.length ? (
        props.repoGroups.map(([owner, repos]) => {
          const isCollapsed = props.collapsedGroups[owner] ?? false;
          return (
            <div key={owner} className={cx("repo-group", isCollapsed && "collapsed")}>
              <button
                className="repo-group-toggle"
                type="button"
                aria-expanded={!isCollapsed}
                aria-label={`${isCollapsed ? "Expand" : "Collapse"} ${owner} repositories`}
                onClick={() => props.onToggleGroup(owner)}
              >
                {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                <span className="repo-group-name">{owner}</span>
                <span className="repo-group-count">{repos.length}</span>
              </button>
              {!isCollapsed && (
                <div className="repo-group-items">
                  {repos.map((repo) => (
                    <RepoButton
                      key={repo.fullName}
                      repo={repo}
                      selected={props.selectedRepo ? repoKey(repo) === repoKey(props.selectedRepo) : false}
                      favorite={props.favoriteKeys.includes(repoKey(repo))}
                      onSelect={() => props.onSelectRepo(repo)}
                      onToggleFavorite={() => props.onToggleFavorite(repo)}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })
      ) : (
        <div className="empty-row">{props.emptyText}</div>
      )}
    </div>
  );
}

function RepoSection(props: {
  title: string;
  icon: React.ReactNode;
  repos: RepoSummary[];
  emptyText: string;
  selectedRepo: RepoSummary | null;
  favoriteKeys: string[];
  onSelectRepo(repo: RepoSummary): void;
  onToggleFavorite(repo: RepoSummary): void;
  onReorderFavoriteRepo(sourceKey: string, targetKey: string): void;
}) {
  const [draggingRepoKey, setDraggingRepoKey] = useState<string | null>(null);
  const [dragOverRepoKey, setDragOverRepoKey] = useState<string | null>(null);

  const clearDragState = () => {
    setDraggingRepoKey(null);
    setDragOverRepoKey(null);
  };

  return (
    <div className="repo-section">
      <div className="section-title">
        {props.icon}
        <span>{props.title}</span>
        <span className="count">{props.repos.length}</span>
      </div>
      {props.repos.length ? (
        props.repos.map((repo) => {
          const key = repoKey(repo);
          return (
            <RepoButton
              key={repo.fullName}
              repo={repo}
              selected={props.selectedRepo ? key === repoKey(props.selectedRepo) : false}
              favorite={props.favoriteKeys.includes(key)}
              draggable
              dragging={draggingRepoKey === key}
              dragOver={dragOverRepoKey === key && draggingRepoKey !== key}
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", key);
                setDraggingRepoKey(key);
              }}
              onDragOver={(event) => {
                if (!draggingRepoKey || draggingRepoKey === key) {
                  return;
                }
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                setDragOverRepoKey(key);
              }}
              onDrop={(event) => {
                event.preventDefault();
                const sourceKey = draggingRepoKey ?? event.dataTransfer.getData("text/plain");
                clearDragState();
                if (sourceKey && sourceKey !== key) {
                  props.onReorderFavoriteRepo(sourceKey, key);
                }
              }}
              onDragEnd={clearDragState}
              onSelect={() => props.onSelectRepo(repo)}
              onToggleFavorite={() => props.onToggleFavorite(repo)}
              showOwner
            />
          );
        })
      ) : (
        <div className="empty-row">{props.emptyText}</div>
      )}
    </div>
  );
}

function RepoButton(props: {
  repo: RepoSummary;
  selected: boolean;
  favorite: boolean;
  draggable?: boolean;
  dragging?: boolean;
  dragOver?: boolean;
  showOwner?: boolean;
  onDragStart?(event: React.DragEvent<HTMLDivElement>): void;
  onDragOver?(event: React.DragEvent<HTMLDivElement>): void;
  onDrop?(event: React.DragEvent<HTMLDivElement>): void;
  onDragEnd?(): void;
  onSelect(): void;
  onToggleFavorite(): void;
}) {
  const repoLabel = props.showOwner ? (
    <>
      <span className="repo-owner">{props.repo.owner}/</span>
      <span className="repo-short-name">{props.repo.name}</span>
    </>
  ) : (
    <span className="repo-short-name">{props.repo.name}</span>
  );

  return (
    <div
      className={cx(
        "repo-button-wrap",
        props.selected && "selected",
        props.draggable && "draggable",
        props.dragging && "dragging",
        props.dragOver && "drag-over"
      )}
      draggable={props.draggable}
      onDragStart={props.onDragStart}
      onDragOver={props.onDragOver}
      onDrop={props.onDrop}
      onDragEnd={props.onDragEnd}
    >
      <button className="repo-button" onClick={props.onSelect}>
        <span className={cx("repo-name", props.showOwner && "repo-name-with-owner")}>{repoLabel}</span>
        <span className="repo-meta">{formatRelative(props.repo.updatedAt)}</span>
      </button>
      <button
        className="star-button"
        aria-label={props.favorite ? "Remove favorite" : "Add favorite"}
        onClick={props.onToggleFavorite}
      >
        {props.favorite ? <Star size={14} fill="currentColor" /> : <StarOff size={14} />}
      </button>
    </div>
  );
}

function ProjectPane(props: {
  onProjectConfiguration(): void;
  codexList: React.ReactNode;
  codexCount: number;
  repo: RepoSummary | null;
  sidebarCollapsed: boolean;
  releases: ReleaseSummary[];
  releaseTab: ReleaseTab;
  onReleaseTab(tab: ReleaseTab): void;
  onSelectRelease(release: ReleaseSummary): void;
  issues: IssueSummary[];
  workflowRuns: WorkflowRunSummary[];
  workflows: WorkflowSummary[];
  starredWorkflows: WorkflowSummary[];
  starredWorkflowIds: number[];
  openPullRequests: PullRequestSummary[];
  closedPullRequests: PullRequestSummary[];
  focusView: ProjectFocusView;
  pullRequestTab: ProjectPullRequestTab;
  workflowTab: ProjectWorkflowTab;
  loading: boolean;
  error: string | null;
  selection: ContentSelection;
  onFocusView(view: ProjectFocusView): void;
  onPullRequestTab(tab: ProjectPullRequestTab): void;
  onWorkflowTab(tab: ProjectWorkflowTab): void;
  onRefresh(): void;
  onOpenGithubUrl(url: string): void;
  onCopyText(value: string): Promise<boolean>;
  onSelectPr(pr: PullRequestSummary): void;
  onSelectIssue(issue: IssueSummary): void;
  onSelectRun(run: WorkflowRunSummary): void;
  onSelectWorkflow(workflow: WorkflowSummary): void;
  onToggleWorkflowStar(workflow: WorkflowSummary): void;
  onReorderFavoriteWorkflow(sourceId: number, targetId: number): void;
}) {
  const [refreshSequence, setRefreshSequence] = useState(0);

  const refreshProject = () => {
    setRefreshSequence(sequence => sequence + 1);
    props.onRefresh();
  };

  return (
    <section className="project-pane" tabIndex={0}>
      <div className={cx("pane-header", props.sidebarCollapsed && "collapsed-project-header")}>
        <div className="pane-title">
          {props.loading && <Loader2 className="spin" size={14} />}
        </div>
        <div className="header-actions">
          <ProjectFocusToolbar
            disabled={!props.repo}
            view={props.focusView}
            counts={{
              codex: props.codexCount,
              "pull-requests": props.openPullRequests.length,
              "workflow-runs": props.workflowRuns.length,
              releases: releasesForTab(props.releases, "active").length,
              issues: props.issues.length,
              workflows: props.workflows.length
            }}
            onView={props.onFocusView}
            onRefresh={refreshProject}
            refreshSequence={refreshSequence}
          />
          <GithubUrlActionButton
            url={props.repo?.url ?? null}
            ariaLabel="Copy project GitHub URL. Double-click to open in GitHub"
            onCopyText={props.onCopyText}
            onOpenUrl={props.onOpenGithubUrl}
          />
        </div>
      </div>
      {!props.repo ? (
        <EmptyPane icon={<Github size={24} />} title="No repository selected" />
      ) : (
        <div className="project-scroll">
          <div className="project-identity">
            <span className="owner">{props.repo.owner}</span>
            <span className="full-name">{props.repo.fullName}</span>
            <button className="icon-button project-configuration" aria-label="Project configuration" title="Project configuration" onClick={props.onProjectConfiguration} disabled={props.loading}>
              <Settings size={14} />
            </button>
          </div>
          {props.error && (
            <div className="inline-error">
              <AlertCircle size={15} />
              <span>{displayPathText(props.error)}</span>
            </div>
          )}
          {props.focusView === "codex" ? props.codexList : props.focusView === "workflow-runs" ? (
            <WorkflowRunsSection
              runs={props.workflowRuns}
              selected={props.selection}
              onSelect={props.onSelectRun}
            />
          ) : props.focusView === "releases" ? (
            <ReleasesSection releases={props.releases} tab={props.releaseTab} onTab={props.onReleaseTab}
              selectedId={props.selection.kind === "release" ? props.selection.release.id : undefined} onSelect={props.onSelectRelease} />
          ) : props.focusView === "issues" ? (
            <IssuesSection issues={props.issues} selected={props.selection} onSelect={props.onSelectIssue} />
          ) : props.focusView === "workflows" ? (
            <WorkflowFocusSection
              allWorkflows={props.workflows}
              favoriteWorkflows={props.starredWorkflows}
              tab={props.workflowTab}
              starredIds={props.starredWorkflowIds}
              selected={props.selection}
              onTab={props.onWorkflowTab}
              onSelect={props.onSelectWorkflow}
              onToggleStar={props.onToggleWorkflowStar}
              onReorderFavoriteWorkflow={props.onReorderFavoriteWorkflow}
            />
          ) : (
            <PullRequestFocusSection
              openPullRequests={props.openPullRequests}
              closedPullRequests={props.closedPullRequests}
              tab={props.pullRequestTab}
              selected={props.selection}
              onTab={props.onPullRequestTab}
              onSelect={props.onSelectPr}
            />
          )}
        </div>
      )}
    </section>
  );
}

function ProjectFocusToolbar(props: {
  counts: Record<ProjectFocusView, number>;
  disabled: boolean;
  view: ProjectFocusView;
  onView(view: ProjectFocusView): void;
  onRefresh(): void;
  refreshSequence: number;
}) {
  "use no memo"; // Preserve the live ref handling at this imperative UI boundary.

  const toolbarUnderline = useSlidingUnderline(
    `${props.view}:${props.disabled}:${props.counts["pull-requests"]}:${props.counts["workflow-runs"]}:${props.counts.issues}:${props.counts.workflows}:${props.counts.releases}`
  );
  const items: Array<{ view: ProjectFocusView; label: string; shortcut: string; icon: React.ReactNode }> = [
    { view: "codex", label: "Codex", shortcut: "⌘⇧C", icon: <Bot size={15} /> },
    { view: "pull-requests", label: "Pull Requests", shortcut: "⌘⇧P", icon: <GitPullRequest size={15} /> },
    { view: "workflow-runs", label: "Workflow Runs", shortcut: "⌘⇧R", icon: <Activity size={15} /> },
    { view: "issues", label: "Issues", shortcut: "⌘⇧I", icon: <Inbox size={15} /> },
    { view: "releases", label: "Releases", shortcut: "⌘⇧L", icon: <Tag size={15} /> },
    { view: "workflows", label: "Workflows", shortcut: "⌘⇧W", icon: <Workflow size={15} /> }
  ];

  return (
    <div ref={toolbarUnderline.containerRef} className="project-view-switcher" role="toolbar" aria-label="Project focus view">
      {items.map((item) => (
        <button
          key={item.view}
          type="button"
          className={cx("icon-button project-view-button", props.view === item.view && "active")}
          data-active-tab={props.view === item.view ? "true" : undefined}
          aria-label={`${item.label} (${props.counts[item.view]})`}
          title={`${item.label} (${item.shortcut})${props.view === item.view ? ". Click again to refresh (⌘R)" : ""}`}
          aria-pressed={props.view === item.view}
          disabled={props.disabled}
          onClick={() => props.view === item.view ? props.onRefresh() : props.onView(item.view)}
        >
          {item.icon}
        </button>
      ))}
      <span
        key={props.refreshSequence}
        className={cx("sliding-tab-underline", props.refreshSequence > 0 && "project-refresh-underline")}
        style={toolbarUnderline.underlineStyle}
        aria-hidden="true"
      />
    </div>
  );
}

function PullRequestFocusSection(props: {
  openPullRequests: PullRequestSummary[];
  closedPullRequests: PullRequestSummary[];
  tab: ProjectPullRequestTab;
  selected: ContentSelection;
  onTab(tab: ProjectPullRequestTab): void;
  onSelect(pr: PullRequestSummary): void;
}) {
  "use no memo"; // Preserve the live ref handling at this imperative UI boundary.

  const visiblePullRequests = props.tab === "closed" ? props.closedPullRequests : props.openPullRequests;
  const pullRequestTabsUnderline = useSlidingUnderline(
    `${props.tab}:${props.openPullRequests.length}:${props.closedPullRequests.length}`
  );

  return (
    <div className="pull-request-focus">
      <div ref={pullRequestTabsUnderline.containerRef} className="pull-request-tabs" role="tablist" aria-label="Pull request view">
        <button
          className={cx("pull-request-tab", props.tab === "open" && "active")}
          data-active-tab={props.tab === "open" ? "true" : undefined}
          role="tab"
          aria-selected={props.tab === "open"}
          onClick={() => props.onTab("open")}
        >
          <GitPullRequest size={14} />
          Open
          <span>{props.openPullRequests.length}</span>
        </button>
        <button
          className={cx("pull-request-tab", props.tab === "closed" && "active")}
          data-active-tab={props.tab === "closed" ? "true" : undefined}
          role="tab"
          aria-selected={props.tab === "closed"}
          onClick={() => props.onTab("closed")}
        >
          <XCircle size={14} />
          Closed
          <span>{props.closedPullRequests.length}</span>
        </button>
        <span className="sliding-tab-underline" style={pullRequestTabsUnderline.underlineStyle} aria-hidden="true" />
      </div>
      <PullRequestsSection
        title={props.tab === "closed" ? "Closed Pull Requests" : "Open Pull Requests"}
        empty={props.tab === "closed" ? "No closed PRs" : "No open PRs"}
        pullRequests={visiblePullRequests}
        selected={props.selected}
        onSelect={props.onSelect}
      />
    </div>
  );
}

function PullRequestsSection(props: {
  title: string;
  empty: string;
  pullRequests: PullRequestSummary[];
  selected: ContentSelection;
  onSelect(pr: PullRequestSummary): void;
}) {
  return (
    <div className="focus-section">
      <div className="section-title">
        <GitPullRequest size={15} />
        <span>{props.title}</span>
        <span className="count">{props.pullRequests.length}</span>
      </div>
      {props.pullRequests.length ? (
        props.pullRequests.map((pr) => {
          const badge =
            pr.isDraft && pr.state === "OPEN"
              ? "draft"
              : pr.state === "MERGED"
                ? "merged"
                : pr.state === "CLOSED"
                  ? "closed"
                  : pr.reviewDecision ?? pr.mergeable ?? "open";
          const iconStatus = pr.state === "MERGED" ? "merged" : pr.state === "CLOSED" ? "closed" : pr.ciState;

          return (
            <button
              key={pr.id}
              className={cx("focus-row", props.selected.kind === "pr" && props.selected.pr.id === pr.id && "active")}
              onClick={() => props.onSelect(pr)}
            >
              <StatusIcon status={iconStatus} conclusion={pr.state === "OPEN" ? pr.reviewDecision ?? undefined : undefined} />
              <span className="focus-main">
                <span className="focus-title">#{pr.number} {pr.title}</span>
                <span className="focus-meta">{pr.author?.login ?? "unknown"} to {pr.baseRefName}</span>
              </span>
              <span className={cx("state-chip", statusTone(badge))}>
                {badge}
              </span>
            </button>
          );
        })
      ) : (
        <div className="empty-row">{props.empty}</div>
      )}
    </div>
  );
}

function WorkflowRunsSection(props: {
  runs: WorkflowRunSummary[];
  selected: ContentSelection;
  onSelect(run: WorkflowRunSummary): void;
}) {
  return (
    <div className="focus-section">
      <div className="section-title">
        <Activity size={15} />
        <span>Workflow Runs</span>
        <span className="count">{props.runs.length}</span>
      </div>
      {props.runs.length ? (
        props.runs.map((run) => (
          <button
            key={run.id}
            className={cx("focus-row", props.selected.kind === "run" && props.selected.run.id === run.id && "active")}
            onClick={() => props.onSelect(run)}
          >
            <StatusIcon status={run.status} conclusion={run.conclusion} />
            <span className="focus-main">
              <span className="focus-title">{run.displayTitle || run.name || `Run ${run.id}`}</span>
              <span className="focus-meta">{run.branch ?? "branch"} {shortSha(run.commitSha)}</span>
            </span>
            <span className={cx("state-chip", statusTone(run.status, run.conclusion))}>
              {run.conclusion ?? run.status ?? "run"}
            </span>
          </button>
        ))
      ) : (
        <div className="empty-row">No workflow runs</div>
      )}
    </div>
  );
}

function IssuesSection(props: {
  issues: IssueSummary[];
  selected: ContentSelection;
  onSelect(issue: IssueSummary): void;
}) {
  return (
    <div className="focus-section">
      <div className="section-title">
        <Inbox size={15} />
        <span>Issues</span>
        <span className="count">{props.issues.length}</span>
      </div>
      {props.issues.length ? (
        props.issues.map((issue) => (
          <button
            key={issue.id}
            className={cx("focus-row", props.selected.kind === "issue" && props.selected.issue.id === issue.id && "active")}
            onClick={() => props.onSelect(issue)}
          >
            <Circle size={15} />
            <span className="focus-main">
              <span className="focus-title">#{issue.number} {issue.title}</span>
              <span className="focus-meta">{issue.author?.login ?? "unknown"} {formatRelative(issue.updatedAt)}</span>
            </span>
          </button>
        ))
      ) : (
        <div className="empty-row">No open issues</div>
      )}
    </div>
  );
}

function WorkflowFocusSection(props: {
  allWorkflows: WorkflowSummary[];
  favoriteWorkflows: WorkflowSummary[];
  tab: ProjectWorkflowTab;
  starredIds: number[];
  selected: ContentSelection;
  onTab(tab: ProjectWorkflowTab): void;
  onSelect(workflow: WorkflowSummary): void;
  onToggleStar(workflow: WorkflowSummary): void;
  onReorderFavoriteWorkflow(sourceId: number, targetId: number): void;
}) {
  "use no memo"; // Preserve the live ref handling at this imperative UI boundary.

  const visibleWorkflows = props.tab === "favorites" ? props.favoriteWorkflows : props.allWorkflows;
  const workflowTabsUnderline = useSlidingUnderline(
    `${props.tab}:${props.favoriteWorkflows.length}:${props.allWorkflows.length}`
  );

  return (
    <div className="workflow-focus">
      <div ref={workflowTabsUnderline.containerRef} className="workflow-tabs" role="tablist" aria-label="Workflow view">
        <button
          className={cx("workflow-tab", props.tab === "favorites" && "active")}
          data-active-tab={props.tab === "favorites" ? "true" : undefined}
          role="tab"
          aria-selected={props.tab === "favorites"}
          onClick={() => props.onTab("favorites")}
        >
          <Star size={14} />
          Favorites
          <span>{props.favoriteWorkflows.length}</span>
        </button>
        <button
          className={cx("workflow-tab", props.tab === "all" && "active")}
          data-active-tab={props.tab === "all" ? "true" : undefined}
          role="tab"
          aria-selected={props.tab === "all"}
          onClick={() => props.onTab("all")}
        >
          <Workflow size={14} />
          All
          <span>{props.allWorkflows.length}</span>
        </button>
        <span className="sliding-tab-underline" style={workflowTabsUnderline.underlineStyle} aria-hidden="true" />
      </div>
      <WorkflowSection
        title={props.tab === "favorites" ? "Favorite Workflows" : "Workflows"}
        icon={props.tab === "favorites" ? <Star size={15} /> : <Workflow size={15} />}
        workflows={visibleWorkflows}
        starredIds={props.starredIds}
        selected={props.selected}
        onSelect={props.onSelect}
        onToggleStar={props.onToggleStar}
        reorderable={props.tab === "favorites"}
        onReorder={props.onReorderFavoriteWorkflow}
        empty={props.tab === "favorites" ? "No favorite workflows" : "No workflows"}
      />
    </div>
  );
}

function WorkflowSection(props: {
  title: string;
  icon?: React.ReactNode;
  workflows: WorkflowSummary[];
  starredIds: number[];
  selected: ContentSelection;
  empty: string;
  reorderable?: boolean;
  onSelect(workflow: WorkflowSummary): void;
  onToggleStar(workflow: WorkflowSummary): void;
  onReorder?(sourceId: number, targetId: number): void;
}) {
  const [draggingWorkflowId, setDraggingWorkflowId] = useState<number | null>(null);
  const [dragOverWorkflowId, setDragOverWorkflowId] = useState<number | null>(null);

  const clearDragState = () => {
    setDraggingWorkflowId(null);
    setDragOverWorkflowId(null);
  };

  return (
    <div className="focus-section">
      <div className="section-title">
        {props.icon ?? <Workflow size={15} />}
        <span>{props.title}</span>
        <span className="count">{props.workflows.length}</span>
      </div>
      {props.workflows.length ? (
        props.workflows.map((workflow) => (
          <div
            key={workflow.id}
            className={cx(
              "workflow-row",
              props.selected.kind === "workflow" && props.selected.workflow.id === workflow.id && "active",
              props.reorderable && "draggable",
              draggingWorkflowId === workflow.id && "dragging",
              dragOverWorkflowId === workflow.id && draggingWorkflowId !== workflow.id && "drag-over"
            )}
            draggable={props.reorderable}
            onDragStart={(event) => {
              if (!props.reorderable) {
                return;
              }
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData("text/plain", String(workflow.id));
              setDraggingWorkflowId(workflow.id);
            }}
            onDragOver={(event) => {
              if (!props.reorderable || !draggingWorkflowId || draggingWorkflowId === workflow.id) {
                return;
              }
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
              setDragOverWorkflowId(workflow.id);
            }}
            onDrop={(event) => {
              if (!props.reorderable) {
                return;
              }
              event.preventDefault();
              const sourceId = draggingWorkflowId ?? Number(event.dataTransfer.getData("text/plain"));
              clearDragState();
              if (Number.isSafeInteger(sourceId) && sourceId !== workflow.id) {
                props.onReorder?.(sourceId, workflow.id);
              }
            }}
            onDragEnd={clearDragState}
          >
            <button className="workflow-main" onClick={() => props.onSelect(workflow)}>
              <Workflow size={15} />
              <span>
                <span className="focus-title">{workflow.name}</span>
                <span className="focus-meta">{workflow.state}</span>
              </span>
            </button>
            <button className="icon-button small" aria-label="Star workflow" onClick={() => props.onToggleStar(workflow)}>
              {props.starredIds.includes(workflow.id) ? <Star size={14} fill="currentColor" /> : <StarOff size={14} />}
            </button>
          </div>
        ))
      ) : (
        <div className="empty-row">{props.empty}</div>
      )}
    </div>
  );
}

function WorkflowRunSplitButton(props: {
  workflowName: string;
  onRun(): void;
  onRunWithArguments(): void;
}) {
  const [open, setOpen] = useState(false);

  const handleBlur = useCallback((event: React.FocusEvent<HTMLDivElement>) => {
    const nextFocused = event.relatedTarget;
    if (isDomNode(nextFocused) && event.currentTarget.contains(nextFocused)) {
      return;
    }

    setOpen(false);
  }, []);

  const runWithArguments = useCallback(() => {
    setOpen(false);
    props.onRunWithArguments();
  }, [props, window]);

  return (
    <div className={cx("workflow-run-split", open && "open")} onBlur={handleBlur}>
      <button
        type="button"
        className="primary-button workflow-run-button workflow-run-primary"
        aria-label={`Run ${props.workflowName} with defaults`}
        onClick={props.onRun}
      >
        <Play size={15} />
        <span>Run</span>
      </button>
      <button
        type="button"
        className="primary-button workflow-run-button workflow-run-secondary"
        aria-label={`More run options for ${props.workflowName}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <ChevronDown size={15} />
      </button>
      <div className={cx("workflow-run-menu", open && "open")} role="menu" aria-hidden={!open}>
        <button type="button" className="workflow-run-menu-item" role="menuitem" onClick={runWithArguments}>
          <Play size={14} />
          <span>Run with arguments</span>
        </button>
      </div>
    </div>
  );
}

function ContentPane(props: {
  detached: boolean;
  attachmentOpening: boolean;
  onToggleAttachment(): void;
  codexTitle?: string;
  codexContent?: React.ReactNode;
  codexActions?: React.ReactNode;
  auth: AuthStatus | null;
  repo: RepoSummary | null;
  selection: ContentSelection;
  prDetail: PullRequestDetail | null;
  runDetail: WorkflowRunDetail | null;
  prTab: string;
  runTab: string;
  repoLabels: LabelSummary[];
  loading: boolean;
  error: string | null;
  onPublishRelease(release: ReleaseSummary): Promise<ReleaseSummary>;
  prActionSubmitting: boolean;
  theme: ThemeMode;
  workflowRuns: WorkflowRunSummary[];
  onPrTabChange(tab: string): void;
  onRunTabChange(tab: string): void;
  onOpenGithubUrl(url: string): void;
  onOpenWorkflowRunFromCheck(check: CheckSummary): void;
  onCopyText(value: string): Promise<boolean>;
  onSubmitPullRequestReview(pr: PullRequestSummary, event: PullRequestReviewEvent): void;
  onAddPullRequestComment(pr: PullRequestSummary, body: string): Promise<boolean>;
  onUpdatePullRequestTitle(pr: PullRequestSummary, title: string): Promise<boolean>;
  onUpdatePullRequestDraftState(pr: PullRequestSummary, draft: boolean): Promise<boolean>;
  onAddPullRequestLabel(pr: PullRequestSummary, labelName: string): Promise<boolean>;
  onRemovePullRequestLabel(pr: PullRequestSummary, labelName: string): Promise<boolean>;
  onEnablePullRequestAutoMerge(pr: PullRequestSummary): Promise<boolean>;
  onDisablePullRequestAutoMerge(pr: PullRequestSummary): Promise<boolean>;
  onMergePullRequest(pr: PullRequestSummary): Promise<boolean>;
  onClosePullRequest(pr: PullRequestSummary): Promise<boolean>;
  onSelectRun(run: WorkflowRunSummary): void;
  onRunWorkflow(workflow: WorkflowSummary): void;
  onRunWorkflowWithArguments(workflow: WorkflowSummary): void;
}) {
  "use no memo"; // Preserve the existing explicit memoization dependencies in this view.

  useContentAttachmentShortcut(props.onToggleAttachment, !props.attachmentOpening);
  const reviewPr = props.selection.kind === "pr" ? props.prDetail ?? props.selection.pr : null;
  const showTitleAction =
    props.repo && reviewPr && canUpdatePullRequestTitle(props.repo, reviewPr, props.auth?.viewerLogin);
  const showDraftAction =
    props.repo && reviewPr && canUpdatePullRequestDraftState(props.repo, reviewPr, props.auth?.viewerLogin);
  const showLabelActions = props.repo && canUpdatePullRequestLabels(props.repo);
  const showPullRequestManagementActions =
    props.repo && reviewPr && reviewPr.state === "OPEN" && canManagePullRequest(props.repo);
  const showReviewActions =
    props.repo &&
    reviewPr &&
    reviewPr.state === "OPEN" &&
    canSubmitPullRequestReviewForPullRequest(props.repo, reviewPr, props.auth?.viewerLogin);
  const activeReviewEvent =
    props.prDetail && reviewPr
      ? latestViewerPullRequestReviewEvent(props.prDetail.reviews, props.auth?.viewerLogin)
      : null;
  const githubUrl = openUrlForSelection(props.selection, props.repo);
  const prWorkflowState = reviewPr ? pullRequestWorkflowState(reviewPr) : null;
  const repositoryAllowsAutoMerge = props.repo ? repositoryAllowsPullRequestAutoMerge(props.repo) : false;
  const pullRequestIsValidated = reviewPr?.reviewDecision === "APPROVED";
  const canSelectPullRequestAutoMerge = repositoryAllowsAutoMerge && !pullRequestIsValidated;
  const visiblePrWorkflowState =
    pullRequestIsValidated && prWorkflowState === "auto-ready" ? "manual-ready" : prWorkflowState;
  const showPullRequestWorkflowActions = Boolean(
    showDraftAction && showPullRequestManagementActions && prWorkflowState
  );
  const showPullRequestAutoMergeActions = Boolean(
    showPullRequestManagementActions &&
    reviewPr &&
    !pullRequestIsValidated &&
    (repositoryAllowsAutoMerge || reviewPr.autoMergeEnabled)
  );
  const setPullRequestReadiness = useCallback((draft: boolean) => {
    if (!reviewPr) {
      return;
    }
    if (draft === reviewPr.isDraft) {
      return;
    }

    void (async () => {
      if (draft && reviewPr.autoMergeEnabled) {
        const disabled = await props.onDisablePullRequestAutoMerge(reviewPr);
        if (!disabled) {
          return;
        }
      }
      await props.onUpdatePullRequestDraftState(reviewPr, draft);
    })();
  }, [props.onDisablePullRequestAutoMerge, props.onUpdatePullRequestDraftState, reviewPr]);

  const setPullRequestAutoMerge = useCallback((enabled: boolean) => {
    if (!reviewPr) {
      return;
    }
    if (enabled === reviewPr.autoMergeEnabled) {
      return;
    }
    if (enabled && (!repositoryAllowsAutoMerge || pullRequestIsValidated)) {
      return;
    }

    void (async () => {
      if (!enabled) {
        await props.onDisablePullRequestAutoMerge(reviewPr);
        return;
      }

      if (reviewPr.isDraft) {
        const markedReady = await props.onUpdatePullRequestDraftState(reviewPr, false);
        if (!markedReady) {
          return;
        }
      }
      await props.onEnablePullRequestAutoMerge(reviewPr);
    })();
  }, [
    props.onEnablePullRequestAutoMerge,
    props.onDisablePullRequestAutoMerge,
    props.onUpdatePullRequestDraftState,
    pullRequestIsValidated,
    repositoryAllowsAutoMerge,
    reviewPr
  ]);
  const setPullRequestWorkflow = useCallback((state: PullRequestWorkflowState) => {
    if (!reviewPr) {
      return;
    }
    if (state === pullRequestWorkflowState(reviewPr)) {
      return;
    }
    if (state === "auto-ready" && (!repositoryAllowsAutoMerge || pullRequestIsValidated)) {
      return;
    }

    void (async () => {
      if (state === "auto-ready") {
        if (reviewPr.isDraft) {
          const markedReady = await props.onUpdatePullRequestDraftState(reviewPr, false);
          if (!markedReady) {
            return;
          }
        }
        if (!reviewPr.autoMergeEnabled) {
          await props.onEnablePullRequestAutoMerge(reviewPr);
        }
        return;
      }

      if (reviewPr.autoMergeEnabled) {
        const disabled = await props.onDisablePullRequestAutoMerge(reviewPr);
        if (!disabled) {
          return;
        }
      }

      await props.onUpdatePullRequestDraftState(reviewPr, state === "draft");
    })();
  }, [
    props.onEnablePullRequestAutoMerge,
    props.onDisablePullRequestAutoMerge,
    props.onUpdatePullRequestDraftState,
    pullRequestIsValidated,
    repositoryAllowsAutoMerge,
    reviewPr
  ]);

  return (
    <main className="content-pane" tabIndex={0}>
      <div className="content-header app-drag">
        <div className="content-header-left">
          <div className="content-title">
            {props.codexContent ? (
              <span title={props.detached && props.codexTitle ? `Codex - ${props.codexTitle}` : undefined}>
                Codex{props.detached && props.codexTitle ? ` - ${props.codexTitle}` : ""}
              </span>
            ) : <ContentTitle selection={props.selection} repo={props.repo} />}
            {!props.codexContent && (
            <GithubUrlActionButton
              url={githubUrl}
              className="content-title-action"
              ariaLabel="Copy content GitHub URL. Double-click to open in GitHub"
              onCopyText={props.onCopyText}
              onOpenUrl={props.onOpenGithubUrl}
            />
            )}
            {showDraftAction && reviewPr && (
              showPullRequestWorkflowActions && visiblePrWorkflowState ? (
                <PullRequestWorkflowToggle
                  canEnableAutoMerge={canSelectPullRequestAutoMerge}
                  disabled={props.prActionSubmitting}
                  state={visiblePrWorkflowState}
                  onChange={setPullRequestWorkflow}
                />
              ) : (
                <PullRequestReadinessToggle
                  disabled={props.prActionSubmitting}
                  isDraft={reviewPr.isDraft}
                  onChange={setPullRequestReadiness}
                />
              )
            )}
            {!showPullRequestWorkflowActions && showPullRequestAutoMergeActions && reviewPr && (
              <PullRequestAutoMergeToggle
                canEnableAutoMerge={repositoryAllowsAutoMerge}
                disabled={props.prActionSubmitting}
                autoMergeEnabled={reviewPr.autoMergeEnabled}
                onChange={setPullRequestAutoMerge}
              />
            )}
            {showReviewActions && (
              <PullRequestReviewActions
                disabled={false}
                pr={reviewPr}
                activeEvent={activeReviewEvent}
                onSubmitReview={props.onSubmitPullRequestReview}
              />
            )}
            {props.loading && <Loader2 className="spin" size={15} />}
          </div>
        </div>
        <div className="header-actions">
          {props.codexActions}
          <button className="icon-button" aria-label={props.detached ? "Reattach content pane" : "Detach content pane"} title={props.detached ? "Reattach content pane (⌘⇧D)" : "Detach content pane (⌘⇧D)"} aria-keyshortcuts="Meta+Shift+D Control+Shift+D" disabled={props.attachmentOpening} onClick={props.onToggleAttachment}>{props.detached ? <AppWindowMac size={16} /> : <PictureInPicture2 size={16} />}</button>
        </div>
      </div>
      {props.codexContent ? props.codexContent : props.error ? (
        <div className="content-scroll">
          <div className="inline-error large">
            <AlertCircle size={18} />
            <span>{displayPathText(props.error)}</span>
          </div>
        </div>
      ) : !props.repo ? (
        <EmptyPane icon={<Github size={28} />} title="Select a repository" />
      ) : props.selection.kind === "repo" ? (
        <RepoOverview repo={props.repo} />
      ) : props.selection.kind === "pr" ? (
        <PullRequestContent
          detail={props.prDetail}
          fallback={props.selection.pr}
          tab={props.prTab}
          repoLabels={props.repoLabels}
          prActionSubmitting={props.prActionSubmitting}
          canUpdateTitle={Boolean(showTitleAction)}
          canUpdateLabels={Boolean(showLabelActions)}
          canManagePullRequest={Boolean(showPullRequestManagementActions)}
          theme={props.theme}
          workflowRuns={props.workflowRuns}
          onAddComment={props.onAddPullRequestComment}
          onUpdateTitle={props.onUpdatePullRequestTitle}
          onAddLabel={props.onAddPullRequestLabel}
          onRemoveLabel={props.onRemovePullRequestLabel}
          onMergePullRequest={props.onMergePullRequest}
          onClosePullRequest={props.onClosePullRequest}
          onOpenGithubUrl={props.onOpenGithubUrl}
          onOpenWorkflowRunFromCheck={props.onOpenWorkflowRunFromCheck}
          onCopyText={props.onCopyText}
          onTab={props.onPrTabChange}
        />
      ) : props.selection.kind === "release" ? (
        <ReleaseContent key={props.selection.release.id} release={props.selection.release} canPublish={Boolean(props.repo && canManagePullRequest(props.repo))} onPublish={props.onPublishRelease} />
      ) : props.selection.kind === "issue" ? (
        <IssueContent issue={props.selection.issue} />
      ) : props.selection.kind === "run" ? (
        <WorkflowRunContent
          detail={props.runDetail}
          fallback={props.selection.run}
          focusedJobId={props.selection.focusedJobId ?? null}
          repo={props.repo}
          tab={props.runTab}
          onOpenGithubUrl={props.onOpenGithubUrl}
          onCopyText={props.onCopyText}
          onTab={props.onRunTabChange}
        />
      ) : props.selection.kind === "workflow" ? (
        <WorkflowContent
          workflow={props.selection.workflow}
          repo={props.repo}
          workflowRuns={props.workflowRuns}
          onSelectRun={props.onSelectRun}
          onCopyText={props.onCopyText}
          onRun={props.onRunWorkflow}
          onRunWithArguments={props.onRunWorkflowWithArguments}
        />
      ) : null}
    </main>
  );
}

function ThemePreferenceIcon(props: { preference: ThemePreference }) {
  if (props.preference === "system") {
    return <Orbit size={15} />;
  }
  if (props.preference === "light") {
    return <Sun size={15} />;
  }
  return <Moon size={15} />;
}

function ContentTitle(props: { selection: ContentSelection; repo: RepoSummary | null }) {
  if (!props.repo) {
    return <span>Content</span>;
  }

  if (props.selection.kind === "codex") return <span>Codex</span>;
  if (props.selection.kind === "repo") {
    return <span>{props.repo.fullName}</span>;
  }
  if (props.selection.kind === "pr") {
    return <span>PR #{props.selection.pr.number}</span>;
  }
  if (props.selection.kind === "release") return <span>Release {props.selection.release.tagName}</span>;
  if (props.selection.kind === "issue") {
    return <span>Issue #{props.selection.issue.number}</span>;
  }
  if (props.selection.kind === "run") {
    return <span>Run {props.selection.run.id}</span>;
  }
  return <span>{props.selection.workflow.name}</span>;
}

function PullRequestWorkflowToggle(props: {
  canEnableAutoMerge: boolean;
  disabled: boolean;
  state: PullRequestWorkflowState;
  onChange(state: PullRequestWorkflowState): void;
}) {
  const labels: Record<PullRequestWorkflowState, string> = {
    "auto-ready": "Auto-merge and ready pull request. Change workflow",
    "manual-ready": "Manual merge and ready pull request. Change workflow",
    draft: "Draft pull request. Change workflow"
  };

  return (
    <div
      className="titlebar-picker pr-workflow-actions"
      aria-label="Pull request workflow selector"
      onPointerLeave={(event) => blurFocusedElementIn(event.currentTarget)}
    >
      <button
        type="button"
        className="review-action-button titlebar-state-action active"
        aria-label={labels[props.state]}
        aria-haspopup="true"
        aria-pressed={true}
        disabled={props.disabled}
      >
        <PullRequestWorkflowIcon state={props.state} size={17} />
      </button>
      <div className="titlebar-picker-menu pr-workflow-picker" role="group" aria-label="Change pull request workflow">
        {props.canEnableAutoMerge && (
          <button
            type="button"
            className={cx("review-action-button", props.state === "auto-ready" && "active")}
            aria-label="Enable auto-merge and mark pull request ready"
            aria-pressed={props.state === "auto-ready"}
            disabled={props.disabled}
            onClick={() => props.onChange("auto-ready")}
          >
            <CircleCheckBig size={15} />
          </button>
        )}
        <button
          type="button"
          className={cx("review-action-button", props.state === "manual-ready" && "active")}
          aria-label="Disable auto-merge and mark pull request ready"
          aria-pressed={props.state === "manual-ready"}
          disabled={props.disabled}
          onClick={() => props.onChange("manual-ready")}
        >
          <ClockCheck size={15} />
        </button>
        <button
          type="button"
          className={cx("review-action-button", props.state === "draft" && "active")}
          aria-label="Disable auto-merge and convert pull request to draft"
          aria-pressed={props.state === "draft"}
          disabled={props.disabled}
          onClick={() => props.onChange("draft")}
        >
          <Construction size={15} />
        </button>
      </div>
    </div>
  );
}

function PullRequestWorkflowIcon(props: { state: PullRequestWorkflowState; size: number }) {
  if (props.state === "auto-ready") {
    return <CircleCheckBig size={props.size} />;
  }
  if (props.state === "manual-ready") {
    return <ClockCheck size={props.size} />;
  }
  return <Construction size={props.size} />;
}

function PullRequestReadinessToggle(props: {
  disabled: boolean;
  isDraft: boolean;
  onChange(draft: boolean): void;
}) {
  const label = props.isDraft ? "Draft pull request. Change readiness" : "Ready pull request. Change readiness";

  return (
    <div
      className="titlebar-picker pr-state-actions"
      aria-label="Pull request readiness selector"
      onPointerLeave={(event) => blurFocusedElementIn(event.currentTarget)}
    >
      <button
        type="button"
        className="review-action-button titlebar-state-action active"
        aria-label={label}
        aria-haspopup="true"
        aria-pressed={true}
        disabled={props.disabled}
      >
        {props.isDraft ? <Construction size={17} /> : <Check size={17} />}
      </button>
      <div className="titlebar-picker-menu pr-state-picker" role="group" aria-label="Change pull request readiness">
        <button
          type="button"
          className={cx("review-action-button", !props.isDraft && "active")}
          aria-label="Mark pull request ready for review"
          aria-pressed={!props.isDraft}
          disabled={props.disabled}
          onClick={() => props.onChange(false)}
        >
          <Check size={15} />
        </button>
        <button
          type="button"
          className={cx("review-action-button", props.isDraft && "active")}
          aria-label="Convert pull request to draft"
          aria-pressed={props.isDraft}
          disabled={props.disabled}
          onClick={() => props.onChange(true)}
        >
          <Construction size={15} />
        </button>
      </div>
    </div>
  );
}

function PullRequestAutoMergeToggle(props: {
  canEnableAutoMerge: boolean;
  disabled: boolean;
  autoMergeEnabled: boolean;
  onChange(enabled: boolean): void;
}) {
  const label = props.autoMergeEnabled
    ? "Auto-merge enabled. Change auto-merge"
    : "Auto-merge disabled. Change auto-merge";

  return (
    <div
      className="titlebar-picker pr-auto-merge-actions"
      aria-label="Pull request auto-merge selector"
      onPointerLeave={(event) => blurFocusedElementIn(event.currentTarget)}
    >
      <button
        type="button"
        className="review-action-button titlebar-state-action active"
        aria-label={label}
        aria-haspopup="true"
        aria-pressed={true}
        disabled={props.disabled}
      >
        {props.autoMergeEnabled ? <CircleCheckBig size={17} /> : <Clock size={17} />}
      </button>
      <div className="titlebar-picker-menu pr-auto-merge-picker" role="group" aria-label="Change pull request auto-merge">
        {props.canEnableAutoMerge && (
          <button
            type="button"
            className={cx("review-action-button", props.autoMergeEnabled && "active")}
            aria-label="Enable auto-merge when pull request requirements are met"
            aria-pressed={props.autoMergeEnabled}
            disabled={props.disabled}
            onClick={() => props.onChange(true)}
          >
            <CircleCheckBig size={15} />
          </button>
        )}
        <button
          type="button"
          className={cx("review-action-button", !props.autoMergeEnabled && "active")}
          aria-label="Disable auto-merge"
          aria-pressed={!props.autoMergeEnabled}
          disabled={props.disabled}
          onClick={() => props.onChange(false)}
        >
          <Clock size={15} />
        </button>
      </div>
    </div>
  );
}

function PullRequestReviewActions(props: {
  disabled: boolean;
  pr: PullRequestSummary;
  activeEvent: PullRequestReviewEvent | null;
  onSubmitReview(pr: PullRequestSummary, event: PullRequestReviewEvent): void;
}) {
  "use no memo"; // Preserve the existing explicit memoization dependencies in this view.

  const currentEvent: PullRequestReviewEvent = props.activeEvent ?? "APPROVE";
  const submitReview = useCallback(
    (event: PullRequestReviewEvent) => {
      if (props.activeEvent === event) {
        return;
      }
      props.onSubmitReview(props.pr, event);
    },
    [props.activeEvent, props.onSubmitReview, props.pr]
  );
  const currentLabel =
    props.activeEvent === "REQUEST_CHANGES"
      ? "Changes requested. Change review action"
      : props.activeEvent === "APPROVE"
        ? "Approved. Change review action"
        : "Choose review action";

  return (
    <div
      className="titlebar-picker pr-review-actions"
      aria-label="Pull request review action selector"
      onPointerLeave={(event) => blurFocusedElementIn(event.currentTarget)}
    >
      <button
        type="button"
        className={cx("review-action-button", "review-state-button", props.activeEvent && "active")}
        aria-label={currentLabel}
        aria-haspopup="true"
        aria-pressed={Boolean(props.activeEvent)}
        disabled={props.disabled}
        onClick={() => submitReview(currentEvent)}
      >
        {currentEvent === "REQUEST_CHANGES" ? <ThumbsDown size={16} /> : <ThumbsUp size={16} />}
      </button>
      <div className="titlebar-picker-menu review-action-picker" role="group" aria-label="Change pull request review action">
        <button
          type="button"
          className={cx("review-action-button", "approve", props.activeEvent === "APPROVE" && "active")}
          aria-label="Approve pull request"
          aria-pressed={props.activeEvent === "APPROVE"}
          disabled={props.disabled}
          onClick={() => submitReview("APPROVE")}
        >
          <ThumbsUp size={15} />
        </button>
        <button
          type="button"
          className={cx("review-action-button", "request", props.activeEvent === "REQUEST_CHANGES" && "active")}
          aria-label="Request changes"
          aria-pressed={props.activeEvent === "REQUEST_CHANGES"}
          disabled={props.disabled}
          onClick={() => submitReview("REQUEST_CHANGES")}
        >
          <ThumbsDown size={15} />
        </button>
      </div>
    </div>
  );
}

function PullRequestManagementActions(props: {
  disabled: boolean;
  pr: PullRequestSummary;
  onMerge(pr: PullRequestSummary): Promise<boolean>;
  onClose(pr: PullRequestSummary): Promise<boolean>;
}) {
  return (
    <div
      className="pr-management-actions"
      aria-label="Pull request management actions"
      onPointerLeave={(event) => blurFocusedElementIn(event.currentTarget)}
    >
      <button
        type="button"
        className="pr-management-trigger"
        aria-label="Pull request actions"
        aria-haspopup="true"
        disabled={props.disabled}
      >
        <GitPullRequest size={15} />
        <span>PR action</span>
        <ChevronDown size={14} />
      </button>
      <div className="pr-management-menu" role="group" aria-label="Pull request actions">
        <button
          type="button"
          className="pr-management-option"
          aria-label="Merge pull request"
          disabled={props.disabled}
          onClick={() => void props.onMerge(props.pr)}
        >
          <GitPullRequest size={15} />
          <span>Merge</span>
        </button>
        <button
          type="button"
          className="pr-management-option destructive"
          aria-label="Close pull request"
          disabled={props.disabled}
          onClick={() => void props.onClose(props.pr)}
        >
          <XCircle size={15} />
          <span>Close PR</span>
        </button>
      </div>
    </div>
  );
}

export function GitHubSignInGate(props: {
  auth: AuthStatus | null;
  error: string | null;
  busy: boolean;
  onSignIn(): void;
  onCancel(): void;
}) {
  return (
    <div className="token-gate">
      <div className="token-panel">
        <div className="token-heading">
          <div className="token-icon"><Github size={24} /></div>
          <h1>Connect to GitHub</h1>
        </div>
        <p className="token-help">Sign in through your browser to access your repositories and projects.</p>
        <button className="primary-button" type="button" onClick={props.onSignIn} autoFocus
          disabled={props.busy || !props.auth?.encryptionAvailable}>
          {props.busy ? <Loader2 className="spin" size={16} /> : <Github size={16} />}
          {props.busy ? "Waiting for GitHub…" : "Sign in with GitHub"}
        </button>
        {props.busy && <button className="ghost-button" type="button" onClick={props.onCancel}>Cancel sign-in</button>}
        {!props.auth?.encryptionAvailable && <div className="inline-error"><AlertCircle size={15} /><span>Secure storage is unavailable.</span></div>}
        {props.error && <div className="inline-error" role="alert"><AlertCircle size={15} /><span>{displayPathText(props.error)}</span></div>}
      </div>
    </div>
  );
}

function RepoOverview({ repo }: { repo: RepoSummary }) {
  return (
    <div className="content-scroll">
      <div className="repo-overview">
        <div>
          <span className="eyebrow">{repo.owner}</span>
          <h1>{repo.name}</h1>
          {repo.description && <p>{repo.description}</p>}
        </div>
        <div className="stat-grid">
          <div className="stat">
            <span>Default branch</span>
            <strong>{repo.defaultBranch ?? "unknown"}</strong>
          </div>
          <div className="stat">
            <span>Updated</span>
            <strong>{formatRelative(repo.updatedAt) || "unknown"}</strong>
          </div>
          <div className="stat">
            <span>Visibility</span>
            <strong>{repo.isPrivate ? "private" : "public"}</strong>
          </div>
          <div className="stat">
            <span>State</span>
            <strong>{repo.isArchived ? "archived" : "active"}</strong>
          </div>
        </div>
      </div>
    </div>
  );
}

function PullRequestContent(props: {
  detail: PullRequestDetail | null;
  fallback: PullRequestSummary;
  tab: string;
  repoLabels: LabelSummary[];
  prActionSubmitting: boolean;
  canUpdateTitle: boolean;
  canUpdateLabels: boolean;
  canManagePullRequest: boolean;
  theme: ThemeMode;
  workflowRuns: WorkflowRunSummary[];
  onAddComment(pr: PullRequestSummary, body: string): Promise<boolean>;
  onUpdateTitle(pr: PullRequestSummary, title: string): Promise<boolean>;
  onAddLabel(pr: PullRequestSummary, labelName: string): Promise<boolean>;
  onRemoveLabel(pr: PullRequestSummary, labelName: string): Promise<boolean>;
  onMergePullRequest(pr: PullRequestSummary): Promise<boolean>;
  onClosePullRequest(pr: PullRequestSummary): Promise<boolean>;
  onOpenGithubUrl(url: string): void;
  onOpenWorkflowRunFromCheck(check: CheckSummary): void;
  onCopyText(value: string): Promise<boolean>;
  onTab(tab: string): void;
}) {
  "use no memo"; // React Compiler does not yet support this try/finally control flow.

  const detail = props.detail;
  const pr = detail ?? props.fallback;
  const title = detail?.title ?? props.fallback.title;
  const tabs = ["Description", "Comments", "Reviews", "Files", "Commits", "Checks"];
  const branchName = detail?.headRefName ?? props.fallback.headRefName;
  const authorLogin = (detail?.author ?? props.fallback.author)?.login;
  const labels = detail?.labels ?? props.fallback.labels;
  const selectedLabelNames = useMemo(
    () => new Set(labels.map((label) => label.name.toLowerCase())),
    [labels]
  );
  const availableLabels = useMemo(
    () => props.repoLabels.filter((label) => !selectedLabelNames.has(label.name.toLowerCase())),
    [props.repoLabels, selectedLabelNames]
  );
  const [titleEditing, setTitleEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState(title);
  const [commentDraft, setCommentDraft] = useState("");
  const [commentComposerExpanded, setCommentComposerExpanded] = useState(false);
  const [copiedMeta, setCopiedMeta] = useState<"number" | "branch" | "author" | null>(null);
  const copyFeedbackTimer = useRef<number | null>(null);
  const copyFeedbackFrame = useRef<number | null>(null);
  const titleSaveInFlight = useRef(false);

  useEffect(() => {
    if (!titleEditing) {
      setTitleDraft(title);
    }
  }, [title, titleEditing]);

  useEffect(
    () => () => {
      if (copyFeedbackTimer.current) {
        window.clearTimeout(copyFeedbackTimer.current);
      }
      if (copyFeedbackFrame.current) {
        window.cancelAnimationFrame(copyFeedbackFrame.current);
      }
    },
    []
  );

  const copyMeta = useCallback(
    async (value: string, target: "number" | "branch" | "author") => {
      const copied = await props.onCopyText(value);
      if (!copied) {
        return;
      }

      if (copyFeedbackTimer.current) {
        window.clearTimeout(copyFeedbackTimer.current);
      }
      if (copyFeedbackFrame.current) {
        window.cancelAnimationFrame(copyFeedbackFrame.current);
      }

      setCopiedMeta(null);
      copyFeedbackFrame.current = window.requestAnimationFrame(() => {
        setCopiedMeta(target);
        copyFeedbackFrame.current = null;
        copyFeedbackTimer.current = window.setTimeout(() => {
          setCopiedMeta(null);
          copyFeedbackTimer.current = null;
        }, 620);
      });
    },
    [props.onCopyText]
  );

  const startTitleEdit = useCallback(() => {
    setTitleDraft(title);
    setTitleEditing(true);
  }, [title]);

  const cancelTitleEdit = useCallback(() => {
    setTitleDraft(title);
    setTitleEditing(false);
  }, [title]);

  const finishTitleEdit = useCallback(async () => {
    if (props.prActionSubmitting || titleSaveInFlight.current) {
      return;
    }

    const nextTitle = titleDraft.trim();
    if (nextTitle === title) {
      cancelTitleEdit();
      return;
    }

    titleSaveInFlight.current = true;
    try {
      const saved = await props.onUpdateTitle(pr, nextTitle);
      if (saved) {
        setTitleEditing(false);
      }
    } finally {
      titleSaveInFlight.current = false;
    }
  }, [cancelTitleEdit, pr, props.onUpdateTitle, props.prActionSubmitting, title, titleDraft]);

  const submitTitleEdit = useCallback(
    async (event?: React.FormEvent) => {
      event?.preventDefault();
      await finishTitleEdit();
    },
    [finishTitleEdit]
  );

  const handleTitleEditBlur = useCallback(
    (event: React.FocusEvent<HTMLFormElement>) => {
      const nextFocused = event.relatedTarget;
      if (isDomNode(nextFocused) && event.currentTarget.contains(nextFocused)) {
        return;
      }

      void finishTitleEdit();
    },
    [finishTitleEdit]
  );

  const submitComment = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      const body = commentDraft.trim();
      if (!body || props.prActionSubmitting) {
        return;
      }

      const saved = await props.onAddComment(pr, body);
      if (saved) {
        setCommentDraft("");
        setCommentComposerExpanded(false);
      }
    },
    [commentDraft, pr, props]
  );

  const handleCommentComposerBlur = useCallback((event: React.FocusEvent<HTMLFormElement>) => {
    const nextFocused = event.relatedTarget;
    if (isDomNode(nextFocused) && event.currentTarget.contains(nextFocused)) {
      return;
    }

    setCommentComposerExpanded(false);
  }, []);

  const addLabel = useCallback(
    (labelName: string) => {
      if (!labelName) {
        return;
      }

      void props.onAddLabel(pr, labelName);
    },
    [pr, props.onAddLabel]
  );

  const removeLabel = useCallback(
    (labelName: string) => {
      void props.onRemoveLabel(pr, labelName);
    },
    [pr, props.onRemoveLabel]
  );

  return (
    <div className="content-detail-shell">
      <div className="detail-fixed">
        <div className="detail-heading pr-detail-heading">
          <div className="pr-title-stack">
            <div className="pr-eyebrow-row">
              <button
                type="button"
                className={cx("copy-meta-button", copiedMeta === "number" && "copied")}
                aria-label="Copy pull request number"
                onClick={() => copyMeta(String(props.fallback.number), "number")}
              >
                #{props.fallback.number}
              </button>
              {branchName ? (
                <>
                  <span className="eyebrow-separator">·</span>
                  <button
                    type="button"
                    className={cx("copy-meta-button branch", copiedMeta === "branch" && "copied")}
                    aria-label="Copy branch"
                    onClick={() => copyMeta(branchName, "branch")}
                  >
                    {branchName}
                  </button>
                </>
              ) : null}
              {authorLogin ? (
                <>
                  <span className="eyebrow-separator">·</span>
                  <span>by</span>
                  <button
                    type="button"
                    className={cx("copy-meta-button author", copiedMeta === "author" && "copied")}
                    aria-label="Copy author"
                    onClick={() => copyMeta(authorLogin, "author")}
                  >
                    {authorLogin}
                  </button>
                </>
              ) : null}
            </div>
            <div className="pr-title-row">
              {titleEditing ? (
                <form className="pr-title-edit" onSubmit={submitTitleEdit} onBlur={handleTitleEditBlur}>
                  <input
                    className="pr-title-input"
                    value={titleDraft}
                    autoFocus
                    disabled={props.prActionSubmitting}
                    onChange={(event) => setTitleDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") {
                        cancelTitleEdit();
                      }
                    }}
                  />
                  <button
                    type="submit"
                    className="review-action-button pr-title-action"
                    aria-label="Save pull request title"
                    disabled={props.prActionSubmitting || !titleDraft.trim() || titleDraft.trim() === title}
                  >
                    <CheckCircle2 size={15} />
                  </button>
                  <button
                    type="button"
                    className="review-action-button pr-title-action"
                    aria-label="Cancel title edit"
                    disabled={props.prActionSubmitting}
                    onClick={cancelTitleEdit}
                  >
                    <X size={15} />
                  </button>
                </form>
              ) : (
                <>
                  <h1>{title}</h1>
                  {props.canUpdateTitle && (
                    <button
                      type="button"
                      className="review-action-button pr-title-action"
                      aria-label="Edit pull request title"
                      disabled={props.prActionSubmitting}
                      onClick={startTitleEdit}
                    >
                      <Pencil size={15} />
                    </button>
                  )}
                </>
              )}
            </div>
            {(labels.length > 0 || props.canUpdateLabels) && (
              <div className="pr-label-row" aria-label="Pull request labels">
                {labels.map((label) =>
                  props.canUpdateLabels ? (
                    <button
                      type="button"
                      className="label pr-label-chip removable"
                      style={{ borderColor: `#${label.color}` }}
                      key={label.id}
                      aria-label={`Remove ${label.name} label`}
                      onClick={() => removeLabel(label.name)}
                    >
                      <span>{label.name}</span>
                      <X size={12} />
                    </button>
                  ) : (
                    <span className="label pr-label-chip" style={{ borderColor: `#${label.color}` }} key={label.id}>
                      {label.name}
                    </span>
                  )
                )}
                {props.canUpdateLabels && (
                  <PullRequestLabelPicker
                    disabled={availableLabels.length === 0}
                    labels={availableLabels}
                    onSelect={addLabel}
                  />
                )}
              </div>
            )}
          </div>
          {props.canManagePullRequest && pr.state === "OPEN" && (
            <PullRequestManagementActions
              disabled={props.prActionSubmitting}
              pr={pr}
              onMerge={props.onMergePullRequest}
              onClose={props.onClosePullRequest}
            />
          )}
        </div>
        <TabBar tabs={tabs} selected={props.tab} onSelect={props.onTab} />
      </div>
      <div className="detail-body-scroll">
        {!detail ? (
          <Skeleton />
        ) : props.tab === "Description" ? (
          <MarkdownBlock value={detail.body || "No description."} />
        ) : props.tab === "Comments" ? (
          <>
            <form
              className={cx("comment-composer", commentComposerExpanded && "expanded")}
              onSubmit={submitComment}
              onFocus={() => setCommentComposerExpanded(true)}
              onBlur={handleCommentComposerBlur}
            >
              <textarea
                value={commentDraft}
                rows={commentComposerExpanded ? 4 : 1}
                placeholder="Write a comment"
                disabled={props.prActionSubmitting}
                onChange={(event) => setCommentDraft(event.target.value)}
              />
              <div className="comments-action-row" aria-hidden={!commentComposerExpanded}>
                <button
                  type="submit"
                  className="comment-action-button"
                  aria-label="Add pull request comment"
                  tabIndex={commentComposerExpanded ? 0 : -1}
                  disabled={props.prActionSubmitting || !commentDraft.trim()}
                >
                  <MessageSquare size={14} />
                  <span>Add comment</span>
                </button>
              </div>
            </form>
            <StackedList
              empty="No comments"
              items={detail.comments}
              render={(comment) => (
                <ArticleCard key={comment.id} title={comment.author?.login ?? "unknown"} meta={formatRelative(comment.updatedAt ?? comment.createdAt)}>
                  <MarkdownBlock value={comment.body} compact />
                </ArticleCard>
              )}
            />
          </>
        ) : props.tab === "Reviews" ? (
          <StackedList
            empty="No reviews"
            items={detail.reviews}
            render={(review) => (
              <ArticleCard key={review.id} title={review.author?.login ?? "unknown"} meta={formatReviewMeta(review.state, review.submittedAt)}>
                <MarkdownBlock value={review.body || "No review body."} compact />
              </ArticleCard>
            )}
          />
        ) : props.tab === "Files" ? (
          <ChangedFilesDiffList files={detail.files} theme={props.theme} />
        ) : props.tab === "Commits" ? (
          <StackedList
            empty="No commits"
            items={detail.commits}
            render={(commit) => (
              <div className="commit-row" key={commit.oid}>
                <GitBranch size={15} />
                <span>{commit.messageHeadline}</span>
                <CommitActionButton
                  className="commit-link"
                  sha={commit.oid}
                  url={commit.url}
                  onCopyText={props.onCopyText}
                  onOpenUrl={props.onOpenGithubUrl}
                />
              </div>
            )}
          />
        ) : (
          <ChecksList
            checks={detail.checks}
            workflowRuns={props.workflowRuns}
            onOpenWorkflowRun={props.onOpenWorkflowRunFromCheck}
          />
        )}
      </div>
    </div>
  );
}

function PullRequestLabelPicker(props: {
  disabled: boolean;
  labels: LabelSummary[];
  onSelect(labelName: string): void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const filteredLabels = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) {
      return props.labels;
    }

    return props.labels.filter((label) => label.name.toLowerCase().includes(needle));
  }, [props.labels, query]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      return;
    }

    const frame = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    if (props.disabled) {
      setOpen(false);
    }
  }, [props.disabled]);

  const close = useCallback(() => {
    setOpen(false);
  }, []);

  const selectLabel = useCallback(
    (labelName: string) => {
      props.onSelect(labelName);
      close();
    },
    [close, props]
  );

  const handleBlur = useCallback((event: React.FocusEvent<HTMLDivElement>) => {
    const nextFocused = event.relatedTarget;
    if (isDomNode(nextFocused) && event.currentTarget.contains(nextFocused)) {
      return;
    }

    setOpen(false);
  }, []);

  return (
    <div className={cx("label-picker", open && "open")} onBlur={handleBlur}>
      <button
        type="button"
        className="label-picker-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={props.labels.length ? "Add label" : "No labels available"}
        disabled={props.disabled}
        onClick={() => setOpen((value) => !value)}
      >
        <Plus size={13} />
        <span>{props.labels.length ? "Add label" : "No labels"}</span>
        <ChevronDown size={13} />
      </button>
      <div className="label-picker-popover" aria-hidden={!open}>
        <label className="label-picker-search">
          <Search size={13} />
          <input
            ref={inputRef}
            value={query}
            placeholder="Filter labels"
            tabIndex={open ? 0 : -1}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                close();
              }
              if (event.key === "Enter" && filteredLabels.length === 1) {
                event.preventDefault();
                selectLabel(filteredLabels[0].name);
              }
            }}
          />
        </label>
        <div className="label-picker-options" role="listbox" aria-label="Available labels">
          {filteredLabels.length ? (
            filteredLabels.map((label) => (
              <button
                type="button"
                className="label-picker-option"
                role="option"
                aria-selected="false"
                tabIndex={open ? 0 : -1}
                key={label.id}
                onClick={() => selectLabel(label.name)}
              >
                <span className="label-color-dot" style={{ backgroundColor: `#${label.color}` }} />
                <span>{label.name}</span>
              </button>
            ))
          ) : (
            <div className="label-picker-empty">No matching labels</div>
          )}
        </div>
      </div>
    </div>
  );
}

function ChecksList({
  checks,
  workflowRuns,
  onOpenWorkflowRun
}: {
  checks: CheckSummary[];
  workflowRuns: WorkflowRunSummary[];
  onOpenWorkflowRun(check: CheckSummary): void;
}) {
  const groups = useMemo(() => groupChecksByWorkflow(checks, workflowRuns), [checks, workflowRuns]);

  if (!groups.length) {
    return <div className="empty-content">No checks</div>;
  }

  return (
    <div className="checks-list">
      {groups.map((group) => {
        const hasRun = Boolean(group.workflowRunId);
        const hasGithubTarget = isGithubUrl(group.url);

        return (
          <article className="check-card compact" key={group.key}>
            <button
              className="check-header"
              disabled={!hasRun && !hasGithubTarget}
              aria-label={hasRun ? "Open workflow run" : hasGithubTarget ? "Open check in GitHub" : "No workflow run"}
              onClick={() => onOpenWorkflowRun(group.check)}
            >
              {hasRun ? <Workflow size={15} /> : <ExternalLink size={15} />}
              <StatusIcon status={group.status} conclusion={group.conclusion} />
              <span className="check-title">{group.name}</span>
              <span className={cx("state-chip", statusTone(group.status, group.conclusion))}>
                {group.conclusion ?? group.status ?? "check"}
              </span>
            </button>
          </article>
        );
      })}
    </div>
  );
}

function groupChecksByWorkflow(checks: CheckSummary[], workflowRuns: WorkflowRunSummary[]): WorkflowCheckGroup[] {
  const runById = new Map(workflowRuns.map((run) => [run.id, run]));
  const perRun = new Map<string, WorkflowCheckGroup>();

  for (const check of checks) {
    const run = check.workflowRunId ? runById.get(check.workflowRunId) : null;
    const name = run?.name || workflowNameFromCheck(check);
    const runKey = check.workflowRunId ? String(check.workflowRunId) : checkKey(check);
    const key = `${name}:${runKey}`;
    const current = perRun.get(key);
    const checksForGroup = [...(current?.checks ?? []), check];
    perRun.set(key, {
      check: newestCheck([current?.check, check].filter(Boolean) as CheckSummary[]),
      checks: checksForGroup,
      conclusion: run?.conclusion ?? aggregateCheckConclusion(checksForGroup),
      key,
      name,
      recency: Math.max(current?.recency ?? 0, checkRecency(check), runRecency(run)),
      run,
      status: run?.status ?? aggregateCheckStatus(checksForGroup),
      url: run?.url ?? check.url ?? current?.url ?? null,
      workflowRunId: check.workflowRunId ?? current?.workflowRunId ?? null
    });
  }

  const latestByWorkflow = new Map<string, WorkflowCheckGroup>();
  for (const group of perRun.values()) {
    const current = latestByWorkflow.get(group.name);
    if (!current || group.recency >= current.recency) {
      latestByWorkflow.set(group.name, group);
    }
  }

  return [...latestByWorkflow.values()].sort((left, right) => right.recency - left.recency);
}

function workflowNameFromCheck(check: CheckSummary): string {
  const [workflowName] = check.name.split(" / ");
  if (workflowName && workflowName !== check.name) {
    return workflowName.trim();
  }
  if (check.workflowRunId) {
    return `Workflow run ${check.workflowRunId}`;
  }
  return check.name;
}

function newestCheck(checks: CheckSummary[]): CheckSummary {
  return checks.reduce((latest, check) => (checkRecency(check) >= checkRecency(latest) ? check : latest));
}

function checkKey(check: CheckSummary): string {
  return `${check.jobId ?? check.workflowRunId ?? check.checkRunId ?? check.name}:${check.url ?? ""}`;
}

function checkRecency(check: CheckSummary): number {
  return (
    dateValue(check.completedAt)
    || dateValue(check.startedAt)
    || check.jobId
    || check.workflowRunId
    || check.checkRunId
    || 0
  );
}

function runRecency(run?: WorkflowRunSummary | null): number {
  return dateValue(run?.runStartedAt) || dateValue(run?.createdAt) || dateValue(run?.updatedAt) || run?.id || 0;
}

function dateValue(value?: string | null): number {
  if (!value) {
    return 0;
  }

  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function aggregateCheckConclusion(checks: CheckSummary[]): string | null {
  const conclusions = checks.map((check) => check.conclusion).filter(Boolean);
  if (conclusions.some((conclusion) => ["FAILURE", "ERROR", "TIMED_OUT", "ACTION_REQUIRED"].includes(String(conclusion)))) {
    return "failure";
  }
  if (conclusions.some((conclusion) => String(conclusion) === "CANCELLED")) {
    return "cancelled";
  }
  if (conclusions.length && conclusions.every((conclusion) => String(conclusion) === "SKIPPED")) {
    return "skipped";
  }
  if (checks.every((check) => check.status === "SUCCESS" || check.conclusion === "SUCCESS")) {
    return "success";
  }
  return conclusions[0] ?? null;
}

function aggregateCheckStatus(checks: CheckSummary[]): string | null {
  if (checks.some((check) => ["PENDING", "EXPECTED", "IN_PROGRESS", "QUEUED"].includes(String(check.status)))) {
    return "pending";
  }
  if (checks.every((check) => check.status === "SUCCESS" || check.conclusion === "SUCCESS")) {
    return "success";
  }
  return checks[0]?.status ?? null;
}

function ChangedFilesDiffList({ files, theme }: { files: ChangedFileSummary[]; theme: ThemeMode }) {
  const [collapsedFiles, setCollapsedFiles] = useState<Record<string, boolean>>({});
  const filesKey = files.map((file) => `${file.previousPath ?? ""}:${file.path}`).join("\n");
  const diffOptions = useMemo<PatchDiffOptions>(
    () => ({
      diffStyle: "unified",
      diffIndicators: "bars",
      disableFileHeader: true,
      hunkSeparators: "line-info-basic",
      lineDiffType: "word",
      overflow: "wrap",
      theme: {
        dark: "pierre-dark",
        light: "pierre-light"
      },
      themeType: theme
    }),
    [theme]
  );

  useEffect(() => {
    setCollapsedFiles({});
  }, [filesKey]);

  if (!files.length) {
    return <div className="empty-content">No changed files</div>;
  }

  return (
    <div className="changed-files-list">
      {files.map((file) => {
        const fileKey = `${file.previousPath ?? ""}:${file.path}`;
        const collapsed = collapsedFiles[fileKey] ?? true;
        return (
          <article className={cx("changed-file-card", collapsed && "collapsed")} key={fileKey}>
            <button
              className="changed-file-header"
              aria-expanded={!collapsed}
              onClick={() =>
                setCollapsedFiles((current) => ({
                  ...current,
                  [fileKey]: !(current[fileKey] ?? true)
                }))
              }
            >
              {collapsed ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
              <FileCode2 size={15} />
              <span className="changed-file-path">
                {file.previousPath ? `${displayPath(file.previousPath)} -> ${displayPath(file.path)}` : displayPath(file.path)}
              </span>
              <span className="changed-file-type">{file.changeType}</span>
              <span className="diff-stat positive">+{file.additions}</span>
              <span className="diff-stat negative">-{file.deletions}</span>
            </button>
            {!collapsed && (
              <div className="changed-file-body">
                {file.patch ? (
                  <Suspense fallback={<div className="diff-loading">Loading diff...</div>}>
                    <PatchDiff className="diff-viewer" patch={file.patch} options={diffOptions} disableWorkerPool />
                  </Suspense>
                ) : (
                  <div className="empty-row">Diff unavailable for this file.</div>
                )}
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}

function ReleaseContent({ release, canPublish, onPublish }: {
  release: ReleaseSummary;
  canPublish: boolean;
  onPublish(release: ReleaseSummary): Promise<ReleaseSummary>;
}) {
  "use no memo"; // React Compiler does not yet support this try/finally control flow.

  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const publish = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setPublishing(true);
    setError(null);
    try {
      await onPublish(release);
    } catch (error) {
      setError(userFacingError(error, "Unable to publish release."));
    } finally {
      inFlight.current = false;
      setPublishing(false);
    }
  };
  return <div className="content-scroll">
    <div className="detail-heading pr-detail-heading"><div>
      <span className="eyebrow">{release.isDraft ? "Draft" : "Published"}{release.isPrerelease ? " · Pre-release" : release.isLatest ? " · Latest" : ""} · {release.tagName}</span>
      <h1>{release.name || release.tagName}</h1>
      <time dateTime={releaseDate(release)}>{new Date(releaseDate(release)).toLocaleString()}</time>
      {release.isDraft && canPublish && <p className="muted-line">{release.isPrerelease ? "Publishes as a pre-release." : "Publishes as the latest release."}</p>}
    </div>
    {release.isDraft && canPublish && Boolean(release.databaseId) && <div
      className="pr-management-actions"
      aria-label="Release management actions"
      onPointerLeave={event => blurFocusedElementIn(event.currentTarget)}
    >
      <button type="button" className="pr-management-trigger" aria-label="Release actions" aria-haspopup="true" disabled={publishing}>
        {publishing ? <Loader2 size={15} className="spin" /> : <Tag size={15} />}
        <span>{publishing ? "Publishing…" : "Release action"}</span>
        <ChevronDown size={14} />
      </button>
      <div className="pr-management-menu" role="group" aria-label="Release actions">
        <button type="button" className="pr-management-option" aria-label="Publish release" disabled={publishing} onClick={() => void publish()}>
          <Tag size={15} />
          <span>Publish release</span>
        </button>
      </div>
    </div>}
    </div>
    {error && <div className="inline-error" role="alert"><AlertCircle size={15} /><span>{error}</span></div>}
    <ArticleCard title="Release notes" meta={formatRelative(releaseDate(release))}>
      <MarkdownBlock value={release.description || "No release notes."} />
    </ArticleCard>
  </div>;
}

function IssueContent({ issue }: { issue: IssueSummary }) {
  return (
    <div className="content-scroll">
      <div className="detail-heading">
        <div>
          <span className="eyebrow">Issue #{issue.number}</span>
          <h1>{issue.title}</h1>
        </div>
        <div className="label-row">
          {issue.labels.map((label) => (
            <span className="label" style={{ borderColor: `#${label.color}` }} key={label.id}>
              {label.name}
            </span>
          ))}
        </div>
      </div>
      <ArticleCard title={issue.author?.login ?? "unknown"} meta={formatRelative(issue.updatedAt)}>
        <p className="muted-line">Issue body loading is intentionally separate from the fast project dashboard path.</p>
      </ArticleCard>
    </div>
  );
}

function WorkflowContent(props: {
  workflow: WorkflowSummary;
  repo: RepoSummary;
  workflowRuns: WorkflowRunSummary[];
  onSelectRun(run: WorkflowRunSummary): void;
  onCopyText(value: string): Promise<boolean>;
  onRun(workflow: WorkflowSummary): void;
  onRunWithArguments(workflow: WorkflowSummary): void;
}) {
  "use no memo"; // Preserve the existing explicit memoization dependencies in this view.

  const [copiedPath, setCopiedPath] = useState(false);
  const copyFeedbackTimer = useRef<number | null>(null);
  const copyFeedbackFrame = useRef<number | null>(null);
  const workflowPath = props.workflow.path;
  const relatedRuns = useMemo(
    () => props.workflowRuns.filter((run) => run.workflowId === props.workflow.id),
    [props.workflow.id, props.workflowRuns]
  );

  useEffect(
    () => () => {
      if (copyFeedbackTimer.current) {
        window.clearTimeout(copyFeedbackTimer.current);
      }
      if (copyFeedbackFrame.current) {
        window.cancelAnimationFrame(copyFeedbackFrame.current);
      }
    },
    []
  );

  const copyWorkflowPath = useCallback(async () => {
    const copied = await props.onCopyText(workflowPath);
    if (!copied) {
      return;
    }

    if (copyFeedbackTimer.current) {
      window.clearTimeout(copyFeedbackTimer.current);
    }
    if (copyFeedbackFrame.current) {
      window.cancelAnimationFrame(copyFeedbackFrame.current);
    }

    setCopiedPath(false);
    copyFeedbackFrame.current = window.requestAnimationFrame(() => {
      setCopiedPath(true);
      copyFeedbackFrame.current = null;
      copyFeedbackTimer.current = window.setTimeout(() => {
        setCopiedPath(false);
        copyFeedbackTimer.current = null;
      }, 620);
    });
  }, [props.onCopyText, workflowPath]);

  return (
    <div className="content-detail-shell">
      <div className="detail-fixed">
        <div className="detail-heading row-heading">
          <div className="pr-title-stack">
            <div className="pr-eyebrow-row detail-eyebrow-row" aria-label="Workflow metadata">
              <span className="detail-eyebrow-value">{props.workflow.state}</span>
              <span className="eyebrow-separator">·</span>
              <button
                type="button"
                className={cx("detail-eyebrow-link path", copiedPath && "copied")}
                aria-label="Copy workflow path"
                onClick={copyWorkflowPath}
              >
                {displayPath(workflowPath)}
              </button>
              <span className="eyebrow-separator">·</span>
              <span className="detail-eyebrow-value ref">{props.repo.defaultBranch ?? "main"}</span>
            </div>
            <h1>{props.workflow.name}</h1>
          </div>
          <WorkflowRunSplitButton
            workflowName={props.workflow.name}
            onRun={() => props.onRun(props.workflow)}
            onRunWithArguments={() => props.onRunWithArguments(props.workflow)}
          />
        </div>
      </div>
      <div className="detail-body-scroll">
        <StackedList
          empty="No runs for this workflow"
          items={relatedRuns}
          render={(run) => (
            <button className="workflow-run-row" key={run.id} onClick={() => props.onSelectRun(run)}>
              <StatusIcon status={run.status} conclusion={run.conclusion} />
              <span className="focus-main">
                <span className="focus-title">{run.displayTitle || run.name || `Run ${run.id}`}</span>
                <span className="focus-meta">{run.branch ?? "branch"} {shortSha(run.commitSha)}</span>
              </span>
              <span className="muted-line">{formatRelative(run.runStartedAt ?? run.createdAt)}</span>
              <span className={cx("state-chip", statusTone(run.status, run.conclusion))}>
                {run.conclusion ?? run.status ?? "run"}
              </span>
            </button>
          )}
        />
      </div>
    </div>
  );
}

function WorkflowRunContent(props: {
  detail: WorkflowRunDetail | null;
  focusedJobId?: number | null;
  fallback: WorkflowRunSummary;
  repo: RepoRef;
  tab: string;
  onOpenGithubUrl(url: string): void;
  onCopyText(value: string): Promise<boolean>;
  onTab(tab: string): void;
}) {
  const run = props.detail ?? props.fallback;
  const tabs = ["Jobs", "Artifacts"];
  const selectedTab = tabs.includes(props.tab) ? props.tab : "Jobs";
  const commitUrl = run.commitSha ? `https://github.com/${props.repo.owner}/${props.repo.name}/commit/${run.commitSha}` : null;
  const startedAt = formatAbsoluteDateTime(run.runStartedAt ?? run.createdAt);
  const duration = formatDuration(run.durationMs) || "running";

  return (
    <div className="content-detail-shell">
      <div className="detail-fixed">
        <div className="detail-heading">
          <div className="pr-title-stack">
            <div className="pr-eyebrow-row detail-eyebrow-row" aria-label="Workflow run metadata">
              <span className="detail-eyebrow-value">{run.event ?? "unknown"}</span>
              <span className="eyebrow-separator">·</span>
              {run.branch ? (
                <ClipboardTextButton
                  className="detail-eyebrow-link branch"
                  ariaLabel="Copy branch or tag"
                  value={run.branch}
                  onCopyText={props.onCopyText}
                >
                  {run.branch}
                </ClipboardTextButton>
              ) : (
                <span className="detail-eyebrow-value branch">unknown</span>
              )}
              <span className="eyebrow-separator">·</span>
              {commitUrl ? (
                <CommitActionButton
                  className="detail-eyebrow-link commit"
                  sha={run.commitSha}
                  url={commitUrl}
                  onCopyText={props.onCopyText}
                  onOpenUrl={props.onOpenGithubUrl}
                />
              ) : (
                <span className="detail-eyebrow-value commit">unknown</span>
              )}
              <span className="eyebrow-separator">·</span>
              <span>by</span>
              <span className="detail-eyebrow-value author">{run.actor?.login ?? "unknown"}</span>
            </div>
            <h1>{workflowRunDisplayName(run)}</h1>
          </div>
          <span className={cx("state-chip large-chip", statusTone(run.status, run.conclusion))}>
            {run.conclusion ?? run.status ?? "run"}
          </span>
        </div>
        <TabBar tabs={tabs} selected={selectedTab} onSelect={props.onTab} />
      </div>
      <div className="detail-body-scroll">
        {selectedTab === "Jobs" ? (
          <WorkflowJobsTab
            duration={duration}
            focusedJobId={props.focusedJobId ?? null}
            jobs={props.detail?.jobs ?? null}
            repo={props.repo}
            startedAt={startedAt || "unknown"}
          />
        ) : !props.detail ? (
          <Skeleton />
        ) : (
          <StackedList
            empty="No artifacts"
            items={props.detail.artifacts}
            render={(artifact) => (
              <div className="file-row" key={artifact.id}>
                <FileText size={15} />
                <span>{artifact.name}</span>
                <span className="muted-line">{artifact.expired ? "expired" : formatRelative(artifact.createdAt)}</span>
              </div>
            )}
          />
        )}
      </div>
    </div>
  );
}

function WorkflowJobsTab({
  duration,
  focusedJobId,
  jobs,
  repo,
  startedAt
}: {
  duration: string;
  focusedJobId?: number | null;
  jobs: WorkflowRunDetail["jobs"] | null;
  repo: RepoRef;
  startedAt: string;
}) {
  return (
    <div className="workflow-jobs-tab">
      <div className="pr-eyebrow-row detail-eyebrow-row workflow-jobs-meta" aria-label="Workflow run timing">
        <span className="detail-eyebrow-value">{startedAt}</span>
        <span className="eyebrow-separator">·</span>
        <span className="detail-eyebrow-value">{duration}</span>
      </div>
      {jobs ? <WorkflowJobsList focusedJobId={focusedJobId} jobs={jobs} repo={repo} /> : <Skeleton />}
    </div>
  );
}

function WorkflowJobsList({
  focusedJobId,
  jobs,
  repo
}: {
  focusedJobId?: number | null;
  jobs: WorkflowRunDetail["jobs"];
  repo: RepoRef;
}) {
  const { document, window } = usePaneSurface();
  const [expandedSteps, setExpandedSteps] = useState<Record<string, boolean>>({});
  const [details, setDetails] = useState<Record<string, WorkflowJobLogLoadState>>({});
  const detailsRef = useRef(details);
  const loadingJobKeys = useRef<Set<string>>(new Set());
  const jobsKey = jobs.map((job) => job.id).join(",");

  useEffect(() => {
    detailsRef.current = details;
  }, [details]);

  const loadJob = useCallback(
    (job: WorkflowRunDetail["jobs"][number], options: { force?: boolean; quiet?: boolean } = {}) => {
      const key = String(job.id);
      const current = detailsRef.current[key];
      if (loadingJobKeys.current.has(key) || current?.loading || (!options.force && current?.detail)) {
        return;
      }

      loadingJobKeys.current.add(key);
      setDetails((current) => ({
        ...current,
        [key]: {
          loading: !options.quiet && !current[key]?.detail,
          refreshing: Boolean(options.quiet && current[key]?.detail),
          error: null,
          detail: current[key]?.detail ?? null
        }
      }));
      void api
        .getWorkflowJob(repo, job.id)
        .then((response) => {
          setDetails((current) => ({
            ...current,
            [key]: { loading: false, refreshing: false, detail: response.data, error: null }
          }));
        })
        .catch((error) => {
          setDetails((current) => ({
            ...current,
            [key]: {
              loading: false,
              refreshing: false,
              detail: current[key]?.detail ?? null,
              error: error instanceof Error ? error.message : "Unable to load workflow job logs."
            }
          }));
        })
        .finally(() => {
          loadingJobKeys.current.delete(key);
        });
    },
    [repo]
  );

  useEffect(() => {
    loadingJobKeys.current.clear();
    detailsRef.current = {};
    setExpandedSteps({});
    setDetails({});
  }, [focusedJobId, jobsKey]);

  useEffect(() => {
    const focusedJob = focusedJobId ? jobs.find((job) => job.id === focusedJobId) : null;
    if (focusedJob) {
      loadJob(focusedJob);
    }
  }, [focusedJobId, jobs, jobsKey, loadJob]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (!canPollGithub(document.visibilityState, navigator.onLine !== false)) {
        return;
      }
      for (const job of jobs) {
        const key = String(job.id);
        const hasExpandedStep = Object.keys(expandedSteps).some((stepKey) => stepKey.startsWith(`${key}:`) && expandedSteps[stepKey]);
        const detail = detailsRef.current[key]?.detail;
        if (hasExpandedStep && detail && isLiveStatus(detail.status)) {
          loadJob(job, { force: true, quiet: true });
        }
      }
    }, 6000);

    return () => window.clearInterval(interval);
  }, [expandedSteps, jobs, loadJob, document, window]);

  if (!jobs.length) {
    return <div className="empty-content">No jobs</div>;
  }

  return (
    <div className="stacked-list">
      {jobs.map((job) => {
        const key = String(job.id);
        const state = details[key];
        const logDetail = state?.detail;
        const steps = logDetail?.steps.length ? logDetail.steps : job.steps;
        const unavailableReason = logDetail?.logUnavailableReason;

        return (
          <ArticleCard key={job.id} title={job.name}>
            {unavailableReason ? (
              <div className="log-pending">
                {isLiveStatus(logDetail?.status) ? <Loader2 className="spin" size={14} /> : <AlertCircle size={14} />}
                <span>{unavailableReason}</span>
              </div>
            ) : null}
            {steps.length ? (
              <div className="job-steps-list">
                {steps.map((step, index) => {
                  const stepKey = `${key}:${step.number ?? index}:${step.name}`;
                  const expanded = expandedSteps[stepKey] ?? false;
                  const output = step.log?.trim() || unavailableReason || "No output captured for this step.";

                  return (
                    <div className="job-step" key={stepKey}>
                      <button
                        className="check-row step-log-row"
                        aria-expanded={expanded}
                        onClick={() => {
                          setExpandedSteps((current) => ({
                            ...current,
                            [stepKey]: !(current[stepKey] ?? false)
                          }));
                          if (!expanded) {
                            loadJob(job);
                          }
                        }}
                      >
                        {expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                        <span className="step-status">
                          <StatusIcon status={step.status} conclusion={step.conclusion} />
                          <span>{step.name}</span>
                        </span>
                        <span className={cx("state-chip", statusTone(step.status, step.conclusion))}>
                          {step.conclusion ?? step.status ?? "step"}
                        </span>
                      </button>
                      {expanded ? (
                        state?.loading ? (
                          <div className="diff-loading step-log-body">Loading job logs...</div>
                        ) : state?.error ? (
                          <div className="inline-error step-log-body">
                            <AlertCircle size={15} />
                            <span>{displayPathText(state.error)}</span>
                          </div>
                        ) : logDetail ? (
                          <pre className="terminal-output" aria-label={`${step.name} output`}>
                            {output}
                          </pre>
                        ) : (
                          <div className="empty-row step-log-body">No logs loaded.</div>
                        )
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : logDetail?.rawLog?.trim() ? (
              <pre className="terminal-output standalone" aria-label="Raw job output">
                {logDetail.rawLog.trim()}
              </pre>
            ) : (
              <div className="empty-row">{unavailableReason ?? "No steps found for this job."}</div>
            )}
            {logDetail && !logDetail.steps.some((step) => step.log?.trim()) && logDetail.rawLog?.trim() && steps.length ? (
              <pre className="terminal-output standalone" aria-label="Raw job output">
                {logDetail.rawLog.trim()}
              </pre>
            ) : null}
            {state?.refreshing ? (
              <div className="log-refreshing">
                <Loader2 className="spin" size={13} />
                <span>Checking for logs...</span>
              </div>
            ) : null}
          </ArticleCard>
        );
      })}
    </div>
  );
}

function TabBar(props: { tabs: string[]; selected: string; onSelect(tab: string): void }) {
  "use no memo"; // Preserve the live ref handling at this imperative UI boundary.

  const selected = props.tabs.includes(props.selected) ? props.selected : props.tabs[0] ?? "";
  const tabsUnderline = useSlidingUnderline(`${selected}:${props.tabs.join("|")}`);

  return (
    <div ref={tabsUnderline.containerRef} className="tab-bar">
      {props.tabs.map((tab) => (
        <button
          key={tab}
          className={cx("tab-button", selected === tab && "active")}
          data-active-tab={selected === tab ? "true" : undefined}
          onClick={() => props.onSelect(tab)}
        >
          {tab}
        </button>
      ))}
      <span className="sliding-tab-underline" style={tabsUnderline.underlineStyle} aria-hidden="true" />
    </div>
  );
}

function MarkdownBlock({ value, compact = false }: { value: string; compact?: boolean }) {
  const renderedValue = value.replace(/<!--[\s\S]*?-->/g, "").trim();

  return (
    <div className={cx("markdown-block", compact && "compact")}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer">
              {children}
            </a>
          ),
          input: ({ checked, type }) => (
            <input type={type} checked={checked} readOnly tabIndex={-1} />
          )
        }}
      >
        {renderedValue}
      </ReactMarkdown>
    </div>
  );
}

function ArticleCard(props: { title: string; meta?: string; children: React.ReactNode }) {
  return (
    <article className="article-card">
      <header>
        <strong>{props.title}</strong>
        {props.meta && <span>{props.meta}</span>}
      </header>
      {props.children}
    </article>
  );
}

function StackedList<T>(props: {
  items: T[];
  empty: string;
  render(item: T): React.ReactNode;
}) {
  if (!props.items.length) {
    return <div className="empty-content">{props.empty}</div>;
  }

  return <div className="stacked-list">{props.items.map(props.render)}</div>;
}

function Skeleton() {
  return (
    <div className="skeleton-stack">
      <div />
      <div />
      <div />
    </div>
  );
}

function EmptyPane({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="empty-pane">
      {icon}
      <span>{title}</span>
    </div>
  );
}

function ConfirmationDialog(props: {
  title: string;
  message: string;
  confirmLabel: string;
  submitting: boolean;
  onClose(): void;
  onConfirm(): void;
}) {
  const { window } = usePaneSurface();
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !props.submitting) {
        event.preventDefault();
        props.onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [props, window]);

  const close = () => {
    if (!props.submitting) {
      props.onClose();
    }
  };

  return (
    <div className="palette-backdrop" onMouseDown={close}>
      <div
        className="confirmation-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirmation-dialog-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="confirmation-dialog-copy">
          <h2 id="confirmation-dialog-title">{props.title}</h2>
          <p>{props.message}</p>
        </div>
        <div className="workflow-dispatch-actions">
          <button type="button" className="ghost-button" onClick={close} disabled={props.submitting} autoFocus>
            Cancel
          </button>
          <button type="button" className="ghost-button confirmation-dialog-confirm" onClick={props.onConfirm} disabled={props.submitting}>
            {props.submitting && <Loader2 className="spin" size={14} />}
            <span>{props.confirmLabel}</span>
          </button>
        </div>
      </div>
    </div>
  );
}

function WorkflowDispatchDialog(props: {
  repo: RepoSummary;
  state: WorkflowDispatchDialogState;
  onClose(): void;
  onChangeValue(key: string, value: string): void;
  onSubmit(): void;
}) {
  const { window } = usePaneSurface();
  const firstFieldRef = useRef<HTMLInputElement | HTMLButtonElement | null>(null);
  const setFirstFieldRef = useCallback((element: HTMLInputElement | HTMLButtonElement | null) => {
    firstFieldRef.current = element;
  }, []);

  useEffect(() => {
    if (props.state.loading) {
      return;
    }

    const frame = window.requestAnimationFrame(() => firstFieldRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [props.state.loading]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        props.onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [props, window]);

  const config = props.state.config;
  const inputs = config?.inputs ?? [];

  return (
    <div className="palette-backdrop" onMouseDown={props.onClose}>
      <div className="workflow-dispatch-dialog" onMouseDown={(event) => event.stopPropagation()}>
        <div className="workflow-dispatch-header">
          <div>
            <span className="eyebrow">Run Workflow</span>
            <h2>{props.state.workflow.name}</h2>
            <p className="workflow-dispatch-meta">
              {props.repo.fullName}@{config?.ref ?? props.repo.defaultBranch ?? "main"}
            </p>
          </div>
          <button type="button" className="icon-button" aria-label="Close run workflow dialog" onClick={props.onClose}>
            <X size={16} />
          </button>
        </div>
        {props.state.loading ? (
          <div className="workflow-dispatch-loading">
            <Loader2 className="spin" size={16} />
            <span>Loading workflow inputs…</span>
          </div>
        ) : (
          <>
            {props.state.error && (
              <div className="inline-error">
                <AlertCircle size={15} />
                <span>{displayPathText(props.state.error)}</span>
              </div>
            )}
            <div className="workflow-dispatch-fields">
              {inputs.length ? (
                inputs.map((input, index) => {
                  const value = workflowDispatchInputValue(input, props.state.values);
                  const commonProps = {
                    ref: index === 0 ? setFirstFieldRef : undefined,
                    disabled: props.state.submitting,
                    value
                  };

                  return (
                    <label className="workflow-dispatch-field" key={input.key}>
                      <span className="workflow-dispatch-field-header">
                        <strong>{input.label}</strong>
                        {input.required && <span className="workflow-dispatch-required">Required</span>}
                      </span>
                      {input.description &&
                        (input.type === "choice" || input.type === "environment" || input.type === "boolean") && (
                          <span className="workflow-dispatch-description">{input.description}</span>
                        )}
                      {input.type === "choice" || input.type === "environment" ? (
                        <Combobox
                          label={input.label}
                          triggerRef={index === 0 ? setFirstFieldRef : undefined}
                          disabled={props.state.submitting}
                          value={value}
                          options={[...(!input.required ? [{ value: "", label: "Default" }] : []), ...input.options.map((option) => ({ value: option, label: option }))]}
                          onChange={(selectedValue) => props.onChangeValue(input.key, selectedValue)}
                        />
                      ) : input.type === "boolean" ? (
                        <button
                          type="button"
                          className={cx("workflow-dispatch-boolean", value === "true" && "active")}
                          onClick={() => props.onChangeValue(input.key, value === "true" ? "false" : "true")}
                          disabled={props.state.submitting}
                        >
                          <span>{value === "true" ? "Enabled" : "Disabled"}</span>
                        </button>
                      ) : (
                        <input
                          {...commonProps}
                          type={input.type === "number" ? "number" : "text"}
                          placeholder={input.description ?? input.defaultValue ?? ""}
                          onChange={(event) => props.onChangeValue(input.key, event.target.value)}
                        />
                      )}
                    </label>
                  );
                })
              ) : (
                <div className="empty-content">This workflow does not declare any dispatch inputs.</div>
              )}
            </div>
            <div className="workflow-dispatch-actions">
              <button type="button" className="ghost-button" onClick={props.onClose} disabled={props.state.submitting}>
                Cancel
              </button>
              <button
                type="button"
                className="ghost-button workflow-dispatch-run"
                onClick={props.onSubmit}
                disabled={props.state.submitting}
              >
                {props.state.submitting ? <Loader2 className="spin" size={14} /> : <Play size={14} />}
                <span>Run</span>
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function CommandPalette(props: {
  query: string;
  items: PaletteItem[];
  index: number;
  onQuery(value: string): void;
  onIndex(index: number): void;
  onClose(): void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const runSelected = () => {
    const item = props.items[props.index];
    if (!item) {
      return;
    }
    item.run();
    props.onClose();
  };

  return (
    <div className="palette-backdrop" onMouseDown={props.onClose}>
      <div className="palette" onMouseDown={(event) => event.stopPropagation()}>
        <label className="palette-input">
          <Command size={17} />
          <input
            ref={inputRef}
            value={props.query}
            onChange={(event) => {
              props.onQuery(event.target.value);
              props.onIndex(0);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                props.onClose();
              }
              if (event.key === "ArrowDown") {
                event.preventDefault();
                props.onIndex((props.index + 1) % Math.max(props.items.length, 1));
              }
              if (event.key === "ArrowUp") {
                event.preventDefault();
                props.onIndex((props.index - 1 + Math.max(props.items.length, 1)) % Math.max(props.items.length, 1));
              }
              if (event.key === "Enter") {
                event.preventDefault();
                runSelected();
              }
            }}
            placeholder="Command"
          />
        </label>
        <div className="palette-results">
          {props.items.length ? (
            props.items.map((item, index) => (
              <button
                key={item.id}
                className={cx("palette-row", index === props.index && "active")}
                onMouseEnter={() => props.onIndex(index)}
                onClick={() => {
                  item.run();
                  props.onClose();
                }}
              >
                <IconForPalette kind={item.kind} />
                <span>
                  <strong>{item.title}</strong>
                  {item.subtitle && <small>{item.subtitle}</small>}
                </span>
              </button>
            ))
          ) : (
            <div className="empty-content">No results</div>
          )}
        </div>
      </div>
    </div>
  );
}

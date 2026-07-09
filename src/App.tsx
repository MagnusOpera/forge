import {
  Activity,
  AlertCircle,
  ArrowLeft,
  ArrowRight,
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
  ExternalLink,
  FileCode2,
  FileText,
  GitBranch,
  Github,
  GitPullRequest,
  Inbox,
  KeyRound,
  Loader2,
  Moon,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Search,
  Star,
  StarOff,
  Sun,
  ThumbsDown,
  ThumbsUp,
  Workflow,
  X,
  XCircle
} from "lucide-react";
import type { PatchDiffProps } from "@pierre/diffs/react";
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import {
  addPullRequestLabelOptimistically,
  canManagePullRequest,
  canSubmitPullRequestReviewForPullRequest,
  canUpdatePullRequestDraftState,
  canUpdatePullRequestLabels,
  canUpdatePullRequestTitle,
  formatDuration,
  isLiveStatus,
  latestViewerPullRequestReviewEvent,
  mergeFavoriteRepoSnapshots,
  pullRequestTabForState,
  removePullRequestLabelOptimistically,
  reviewDecisionForReviewEvent,
  shortSha,
  statusTone,
  type FavoriteRepoSnapshots,
  type ProjectPullRequestTab
} from "./appLogic";
import { CLASSIC_TOKEN_SETTINGS_URL } from "../shared/auth";
import { userFacingError } from "../shared/errors";
import type {
  AuthStatus,
  CheckSummary,
  ChangedFileSummary,
  GithubFocusApi,
  IssueSummary,
  LabelSummary,
  OrganizationSummary,
  PullRequestDetail,
  PullRequestReview,
  PullRequestReviewEvent,
  PullRequestSummary,
  RepoRef,
  RepoSummary,
  WorkflowJobLogDetail,
  WorkflowRunDetail,
  WorkflowRunSummary,
  WorkflowSummary
} from "../shared/github";

const PatchDiff = lazy(async () => {
  const module = await import("@pierre/diffs/react");
  return { default: module.PatchDiff };
});

type ContentSelection =
  | { kind: "repo" }
  | { kind: "pr"; pr: PullRequestSummary }
  | { kind: "issue"; issue: IssueSummary }
  | { kind: "run"; run: WorkflowRunSummary; focusedJobId?: number | null }
  | { kind: "workflow"; workflow: WorkflowSummary };

type MiddleItem =
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
type SidebarRepoTab = "favorites" | "all";
type ProjectFocusView = "pull-requests" | "workflow-runs" | "issues" | "workflows";
type StoredProjectFocusView = ProjectFocusView | "starred-actions";
type ProjectWorkflowTab = "favorites" | "all";
type PatchDiffOptions = NonNullable<PatchDiffProps<unknown>["options"]>;
type NavigationEntry = {
  focusView: ProjectFocusView;
  pullRequestTab: ProjectPullRequestTab;
  repo: RepoSummary | null;
  selection: ContentSelection;
  workflowTab: ProjectWorkflowTab;
};
type NavigationState = {
  entries: NavigationEntry[];
  index: number;
};
type ProjectSnapshot = {
  repo: RepoSummary;
  labels: LabelSummary[];
  pullRequests: PullRequestSummary[];
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

const accentColors = [
  "#7ee787",
  "#79c0ff",
  "#a5d6ff",
  "#d2a8ff",
  "#ffa7c4",
  "#ffa198",
  "#f2cc60"
] as const;
const defaultAccentByTheme: Record<ThemeMode, AccentColor> = {
  dark: accentColors[0],
  light: accentColors[1]
};
type AccentColor = (typeof accentColors)[number];
type AppCssVars = React.CSSProperties & Record<"--accent", string>;
type SwatchCssVars = React.CSSProperties & Record<"--swatch-color", string>;
type SlidingUnderlineVars = React.CSSProperties & Record<"--tab-underline-left" | "--tab-underline-width", string>;

function ipcUnavailable<T>(): Promise<T> {
  return Promise.reject(new Error("GitHub IPC is available only inside the Electron app."));
}

const browserApi: GithubFocusApi = {
  platform: "browser",
  getAuthStatus: async () => ({ configured: false, encryptionAvailable: false, viewerLogin: null }),
  saveToken: () => ipcUnavailable(),
  clearToken: () => ipcUnavailable(),
  getRepositories: () => ipcUnavailable(),
  getStarredRepos: () => ipcUnavailable(),
  getRecentRepos: () => ipcUnavailable(),
  getOrganizations: () => ipcUnavailable(),
  getRepo: () => ipcUnavailable(),
  getRepoLabels: () => ipcUnavailable(),
  getPullRequests: () => ipcUnavailable(),
  getIssues: () => ipcUnavailable(),
  getWorkflows: () => ipcUnavailable(),
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
  onCacheUpdated: () => () => undefined
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

function normalizeAccentColor(value: string, fallback: string): string {
  return accentColors.includes(value as AccentColor) ? value : fallback;
}

function useSlidingUnderline(layoutKey: string) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [underlineStyle, setUnderlineStyle] = useState<SlidingUnderlineVars>({
    "--tab-underline-left": "0px",
    "--tab-underline-width": "0px"
  });

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return undefined;
    }

    let frame: number | null = null;
    const update = () => {
      if (frame) {
        window.cancelAnimationFrame(frame);
      }

      frame = window.requestAnimationFrame(() => {
        const active = container.querySelector<HTMLElement>('[data-active-tab="true"]');
        frame = null;
        setUnderlineStyle({
          "--tab-underline-left": active ? `${active.offsetLeft}px` : "0px",
          "--tab-underline-width": active ? `${active.offsetWidth}px` : "0px"
        });
      });
    };

    update();
    const active = container.querySelector<HTMLElement>('[data-active-tab="true"]');
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(container);
    if (active) {
      observer?.observe(active);
    }
    window.addEventListener("resize", update);

    return () => {
      if (frame) {
        window.cancelAnimationFrame(frame);
      }
      observer?.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [layoutKey]);

  return { containerRef, underlineStyle };
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
  if (selection.kind === "pr") {
    return `pr:${selection.pr.number}`;
  }
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
  const activeElement = document.activeElement;
  if (activeElement instanceof HTMLElement && container.contains(activeElement)) {
    activeElement.blur();
  }
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  const tagName = target.tagName.toLowerCase();
  return tagName === "input" || tagName === "textarea" || target.isContentEditable;
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

  if (selection.kind === "repo") {
    return repo.url;
  }
  if (selection.kind === "pr") {
    return selection.pr.url;
  }
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

export function App() {
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [tokenDraft, setTokenDraft] = useState("");
  const [authError, setAuthError] = useState<string | null>(null);
  const [initialLoading, setInitialLoading] = useState(false);
  const [projectLoading, setProjectLoading] = useState(false);
  const [projectError, setProjectError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const [repositories, setRepositories] = useState<RepoSummary[]>([]);
  const [starredRepos, setStarredRepos] = useState<RepoSummary[]>([]);
  const [recentRepos, setRecentRepos] = useState<RepoSummary[]>([]);
  const [organizations, setOrganizations] = useState<OrganizationSummary[]>([]);
  const [selectedRepo, setSelectedRepo] = useState<RepoSummary | null>(null);
  const [repoLabels, setRepoLabels] = useState<LabelSummary[]>([]);
  const [pullRequests, setPullRequests] = useState<PullRequestSummary[]>([]);
  const [issues, setIssues] = useState<IssueSummary[]>([]);
  const [workflowRuns, setWorkflowRuns] = useState<WorkflowRunSummary[]>([]);
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);

  const [selection, setSelection] = useState<ContentSelection>({ kind: "repo" });
  const [prDetail, setPrDetail] = useState<PullRequestDetail | null>(null);
  const [runDetail, setRunDetail] = useState<WorkflowRunDetail | null>(null);
  const [contentLoading, setContentLoading] = useState(false);
  const [contentError, setContentError] = useState<string | null>(null);
  const [prActionSubmitting, setPrActionSubmitting] = useState(false);
  const [prTab, setPrTab] = useState("Description");
  const [runTab, setRunTab] = useState("Summary");

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
  const [theme, setTheme] = useStoredState<ThemeMode>("github-focus:theme", "dark");
  const legacyAccentColor = useMemo(() => readStoredAccentColor("github-focus:accent-color"), []);
  const [darkAccentColor, setDarkAccentColor] = useStoredState<string>(
    "github-focus:accent-color:dark",
    theme === "dark" ? legacyAccentColor ?? defaultAccentByTheme.dark : defaultAccentByTheme.dark
  );
  const [lightAccentColor, setLightAccentColor] = useStoredState<string>(
    "github-focus:accent-color:light",
    theme === "light" ? legacyAccentColor ?? defaultAccentByTheme.light : defaultAccentByTheme.light
  );
  const [leftWidth, setLeftWidth] = useStoredState("github-focus:left-width", 280);
  const [middleWidth, setMiddleWidth] = useStoredState("github-focus:middle-width", 392);
  const [sidebarSearch, setSidebarSearch] = useState("");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState("");
  const [paletteIndex, setPaletteIndex] = useState(0);
  const [navigation, setNavigation] = useState<NavigationState>({ entries: [], index: -1 });
  const [layoutAnimating, setLayoutAnimating] = useState(false);
  const lastGPress = useRef(0);
  const layoutAnimationTimer = useRef<number | null>(null);
  const optimisticMutationSequence = useRef(0);
  const optimisticMutationIds = useRef(new Map<string, number>());
  const restoringNavigation = useRef(false);

  const loadedRepos = useMemo(
    () => uniqueRepos([...(selectedRepo ? [selectedRepo] : []), ...starredRepos, ...recentRepos, ...repositories]),
    [selectedRepo, starredRepos, recentRepos, repositories]
  );

  useEffect(() => {
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

  const selectedRepoKey = selectedRepo ? repoKey(selectedRepo) : "";
  const selectedPullRequestNumber = selection.kind === "pr" ? selection.pr.number : null;
  const selectedWorkflowRunId = selection.kind === "run" ? selection.run.id : null;
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
    storedProjectFocusView === "starred-actions" ? "workflows" : storedProjectFocusView;
  const openPullRequests = useMemo(
    () => pullRequests.filter((pr) => pr.state !== "CLOSED" && pr.state !== "MERGED"),
    [pullRequests]
  );
  const closedPullRequests = useMemo(
    () => pullRequests.filter((pr) => pr.state === "CLOSED" || pr.state === "MERGED"),
    [pullRequests]
  );
  const visiblePullRequests = projectPullRequestTab === "closed" ? closedPullRequests : openPullRequests;

  const visibleRepos = useMemo(() => {
    const needle = sidebarSearch.trim().toLowerCase();
    if (!needle) {
      return allRepos;
    }
    return allRepos.filter((repo) => repo.fullName.toLowerCase().includes(needle));
  }, [allRepos, sidebarSearch]);

  const repoGroups = useMemo(() => {
    const groups = new Map<string, RepoSummary[]>();
    for (const repo of visibleRepos) {
      const list = groups.get(repo.owner) ?? [];
      list.push(repo);
      groups.set(repo.owner, list);
    }
    return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [visibleRepos]);

  const middleItems = useMemo<MiddleItem[]>(() => {
    if (projectFocusView === "workflow-runs") {
      return workflowRuns.map((run) => ({ id: `run:${run.id}`, kind: "run" as const, run }));
    }
    if (projectFocusView === "issues") {
      return issues.map((issue) => ({ id: `issue:${issue.number}`, kind: "issue" as const, issue }));
    }
    if (projectFocusView === "workflows") {
      const visibleWorkflows = projectWorkflowTab === "favorites" ? starredWorkflows : workflows;
      return visibleWorkflows.map((workflow) => ({ id: `workflow:${workflow.id}`, kind: "workflow" as const, workflow }));
    }
    return visiblePullRequests.map((pr) => ({ id: `pr:${pr.number}`, kind: "pr" as const, pr }));
  }, [issues, projectFocusView, projectWorkflowTab, starredWorkflows, visiblePullRequests, workflowRuns, workflows]);

  const currentGithubUrl = openUrlForSelection(selection, selectedRepo);
  const currentNavigationEntry = useMemo<NavigationEntry>(
    () => ({
      focusView: projectFocusView,
      pullRequestTab: projectPullRequestTab,
      repo: selectedRepo,
      selection,
      workflowTab: projectWorkflowTab
    }),
    [projectFocusView, projectPullRequestTab, projectWorkflowTab, selectedRepo, selection]
  );
  const canNavigateBack = navigation.index > 0;
  const canNavigateForward = navigation.index >= 0 && navigation.index < navigation.entries.length - 1;

  const flash = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 2600);
  }, []);

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
      if (theme === "light") {
        setLightAccentColor(color);
      } else {
        setDarkAccentColor(color);
      }
    },
    [setDarkAccentColor, setLightAccentColor, theme]
  );

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
    [auth?.configured, favoriteKeys, localRecentKeys]
  );

  const loadProject = useCallback(
    async (repo: RepoSummary, showSpinner = true, force = false): Promise<ProjectSnapshot | null> => {
      if (showSpinner) {
        setProjectLoading(true);
      }
      setProjectError(null);
      const options = force ? { force: true } : undefined;

      try {
        const [repoDetail, labels, prs, repoIssues, repoWorkflows, runs] = await Promise.all([
          api.getRepo(repo, options),
          api.getRepoLabels(repo, options),
          api.getPullRequests(repo, options),
          api.getIssues(repo, options),
          api.getWorkflows(repo, options),
          api.getWorkflowRuns(repo, options)
        ]);

        const project = {
          repo: repoDetail.data,
          labels: labels.data,
          pullRequests: prs.data,
          issues: repoIssues.data,
          workflows: repoWorkflows.data,
          workflowRuns: runs.data
        };

        setSelectedRepo(project.repo);
        setRepoLabels(project.labels);
        setPullRequests(project.pullRequests);
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
      setSelectedRepo(repo);
      setSelection({ kind: "repo" });
      setRepoLabels([]);
      setPrDetail(null);
      setRunDetail(null);
      setLocalRecentKeys((current) => [repoKey(repo), ...current.filter((key) => key !== repoKey(repo))].slice(0, 20));
    },
    [setLocalRecentKeys]
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

  const runWorkflow = useCallback(
    async (workflow: WorkflowSummary) => {
      if (!selectedRepo) {
        return;
      }

      const ref = selectedRepo.defaultBranch ?? "main";
      const confirmed = window.confirm(`Run "${workflow.name}" on ${selectedRepo.fullName}@${ref}?`);
      if (!confirmed) {
        return;
      }

      try {
        await api.dispatchWorkflow({
          repo: selectedRepo,
          workflowId: workflow.id,
          ref
        });
        flash(`Started ${workflow.name}`);
        void loadProject(selectedRepo, false);
      } catch (error) {
        flash(error instanceof Error ? error.message : "Workflow dispatch failed.");
      }
    },
    [flash, loadProject, selectedRepo]
  );

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
      void api
        .updatePullRequestDraftState({
          repo: selectedRepo,
          pullNumber: pr.number,
          pullRequestId: pr.id,
          draft
        })
        .then(() => {
          if (!isCurrentOptimisticMutation(mutationKey, mutationId)) {
            return;
          }
          void refreshPullRequest(selectedRepo, pr.number).catch((error) => {
            flash(error instanceof Error ? error.message : "Pull request state updated, but refresh failed.");
          });
        })
        .catch((error) => {
          if (isCurrentOptimisticMutation(mutationKey, mutationId)) {
            patchPullRequestOptimistically(pr.number, { isDraft: previousIsDraft });
          }
          flash(error instanceof Error ? error.message : "Unable to update pull request state.");
        })
        .finally(() => {
          finishOptimisticMutation(mutationKey, mutationId);
        });
      return true;
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
      setStoredProjectFocusView("workflow-runs");
      setSelection({ kind: "run", run });
      setRunTab("Summary");
    },
    [setStoredProjectFocusView]
  );

  const selectMiddleItem = useCallback(
    (item: MiddleItem) => {
      if (item.kind === "pr") {
        setProjectPullRequestTab(pullRequestTabForState(item.pr));
        setSelection({ kind: "pr", pr: item.pr });
        setPrTab("Description");
      }
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
      if (entry.selection.kind === "pr") {
        setPrTab("Description");
      }
      if (entry.selection.kind === "run") {
        const restoredRun = entry.selection.run;
        setRunTab("Summary");
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
      setStoredProjectFocusView("workflow-runs");
      setWorkflowRuns((current) => (current.some((item) => item.id === run.id) ? current : [run, ...current]));
      setSelection({ kind: "run", run, focusedJobId: check.jobId ?? null });
      setRunTab("Jobs");
    },
    [selectedRepo, setStoredProjectFocusView, workflowRuns]
  );

  const moveMiddleSelection = useCallback(
    (delta: number) => {
      if (!middleItems.length) {
        return;
      }

      const currentId =
        selection.kind === "pr"
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
    void api.getAuthStatus().then(setAuth);
  }, []);

  useEffect(
    () => () => {
      if (layoutAnimationTimer.current) {
        window.clearTimeout(layoutAnimationTimer.current);
      }
    },
    []
  );

  useEffect(() => {
    if (auth?.configured) {
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
    if (!selectedRepo || selectedPullRequestNumber === null) {
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
    if (!selectedRepo || selectedWorkflowRunId === null) {
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
      if (key.startsWith("viewer:")) {
        void loadInitial(false);
      }
      if (selectedRepo && key.startsWith(`repo:${repoKey(selectedRepo)}`) && !isPullRequestCacheUpdate(key)) {
        void loadProject(selectedRepo, false);
      }
    });
    return unsubscribe;
  }, [loadInitial, loadProject, selectedRepo]);

  useEffect(() => {
    if (paletteIndex >= filteredPaletteItems.length) {
      setPaletteIndex(0);
    }
  }, [filteredPaletteItems.length, paletteIndex]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
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

      if ((event.metaKey || event.ctrlKey) && ["1", "2", "3"].includes(event.key)) {
        event.preventDefault();
        if (event.key === "1" && sidebarCollapsed) {
          setSidebarCollapsedWithAnimation(false);
          return;
        }

        const selector = event.key === "1" ? ".sidebar" : event.key === "2" ? ".project-pane" : ".content-pane";
        (document.querySelector(selector) as HTMLElement | null)?.focus();
        return;
      }

      if (paletteOpen || isTypingTarget(event.target)) {
        return;
      }

      if (event.key === "Escape" && selection.kind !== "repo") {
        setSelection({ kind: "repo" });
        return;
      }

      if (event.key === "j") {
        event.preventDefault();
        moveMiddleSelection(1);
        return;
      }

      if (event.key === "k") {
        event.preventDefault();
        moveMiddleSelection(-1);
        return;
      }

      if (event.key.toLowerCase() === "g") {
        const now = Date.now();
        if (now - lastGPress.current < 650) {
          event.preventDefault();
          openGithub();
          lastGPress.current = 0;
        } else {
          lastGPress.current = now;
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    moveMiddleSelection,
    navigateHistory,
    openGithub,
    paletteOpen,
    selection.kind,
    setSidebarCollapsedWithAnimation,
    sidebarCollapsed
  ]);

  const saveToken = async (event: React.FormEvent) => {
    event.preventDefault();
    setAuthError(null);
    try {
      const nextAuth = await api.saveToken(tokenDraft);
      setTokenDraft("");
      setAuth(nextAuth);
    } catch (error) {
      setAuthError(userFacingError(error, "Unable to store token."));
    }
  };

  const clearStoredToken = async () => {
    const confirmed = window.confirm("Remove the stored GitHub token?");
    if (!confirmed) {
      return;
    }

    const nextAuth = await api.clearToken();
    setAuth(nextAuth);
    setRepositories([]);
    setStarredRepos([]);
    setRecentRepos([]);
    setOrganizations([]);
    setSelectedRepo(null);
    setRepoLabels([]);
    setPullRequests([]);
    setIssues([]);
    setWorkflows([]);
    setWorkflowRuns([]);
    setSelection({ kind: "repo" });
  };

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

  const gridTemplateColumns = sidebarCollapsed
    ? `0px 0px ${middleWidth}px 5px minmax(0, 1fr)`
    : `${leftWidth}px 5px ${middleWidth}px 5px minmax(0, 1fr)`;
  const activeTheme: ThemeMode = theme === "light" ? "light" : "dark";
  const activeAccentColor = activeTheme === "dark" ? darkAccentColor : lightAccentColor;
  const selectedAccent = normalizeAccentColor(activeAccentColor, defaultAccentByTheme[activeTheme]);
  const appStyle: AppCssVars = {
    gridTemplateColumns,
    "--accent": selectedAccent
  };

  return (
    <div className={cx("app-shell", layoutAnimating && "layout-animating")} data-theme={activeTheme} style={appStyle}>
      <Sidebar
        collapsed={sidebarCollapsed}
        favoriteRepos={favoriteRepos}
        repoGroups={repoGroups}
        selectedRepo={selectedRepo}
        search={sidebarSearch}
        onSearch={setSidebarSearch}
        onToggle={() => setSidebarCollapsedWithAnimation(true)}
        onSelectRepo={selectRepo}
        onToggleFavorite={toggleFavorite}
        onReorderFavoriteRepo={reorderFavoriteRepos}
        favoriteKeys={favoriteKeys}
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
      <ProjectPane
        repo={selectedRepo}
        sidebarCollapsed={sidebarCollapsed}
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
        onFocusView={setStoredProjectFocusView}
        onPullRequestTab={setProjectPullRequestTab}
        onWorkflowTab={setProjectWorkflowTab}
        onRefresh={() => void refreshActivePane()}
        onToggleSidebar={() => setSidebarCollapsedWithAnimation(false)}
        onOpenGithub={openGithub}
        onSelectPr={(pr) => {
          setProjectPullRequestTab(pullRequestTabForState(pr));
          setSelection({ kind: "pr", pr });
        }}
        onSelectIssue={(issue) => setSelection({ kind: "issue", issue })}
        onSelectRun={selectRun}
        onSelectWorkflow={(workflow) => setSelection({ kind: "workflow", workflow })}
        onToggleWorkflowStar={toggleWorkflowStar}
        onReorderFavoriteWorkflow={reorderFavoriteWorkflows}
        onRunWorkflow={runWorkflow}
      />
      <div className="resize-handle" onPointerDown={(event) => startResize("middle", event)} />
      <ContentPane
        auth={auth}
        authError={authError}
        tokenDraft={tokenDraft}
        onTokenChange={setTokenDraft}
        onSaveToken={saveToken}
        onOpenTokenSettings={() => void api.openInGitHub(CLASSIC_TOKEN_SETTINGS_URL)}
        onClearToken={clearStoredToken}
        repo={selectedRepo}
        selection={selection}
        prDetail={prDetail}
        runDetail={runDetail}
        prTab={prTab}
        runTab={runTab}
        repoLabels={repoLabels}
        onPrTabChange={setPrTab}
        onRunTabChange={setRunTab}
        loading={contentLoading}
        error={contentError}
        prActionSubmitting={prActionSubmitting}
        theme={activeTheme}
        canNavigateBack={canNavigateBack}
        canNavigateForward={canNavigateForward}
        accentColor={selectedAccent}
        onNavigateBack={() => navigateHistory(-1)}
        onNavigateForward={() => navigateHistory(1)}
        onToggleTheme={() => setTheme(activeTheme === "dark" ? "light" : "dark")}
        onAccentChange={setActiveAccentColor}
        onOpenGithub={openGithub}
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
        workflowRuns={workflowRuns}
      />
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
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

interface SidebarProps {
  collapsed: boolean;
  favoriteRepos: RepoSummary[];
  repoGroups: Array<[string, RepoSummary[]]>;
  selectedRepo: RepoSummary | null;
  search: string;
  favoriteKeys: string[];
  loading: boolean;
  onSearch(value: string): void;
  onToggle(): void;
  onSelectRepo(repo: RepoSummary): void;
  onToggleFavorite(repo: RepoSummary): void;
  onReorderFavoriteRepo(sourceKey: string, targetKey: string): void;
}

function Sidebar(props: SidebarProps) {
  const sidebarRef = useRef<HTMLElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useStoredState<Record<string, boolean>>(
    "github-focus:collapsed-orgs",
    {}
  );
  const [repoTab, setRepoTab] = useStoredState<SidebarRepoTab>("github-focus:sidebar-repo-tab", "favorites");
  const searchActive = props.search.trim().length > 0;
  const allRepoCount = props.repoGroups.reduce((total, [, repos]) => total + repos.length, 0);
  const repoTabsUnderline = useSlidingUnderline(`${repoTab}:${props.favoriteRepos.length}:${allRepoCount}`);

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
    <aside
      ref={sidebarRef}
      className={cx("sidebar", props.collapsed && "sidebar-hidden")}
      tabIndex={props.collapsed ? -1 : 0}
      aria-hidden={props.collapsed}
    >
      <div className="pane-header app-drag">
        <div className="brand-mark">
          <Github size={18} />
          <span>Forge</span>
        </div>
        <button className="icon-button" aria-label="Collapse sidebar" onClick={props.onToggle}>
          <PanelLeftClose size={18} />
        </button>
      </div>
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
      {!searchActive && (
        <div ref={repoTabsUnderline.containerRef} className="sidebar-tabs" role="tablist" aria-label="Repository view">
          <button
            className={cx("sidebar-tab", repoTab === "favorites" && "active")}
            data-active-tab={repoTab === "favorites" ? "true" : undefined}
            role="tab"
            aria-selected={repoTab === "favorites"}
            onClick={() => setRepoTab("favorites")}
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
      )}
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
        )}
      </nav>
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
            <div key={owner} className="repo-group">
              <button className="repo-group-toggle" onClick={() => props.onToggleGroup(owner)}>
                {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                <span>{owner}</span>
              </button>
              {!isCollapsed &&
                repos.map((repo) => (
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
        <span className="repo-name">{repoLabel}</span>
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
  repo: RepoSummary | null;
  sidebarCollapsed: boolean;
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
  onToggleSidebar(): void;
  onOpenGithub(): void;
  onSelectPr(pr: PullRequestSummary): void;
  onSelectIssue(issue: IssueSummary): void;
  onSelectRun(run: WorkflowRunSummary): void;
  onSelectWorkflow(workflow: WorkflowSummary): void;
  onToggleWorkflowStar(workflow: WorkflowSummary): void;
  onReorderFavoriteWorkflow(sourceId: number, targetId: number): void;
  onRunWorkflow(workflow: WorkflowSummary): void;
}) {
  return (
    <section className="project-pane" tabIndex={0}>
      <div className={cx("pane-header", props.sidebarCollapsed && "collapsed-project-header")}>
        <div className="pane-title">
          {props.sidebarCollapsed && (
            <button className="icon-button project-sidebar-toggle" aria-label="Open sidebar" onClick={props.onToggleSidebar}>
              <PanelLeftOpen size={18} />
            </button>
          )}
          <span>{props.repo?.name ?? "Project Focus"}</span>
          {props.loading && <Loader2 className="spin" size={14} />}
        </div>
        <div className="header-actions">
          <ProjectFocusToolbar
            disabled={!props.repo}
            view={props.focusView}
            counts={{
              "pull-requests": props.openPullRequests.length,
              "workflow-runs": props.workflowRuns.length,
              issues: props.issues.length,
              workflows: props.workflows.length
            }}
            onView={props.onFocusView}
          />
          <span className="toolbar-divider" />
          <button className="icon-button" aria-label="Refresh" onClick={props.onRefresh} disabled={!props.repo}>
            <RefreshCw size={16} />
          </button>
          <button className="icon-button" aria-label="Open in GitHub" onClick={props.onOpenGithub} disabled={!props.repo}>
            <ExternalLink size={16} />
          </button>
        </div>
      </div>
      {!props.repo ? (
        <EmptyPane icon={<Github size={24} />} title="No repository selected" />
      ) : (
        <div className="project-scroll">
          <div className="project-identity">
            <span className="owner">{props.repo.owner}</span>
            <span className="full-name">{props.repo.fullName}</span>
          </div>
          {props.error && (
            <div className="inline-error">
              <AlertCircle size={15} />
              <span>{props.error}</span>
            </div>
          )}
          {props.focusView === "workflow-runs" ? (
            <WorkflowRunsSection
              runs={props.workflowRuns}
              selected={props.selection}
              onSelect={props.onSelectRun}
            />
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
              onRun={props.onRunWorkflow}
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
}) {
  const toolbarUnderline = useSlidingUnderline(
    `${props.view}:${props.disabled}:${props.counts["pull-requests"]}:${props.counts["workflow-runs"]}:${props.counts.issues}:${props.counts.workflows}`
  );
  const items: Array<{ view: ProjectFocusView; label: string; icon: React.ReactNode }> = [
    { view: "pull-requests", label: "Pull Requests", icon: <GitPullRequest size={15} /> },
    { view: "workflow-runs", label: "Workflow Runs", icon: <Activity size={15} /> },
    { view: "issues", label: "Issues", icon: <Inbox size={15} /> },
    { view: "workflows", label: "Workflows", icon: <Workflow size={15} /> }
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
          aria-pressed={props.view === item.view}
          disabled={props.disabled}
          onClick={() => props.onView(item.view)}
        >
          {item.icon}
        </button>
      ))}
      <span className="sliding-tab-underline" style={toolbarUnderline.underlineStyle} aria-hidden="true" />
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
  onRun(workflow: WorkflowSummary): void;
}) {
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
        onRun={props.onRun}
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
  onRun(workflow: WorkflowSummary): void;
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
            <button className="icon-button small" aria-label="Run workflow" onClick={() => props.onRun(workflow)}>
              <Play size={14} />
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

function ContentPane(props: {
  auth: AuthStatus | null;
  authError: string | null;
  tokenDraft: string;
  repo: RepoSummary | null;
  selection: ContentSelection;
  prDetail: PullRequestDetail | null;
  runDetail: WorkflowRunDetail | null;
  prTab: string;
  runTab: string;
  repoLabels: LabelSummary[];
  loading: boolean;
  error: string | null;
  prActionSubmitting: boolean;
  theme: ThemeMode;
  workflowRuns: WorkflowRunSummary[];
  canNavigateBack: boolean;
  canNavigateForward: boolean;
  accentColor: string;
  onTokenChange(value: string): void;
  onSaveToken(event: React.FormEvent): void;
  onOpenTokenSettings(): void;
  onClearToken(): void;
  onPrTabChange(tab: string): void;
  onRunTabChange(tab: string): void;
  onNavigateBack(): void;
  onNavigateForward(): void;
  onToggleTheme(): void;
  onAccentChange(color: string): void;
  onOpenGithub(): void;
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
}) {
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
    reviewPr
  ]);

  return (
    <main className="content-pane" tabIndex={0}>
      <div className="content-header app-drag">
        <div className="content-header-left">
          <div className="navigation-controls" aria-label="Navigation">
            <button
              className="icon-button navigation-button"
              aria-label="Back"
              onClick={props.onNavigateBack}
              disabled={!props.canNavigateBack}
            >
              <ArrowLeft size={16} />
            </button>
            <button
              className="icon-button navigation-button"
              aria-label="Forward"
              onClick={props.onNavigateForward}
              disabled={!props.canNavigateForward}
            >
              <ArrowRight size={16} />
            </button>
          </div>
          <div className="content-title">
            <ContentTitle selection={props.selection} repo={props.repo} />
            <button
              className="icon-button content-title-action"
              aria-label="Open in GitHub"
              onClick={props.onOpenGithub}
              disabled={!props.repo}
            >
              <ExternalLink size={16} />
            </button>
            {showDraftAction && reviewPr && (
              <PullRequestReadinessToggle
                disabled={props.prActionSubmitting}
                isDraft={reviewPr.isDraft}
                onChange={setPullRequestReadiness}
              />
            )}
            {showPullRequestManagementActions && reviewPr && (
              <PullRequestAutoMergeToggle
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
          {props.auth?.configured && (
            <button className="icon-button" aria-label="Clear token" onClick={props.onClearToken}>
              <KeyRound size={16} />
            </button>
          )}
          <div className="theme-accent-control">
            <button
              className="theme-toggle-button"
              aria-label={props.theme === "dark" ? "Current theme: dark. Switch to light theme." : "Current theme: light. Switch to dark theme."}
              onClick={props.onToggleTheme}
            >
              {props.theme === "dark" ? <Moon size={15} /> : <Sun size={15} />}
            </button>
            <div className="accent-picker" role="radiogroup" aria-label="Accent color">
              {accentColors.map((color, index) => (
                <button
                  key={color}
                  className={cx("accent-swatch", props.accentColor === color && "active")}
                  style={{ "--swatch-color": color } as SwatchCssVars}
                  role="radio"
                  aria-checked={props.accentColor === color}
                  aria-label={`Accent ${index + 1}`}
                  onClick={(event) => {
                    props.onAccentChange(color);
                    event.currentTarget.blur();
                  }}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
      {!props.auth?.configured ? (
        <TokenGate
          auth={props.auth}
          error={props.authError}
          token={props.tokenDraft}
          onTokenChange={props.onTokenChange}
          onSave={props.onSaveToken}
          onOpenTokenSettings={props.onOpenTokenSettings}
        />
      ) : props.error ? (
        <div className="content-scroll">
          <div className="inline-error large">
            <AlertCircle size={18} />
            <span>{props.error}</span>
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
      ) : props.selection.kind === "issue" ? (
        <IssueContent issue={props.selection.issue} />
      ) : props.selection.kind === "run" ? (
        <WorkflowRunContent
          detail={props.runDetail}
          fallback={props.selection.run}
          focusedJobId={props.selection.focusedJobId ?? null}
          repo={props.repo}
          tab={props.runTab}
          onTab={props.onRunTabChange}
        />
      ) : (
        <WorkflowContent
          workflow={props.selection.workflow}
          repo={props.repo}
          workflowRuns={props.workflowRuns}
          onSelectRun={props.onSelectRun}
          onRun={props.onRunWorkflow}
        />
      )}
    </main>
  );
}

function ContentTitle(props: { selection: ContentSelection; repo: RepoSummary | null }) {
  if (!props.repo) {
    return <span>Content</span>;
  }

  if (props.selection.kind === "repo") {
    return <span>{props.repo.fullName}</span>;
  }
  if (props.selection.kind === "pr") {
    return <span>PR #{props.selection.pr.number}</span>;
  }
  if (props.selection.kind === "issue") {
    return <span>Issue #{props.selection.issue.number}</span>;
  }
  if (props.selection.kind === "run") {
    return <span>Run {props.selection.run.id}</span>;
  }
  return <span>{props.selection.workflow.name}</span>;
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

function TokenGate(props: {
  auth: AuthStatus | null;
  error: string | null;
  token: string;
  onTokenChange(value: string): void;
  onSave(event: React.FormEvent): void;
  onOpenTokenSettings(): void;
}) {
  return (
    <div className="token-gate">
      <form className="token-panel" onSubmit={props.onSave}>
        <div className="token-icon">
          <KeyRound size={24} />
        </div>
        <h1>GitHub token</h1>
        <p className="token-help">
          Use a classic PAT with <strong>repo</strong> and <strong>read:project</strong> permissions.
        </p>
        <button className="token-settings-link" type="button" onClick={props.onOpenTokenSettings}>
          <ExternalLink size={14} />
          <span>Open classic token settings</span>
        </button>
        <input
          type="password"
          value={props.token}
          onChange={(event) => props.onTokenChange(event.target.value)}
          placeholder="Personal access token"
          autoFocus
        />
        <button className="primary-button" type="submit" disabled={!props.token.trim()}>
          Store token
        </button>
        {!props.auth?.encryptionAvailable && (
          <div className="inline-error">
            <AlertCircle size={15} />
            <span>Secure storage is unavailable.</span>
          </div>
        )}
        {props.error && (
          <div className="inline-error">
            <AlertCircle size={15} />
            <span>{props.error}</span>
          </div>
        )}
      </form>
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
      if (nextFocused instanceof Node && event.currentTarget.contains(nextFocused)) {
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
    if (nextFocused instanceof Node && event.currentTarget.contains(nextFocused)) {
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
              <span>Pull request</span>
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
                <button
                  type="button"
                  className="commit-link"
                  aria-label={`Open commit ${shortSha(commit.oid)} in GitHub`}
                  onClick={() => props.onOpenGithubUrl(commit.url)}
                >
                  {shortSha(commit.oid)}
                </button>
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
    if (nextFocused instanceof Node && event.currentTarget.contains(nextFocused)) {
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
                {file.previousPath ? `${file.previousPath} -> ${file.path}` : file.path}
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
  onRun(workflow: WorkflowSummary): void;
}) {
  const [tab, setTab] = useState("Description");
  const relatedRuns = useMemo(
    () => props.workflowRuns.filter((run) => run.workflowId === props.workflow.id),
    [props.workflow.id, props.workflowRuns]
  );

  useEffect(() => {
    setTab("Description");
  }, [props.workflow.id]);

  return (
    <div className="content-detail-shell">
      <div className="detail-fixed">
        <div className="detail-heading row-heading">
          <div>
            <span className="eyebrow">Workflow</span>
            <h1>{props.workflow.name}</h1>
          </div>
          <button className="primary-button inline" onClick={() => props.onRun(props.workflow)}>
            <Play size={15} />
            Run
          </button>
        </div>
        <TabBar tabs={["Description", "Runs"]} selected={tab} onSelect={setTab} />
      </div>
      <div className="detail-body-scroll">
        {tab === "Description" ? (
          <div className="stat-grid">
            <div className="stat">
              <span>State</span>
              <strong>{props.workflow.state}</strong>
            </div>
            <div className="stat">
              <span>Path</span>
              <strong>{props.workflow.path}</strong>
            </div>
            <div className="stat">
              <span>Default ref</span>
              <strong>{props.repo.defaultBranch ?? "main"}</strong>
            </div>
            <div className="stat">
              <span>Updated</span>
              <strong>{formatRelative(props.workflow.updatedAt)}</strong>
            </div>
          </div>
        ) : (
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
        )}
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
  onTab(tab: string): void;
}) {
  const run = props.detail ?? props.fallback;
  const tabs = ["Summary", "Jobs", "Artifacts"];
  const selectedTab = tabs.includes(props.tab) ? props.tab : "Jobs";

  return (
    <div className="content-detail-shell">
      <div className="detail-fixed">
        <div className="detail-heading">
          <div>
            <span className="eyebrow">Workflow run</span>
            <h1>{run.displayTitle || run.name || `Run ${run.id}`}</h1>
          </div>
          <span className={cx("state-chip large-chip", statusTone(run.status, run.conclusion))}>
            {run.conclusion ?? run.status ?? "run"}
          </span>
        </div>
        <TabBar tabs={tabs} selected={selectedTab} onSelect={props.onTab} />
      </div>
      <div className="detail-body-scroll">
        {!props.detail ? (
          <Skeleton />
        ) : selectedTab === "Summary" ? (
          <div className="stat-grid">
            <div className="stat">
              <span>Trigger</span>
              <strong>{run.event ?? "unknown"}</strong>
            </div>
            <div className="stat">
              <span>Branch</span>
              <strong>{run.branch ?? "unknown"}</strong>
            </div>
            <div className="stat">
              <span>Commit</span>
              <strong>{shortSha(run.commitSha)}</strong>
            </div>
            <div className="stat">
              <span>Duration</span>
              <strong>{formatDuration(run.durationMs) || "running"}</strong>
            </div>
            <div className="stat">
              <span>Started</span>
              <strong>{formatRelative(run.runStartedAt)}</strong>
            </div>
            <div className="stat">
              <span>Actor</span>
              <strong>{run.actor?.login ?? "unknown"}</strong>
            </div>
          </div>
        ) : selectedTab === "Jobs" ? (
          <WorkflowJobsList focusedJobId={props.focusedJobId ?? null} jobs={props.detail.jobs} repo={props.repo} />
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

function WorkflowJobsList({
  focusedJobId,
  jobs,
  repo
}: {
  focusedJobId?: number | null;
  jobs: WorkflowRunDetail["jobs"];
  repo: RepoRef;
}) {
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
  }, [expandedSteps, jobs, loadJob]);

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
          <ArticleCard key={job.id} title={job.name} meta={job.conclusion ?? job.status ?? ""}>
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
                            <span>{state.error}</span>
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

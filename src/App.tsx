import {
  Activity,
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  Code2,
  Command,
  ExternalLink,
  FileCode2,
  FileText,
  GitBranch,
  Github,
  GitPullRequest,
  Inbox,
  KeyRound,
  ListChecks,
  Loader2,
  Moon,
  Menu,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Play,
  RefreshCw,
  Search,
  Star,
  StarOff,
  Sun,
  Workflow,
  XCircle
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type {
  AuthStatus,
  GithubFocusApi,
  IssueSummary,
  OrganizationSummary,
  PullRequestDetail,
  PullRequestSummary,
  RepoSummary,
  WorkflowRunDetail,
  WorkflowRunSummary,
  WorkflowSummary
} from "../shared/github";

type ContentSelection =
  | { kind: "repo" }
  | { kind: "pr"; pr: PullRequestSummary }
  | { kind: "issue"; issue: IssueSummary }
  | { kind: "run"; run: WorkflowRunSummary }
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

const accentColors = [
  "#7ee787",
  "#79c0ff",
  "#a5d6ff",
  "#d2a8ff",
  "#ffa7c4",
  "#ffa198",
  "#f2cc60"
] as const;
const defaultAccentColor = accentColors[0];
type AccentColor = (typeof accentColors)[number];
type AppCssVars = React.CSSProperties & Record<"--accent", string>;
type SwatchCssVars = React.CSSProperties & Record<"--swatch-color", string>;

function ipcUnavailable<T>(): Promise<T> {
  return Promise.reject(new Error("GitHub IPC is available only inside the Electron app."));
}

const browserApi: GithubFocusApi = {
  platform: "browser",
  getAuthStatus: async () => ({ configured: false, encryptionAvailable: false }),
  saveToken: () => ipcUnavailable(),
  clearToken: () => ipcUnavailable(),
  getRepositories: () => ipcUnavailable(),
  getStarredRepos: () => ipcUnavailable(),
  getRecentRepos: () => ipcUnavailable(),
  getOrganizations: () => ipcUnavailable(),
  getRepo: () => ipcUnavailable(),
  getPullRequests: () => ipcUnavailable(),
  getIssues: () => ipcUnavailable(),
  getWorkflows: () => ipcUnavailable(),
  getWorkflowRuns: () => ipcUnavailable(),
  getPullRequest: () => ipcUnavailable(),
  getWorkflowRun: () => ipcUnavailable(),
  dispatchWorkflow: () => ipcUnavailable(),
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

function repoKey(repo: { owner: string; name: string }): string {
  return `${repo.owner}/${repo.name}`;
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

function formatDuration(value?: number | null): string {
  if (!value) {
    return "";
  }

  const seconds = Math.floor(value / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  if (minutes < 60) {
    return `${minutes}m ${remainder}s`;
  }

  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function shortSha(value?: string | null): string {
  return value ? value.slice(0, 7) : "";
}

function cx(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ");
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  const tagName = target.tagName.toLowerCase();
  return tagName === "input" || tagName === "textarea" || target.isContentEditable;
}

function statusTone(status?: string | null, conclusion?: string | null): string {
  const value = (conclusion || status || "").toLowerCase();
  if (["success", "completed", "approved", "mergeable"].includes(value)) {
    return "good";
  }
  if (["failure", "error", "timed_out", "cancelled", "changes_requested", "conflicting"].includes(value)) {
    return "bad";
  }
  if (["in_progress", "queued", "pending", "requested", "waiting"].includes(value)) {
    return "running";
  }
  if (value === "neutral" || value === "skipped") {
    return "muted";
  }
  return "unknown";
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
  const [pullRequests, setPullRequests] = useState<PullRequestSummary[]>([]);
  const [issues, setIssues] = useState<IssueSummary[]>([]);
  const [workflowRuns, setWorkflowRuns] = useState<WorkflowRunSummary[]>([]);
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);

  const [selection, setSelection] = useState<ContentSelection>({ kind: "repo" });
  const [prDetail, setPrDetail] = useState<PullRequestDetail | null>(null);
  const [runDetail, setRunDetail] = useState<WorkflowRunDetail | null>(null);
  const [contentLoading, setContentLoading] = useState(false);
  const [contentError, setContentError] = useState<string | null>(null);
  const [prTab, setPrTab] = useState("Description");
  const [runTab, setRunTab] = useState("Summary");

  const [sidebarCollapsed, setSidebarCollapsed] = useStoredState("github-focus:sidebar-collapsed", false);
  const [favoriteKeys, setFavoriteKeys] = useStoredState<string[]>("github-focus:favorites", []);
  const [localRecentKeys, setLocalRecentKeys] = useStoredState<string[]>("github-focus:local-recents", []);
  const [starredWorkflowKeys, setStarredWorkflowKeys] = useStoredState<Record<string, number[]>>(
    "github-focus:starred-workflows",
    {}
  );
  const [theme, setTheme] = useStoredState<ThemeMode>("github-focus:theme", "dark");
  const [accentColor, setAccentColor] = useStoredState<string>("github-focus:accent-color", defaultAccentColor);
  const [leftWidth, setLeftWidth] = useStoredState("github-focus:left-width", 280);
  const [middleWidth, setMiddleWidth] = useStoredState("github-focus:middle-width", 392);
  const [sidebarSearch, setSidebarSearch] = useState("");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState("");
  const [paletteIndex, setPaletteIndex] = useState(0);
  const lastGPress = useRef(0);

  const allRepos = useMemo(() => uniqueRepos([...(selectedRepo ? [selectedRepo] : []), ...starredRepos, ...recentRepos, ...repositories]), [
    selectedRepo,
    starredRepos,
    recentRepos,
    repositories
  ]);

  const reposByKey = useMemo(() => new Map(allRepos.map((repo) => [repoKey(repo), repo])), [allRepos]);

  const favoriteRepos = useMemo(
    () => favoriteKeys.map((key) => reposByKey.get(key)).filter(Boolean) as RepoSummary[],
    [favoriteKeys, reposByKey]
  );

  const selectedRepoKey = selectedRepo ? repoKey(selectedRepo) : "";
  const selectedWorkflowStars = selectedRepoKey ? starredWorkflowKeys[selectedRepoKey] ?? [] : [];
  const starredWorkflows = workflows.filter((workflow) => selectedWorkflowStars.includes(workflow.id));

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
    return [
      ...starredWorkflows.map((workflow) => ({
        id: `workflow:${workflow.id}`,
        kind: "workflow" as const,
        workflow
      })),
      ...pullRequests.map((pr) => ({ id: `pr:${pr.number}`, kind: "pr" as const, pr })),
      ...workflowRuns.map((run) => ({ id: `run:${run.id}`, kind: "run" as const, run })),
      ...issues.map((issue) => ({ id: `issue:${issue.number}`, kind: "issue" as const, issue })),
      ...workflows
        .filter((workflow) => !selectedWorkflowStars.includes(workflow.id))
        .map((workflow) => ({ id: `workflow:${workflow.id}`, kind: "workflow" as const, workflow }))
    ];
  }, [issues, pullRequests, selectedWorkflowStars, starredWorkflows, workflowRuns, workflows]);

  const currentGithubUrl = openUrlForSelection(selection, selectedRepo);

  const flash = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 2600);
  }, []);

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
    async (repo: RepoSummary, showSpinner = true) => {
      if (showSpinner) {
        setProjectLoading(true);
      }
      setProjectError(null);

      try {
        const [repoDetail, prs, repoIssues, repoWorkflows, runs] = await Promise.all([
          api.getRepo(repo),
          api.getPullRequests(repo),
          api.getIssues(repo),
          api.getWorkflows(repo),
          api.getWorkflowRuns(repo)
        ]);

        setSelectedRepo(repoDetail.data);
        setPullRequests(prs.data);
        setIssues(repoIssues.data);
        setWorkflows(repoWorkflows.data);
        setWorkflowRuns(runs.data);
      } catch (error) {
        setProjectError(error instanceof Error ? error.message : "Unable to load repository data.");
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

  const selectMiddleItem = useCallback(
    (item: MiddleItem) => {
      if (item.kind === "pr") {
        setSelection({ kind: "pr", pr: item.pr });
        setPrTab("Description");
      }
      if (item.kind === "issue") {
        setSelection({ kind: "issue", issue: item.issue });
      }
      if (item.kind === "run") {
        setSelection({ kind: "run", run: item.run });
        setRunTab("Summary");
      }
      if (item.kind === "workflow") {
        setSelection({ kind: "workflow", workflow: item.workflow });
      }
    },
    []
  );

  const openGithub = useCallback(() => {
    if (currentGithubUrl) {
      void api.openInGitHub(currentGithubUrl);
    }
  }, [currentGithubUrl]);

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
      const index = Math.max(0, middleItems.findIndex((item) => item.id === currentId));
      const nextIndex = (index + delta + middleItems.length) % middleItems.length;
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
        run: () => setSidebarCollapsed((value) => !value)
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
          run: () => setSelection({ kind: "pr", pr })
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
    setSidebarCollapsed,
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

  useEffect(() => {
    if (auth?.configured) {
      void loadInitial();
    }
  }, [auth?.configured, loadInitial]);

  useEffect(() => {
    if (selectedRepo && auth?.configured) {
      void loadProject(selectedRepo);
    }
  }, [auth?.configured, loadProject, selectedRepoKey]);

  useEffect(() => {
    if (!selectedRepo || selection.kind !== "pr") {
      return;
    }

    let cancelled = false;
    setContentLoading(true);
    setContentError(null);
    setPrDetail(null);
    void api
      .getPullRequest(selectedRepo, selection.pr.number)
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
  }, [selectedRepoKey, selection]);

  useEffect(() => {
    if (!selectedRepo || selection.kind !== "run") {
      return;
    }

    let cancelled = false;
    setContentLoading(true);
    setContentError(null);
    setRunDetail(null);
    void api
      .getWorkflowRun(selectedRepo, selection.run.id)
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
  }, [selectedRepoKey, selection]);

  useEffect(() => {
    const unsubscribe = api.onCacheUpdated((key) => {
      if (key.startsWith("viewer:")) {
        void loadInitial(false);
      }
      if (selectedRepo && key.startsWith(`repo:${repoKey(selectedRepo)}`)) {
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
        setSidebarCollapsed((value) => !value);
        return;
      }

      if ((event.metaKey || event.ctrlKey) && ["1", "2", "3"].includes(event.key)) {
        event.preventDefault();
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
  }, [moveMiddleSelection, openGithub, paletteOpen, selection.kind, setSidebarCollapsed]);

  const saveToken = async (event: React.FormEvent) => {
    event.preventDefault();
    setAuthError(null);
    try {
      const nextAuth = await api.saveToken(tokenDraft);
      setTokenDraft("");
      setAuth(nextAuth);
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Unable to store token.");
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
    ? `58px ${middleWidth}px 5px minmax(0, 1fr)`
    : `${leftWidth}px 5px ${middleWidth}px 5px minmax(0, 1fr)`;
  const selectedAccent = accentColors.includes(accentColor as AccentColor) ? accentColor : defaultAccentColor;
  const appStyle: AppCssVars = {
    gridTemplateColumns,
    "--accent": selectedAccent
  };

  return (
    <div className="app-shell" data-theme={theme} style={appStyle}>
      <Sidebar
        collapsed={sidebarCollapsed}
        favoriteRepos={favoriteRepos}
        repoGroups={repoGroups}
        selectedRepo={selectedRepo}
        search={sidebarSearch}
        onSearch={setSidebarSearch}
        onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
        onSelectRepo={selectRepo}
        onToggleFavorite={toggleFavorite}
        favoriteKeys={favoriteKeys}
        loading={initialLoading}
      />
      {!sidebarCollapsed && <div className="resize-handle" onPointerDown={(event) => startResize("left", event)} />}
      <ProjectPane
        repo={selectedRepo}
        sidebarCollapsed={sidebarCollapsed}
        pullRequests={pullRequests}
        issues={issues}
        workflowRuns={workflowRuns}
        workflows={workflows}
        starredWorkflows={starredWorkflows}
        starredWorkflowIds={selectedWorkflowStars}
        loading={projectLoading}
        error={projectError}
        selection={selection}
        onRefresh={() => selectedRepo && loadProject(selectedRepo)}
        onToggleSidebar={() => setSidebarCollapsed(false)}
        onOpenGithub={openGithub}
        onSelectPr={(pr) => setSelection({ kind: "pr", pr })}
        onSelectIssue={(issue) => setSelection({ kind: "issue", issue })}
        onSelectRun={(run) => setSelection({ kind: "run", run })}
        onSelectWorkflow={(workflow) => setSelection({ kind: "workflow", workflow })}
        onToggleWorkflowStar={toggleWorkflowStar}
        onRunWorkflow={runWorkflow}
      />
      <div className="resize-handle" onPointerDown={(event) => startResize("middle", event)} />
      <ContentPane
        auth={auth}
        authError={authError}
        tokenDraft={tokenDraft}
        onTokenChange={setTokenDraft}
        onSaveToken={saveToken}
        onClearToken={clearStoredToken}
        repo={selectedRepo}
        selection={selection}
        prDetail={prDetail}
        runDetail={runDetail}
        prTab={prTab}
        runTab={runTab}
        onPrTabChange={setPrTab}
        onRunTabChange={setRunTab}
        loading={contentLoading}
        error={contentError}
        theme={theme}
        accentColor={selectedAccent}
        onToggleTheme={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
        onAccentChange={setAccentColor}
        onOpenGithub={openGithub}
        onRunWorkflow={runWorkflow}
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
}

function Sidebar(props: SidebarProps) {
  const [collapsedGroups, setCollapsedGroups] = useStoredState<Record<string, boolean>>(
    "github-focus:collapsed-orgs",
    {}
  );
  const [repoTab, setRepoTab] = useStoredState<SidebarRepoTab>("github-focus:sidebar-repo-tab", "favorites");
  const searchActive = props.search.trim().length > 0;
  const allRepoCount = props.repoGroups.reduce((total, [, repos]) => total + repos.length, 0);

  if (props.collapsed) {
    return (
      <aside className="sidebar collapsed-pane" tabIndex={0}>
        <div className="collapsed-stack">
          <Github size={18} />
          <Star size={18} />
          <Search size={18} />
        </div>
      </aside>
    );
  }

  return (
    <aside className="sidebar" tabIndex={0}>
      <div className="pane-header app-drag">
        <div className="brand-mark">
          <Github size={18} />
          <span>GitHub Focus</span>
        </div>
        <button className="icon-button" title="Collapse sidebar" onClick={props.onToggle}>
          <PanelLeftClose size={18} />
        </button>
      </div>
      <label className="search-box">
        <Search size={16} />
        <input value={props.search} onChange={(event) => props.onSearch(event.target.value)} placeholder="Search" />
      </label>
      {!searchActive && (
        <div className="sidebar-tabs" role="tablist" aria-label="Repository view">
          <button
            className={cx("sidebar-tab", repoTab === "favorites" && "active")}
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
            role="tab"
            aria-selected={repoTab === "all"}
            onClick={() => setRepoTab("all")}
          >
            <Code2 size={14} />
            All
            <span>{allRepoCount}</span>
          </button>
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
}) {
  return (
    <div className="repo-section">
      <div className="section-title">
        {props.icon}
        <span>{props.title}</span>
        <span className="count">{props.repos.length}</span>
      </div>
      {props.repos.length ? (
        props.repos.map((repo) => (
          <RepoButton
            key={repo.fullName}
            repo={repo}
            selected={props.selectedRepo ? repoKey(repo) === repoKey(props.selectedRepo) : false}
            favorite={props.favoriteKeys.includes(repoKey(repo))}
            onSelect={() => props.onSelectRepo(repo)}
            onToggleFavorite={() => props.onToggleFavorite(repo)}
          />
        ))
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
  onSelect(): void;
  onToggleFavorite(): void;
}) {
  return (
    <div className={cx("repo-button-wrap", props.selected && "selected")}>
      <button className="repo-button" onClick={props.onSelect}>
        <span className="repo-name">{props.repo.name}</span>
        <span className="repo-meta">{formatRelative(props.repo.updatedAt)}</span>
      </button>
      <button className="star-button" title={props.favorite ? "Remove favorite" : "Add favorite"} onClick={props.onToggleFavorite}>
        {props.favorite ? <Star size={14} fill="currentColor" /> : <StarOff size={14} />}
      </button>
    </div>
  );
}

function ProjectPane(props: {
  repo: RepoSummary | null;
  sidebarCollapsed: boolean;
  pullRequests: PullRequestSummary[];
  issues: IssueSummary[];
  workflowRuns: WorkflowRunSummary[];
  workflows: WorkflowSummary[];
  starredWorkflows: WorkflowSummary[];
  starredWorkflowIds: number[];
  loading: boolean;
  error: string | null;
  selection: ContentSelection;
  onRefresh(): void;
  onToggleSidebar(): void;
  onOpenGithub(): void;
  onSelectPr(pr: PullRequestSummary): void;
  onSelectIssue(issue: IssueSummary): void;
  onSelectRun(run: WorkflowRunSummary): void;
  onSelectWorkflow(workflow: WorkflowSummary): void;
  onToggleWorkflowStar(workflow: WorkflowSummary): void;
  onRunWorkflow(workflow: WorkflowSummary): void;
}) {
  return (
    <section className="project-pane" tabIndex={0}>
      <div className={cx("pane-header", props.sidebarCollapsed && "collapsed-project-header")}>
        <div className="pane-title">
          {props.sidebarCollapsed && (
            <button className="icon-button project-sidebar-toggle" title="Open sidebar" onClick={props.onToggleSidebar}>
              <PanelLeftOpen size={18} />
            </button>
          )}
          <span>{props.repo?.name ?? "Project Focus"}</span>
          {props.loading && <Loader2 className="spin" size={14} />}
        </div>
        <div className="header-actions">
          <button className="icon-button" title="Refresh" onClick={props.onRefresh} disabled={!props.repo}>
            <RefreshCw size={16} />
          </button>
          <button className="icon-button" title="Open in GitHub" onClick={props.onOpenGithub} disabled={!props.repo}>
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
          <WorkflowSection
            title="Starred Actions"
            workflows={props.starredWorkflows}
            starredIds={props.starredWorkflowIds}
            selected={props.selection}
            onSelect={props.onSelectWorkflow}
            onToggleStar={props.onToggleWorkflowStar}
            onRun={props.onRunWorkflow}
            empty="No starred actions"
          />
          <div className="focus-section">
            <div className="section-title">
              <GitPullRequest size={15} />
              <span>Pull Requests</span>
              <span className="count">{props.pullRequests.length}</span>
            </div>
            {props.pullRequests.length ? (
              props.pullRequests.map((pr) => (
                <button
                  key={pr.id}
                  className={cx("focus-row", props.selection.kind === "pr" && props.selection.pr.id === pr.id && "active")}
                  onClick={() => props.onSelectPr(pr)}
                >
                  <StatusIcon status={pr.ciState} conclusion={pr.reviewDecision ?? undefined} />
                  <span className="focus-main">
                    <span className="focus-title">#{pr.number} {pr.title}</span>
                    <span className="focus-meta">{pr.author?.login ?? "unknown"} to {pr.baseRefName}</span>
                  </span>
                  <span className={cx("state-chip", statusTone(pr.mergeable, pr.reviewDecision))}>
                    {pr.isDraft ? "draft" : pr.reviewDecision ?? pr.mergeable ?? "open"}
                  </span>
                </button>
              ))
            ) : (
              <div className="empty-row">No open PRs</div>
            )}
          </div>
          <div className="focus-section">
            <div className="section-title">
              <Activity size={15} />
              <span>Workflow Runs</span>
              <span className="count">{props.workflowRuns.length}</span>
            </div>
            {props.workflowRuns.length ? (
              props.workflowRuns.map((run) => (
                <button
                  key={run.id}
                  className={cx("focus-row", props.selection.kind === "run" && props.selection.run.id === run.id && "active")}
                  onClick={() => props.onSelectRun(run)}
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
                  className={cx("focus-row", props.selection.kind === "issue" && props.selection.issue.id === issue.id && "active")}
                  onClick={() => props.onSelectIssue(issue)}
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
          <WorkflowSection
            title="Workflows"
            workflows={props.workflows}
            starredIds={props.starredWorkflowIds}
            selected={props.selection}
            onSelect={props.onSelectWorkflow}
            onToggleStar={props.onToggleWorkflowStar}
            onRun={props.onRunWorkflow}
            empty="No workflows"
          />
        </div>
      )}
    </section>
  );
}

function WorkflowSection(props: {
  title: string;
  workflows: WorkflowSummary[];
  starredIds: number[];
  selected: ContentSelection;
  empty: string;
  onSelect(workflow: WorkflowSummary): void;
  onToggleStar(workflow: WorkflowSummary): void;
  onRun(workflow: WorkflowSummary): void;
}) {
  return (
    <div className="focus-section">
      <div className="section-title">
        <Workflow size={15} />
        <span>{props.title}</span>
        <span className="count">{props.workflows.length}</span>
      </div>
      {props.workflows.length ? (
        props.workflows.map((workflow) => (
          <div
            key={workflow.id}
            className={cx("workflow-row", props.selected.kind === "workflow" && props.selected.workflow.id === workflow.id && "active")}
          >
            <button className="workflow-main" onClick={() => props.onSelect(workflow)}>
              <Workflow size={15} />
              <span>
                <span className="focus-title">{workflow.name}</span>
                <span className="focus-meta">{workflow.state}</span>
              </span>
            </button>
            <button className="icon-button small" title="Run workflow" onClick={() => props.onRun(workflow)}>
              <Play size={14} />
            </button>
            <button className="icon-button small" title="Star workflow" onClick={() => props.onToggleStar(workflow)}>
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
  loading: boolean;
  error: string | null;
  theme: ThemeMode;
  accentColor: string;
  onTokenChange(value: string): void;
  onSaveToken(event: React.FormEvent): void;
  onClearToken(): void;
  onPrTabChange(tab: string): void;
  onRunTabChange(tab: string): void;
  onToggleTheme(): void;
  onAccentChange(color: string): void;
  onOpenGithub(): void;
  onRunWorkflow(workflow: WorkflowSummary): void;
}) {
  return (
    <main className="content-pane" tabIndex={0}>
      <div className="content-header app-drag">
        <div className="content-title">
          <ContentTitle selection={props.selection} repo={props.repo} />
          {props.loading && <Loader2 className="spin" size={15} />}
        </div>
        <div className="header-actions">
          {props.auth?.configured && (
            <button className="icon-button" title="Clear token" onClick={props.onClearToken}>
              <KeyRound size={16} />
            </button>
          )}
          <button className="icon-button" title="Open in GitHub" onClick={props.onOpenGithub} disabled={!props.repo}>
            <ExternalLink size={16} />
          </button>
          <div className="theme-accent-control">
            <button
              className="theme-toggle-button"
              aria-label={props.theme === "dark" ? "Current theme: dark. Switch to light theme." : "Current theme: light. Switch to dark theme."}
              title={props.theme === "dark" ? "Dark theme" : "Light theme"}
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
                  title=""
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
        <PullRequestContent detail={props.prDetail} fallback={props.selection.pr} tab={props.prTab} onTab={props.onPrTabChange} />
      ) : props.selection.kind === "issue" ? (
        <IssueContent issue={props.selection.issue} />
      ) : props.selection.kind === "run" ? (
        <WorkflowRunContent detail={props.runDetail} fallback={props.selection.run} tab={props.runTab} onTab={props.onRunTabChange} />
      ) : (
        <WorkflowContent workflow={props.selection.workflow} repo={props.repo} onRun={props.onRunWorkflow} />
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

function TokenGate(props: {
  auth: AuthStatus | null;
  error: string | null;
  token: string;
  onTokenChange(value: string): void;
  onSave(event: React.FormEvent): void;
}) {
  return (
    <div className="token-gate">
      <form className="token-panel" onSubmit={props.onSave}>
        <div className="token-icon">
          <KeyRound size={24} />
        </div>
        <h1>GitHub token</h1>
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
  onTab(tab: string): void;
}) {
  const detail = props.detail;
  const tabs = ["Description", "Comments", "Reviews", "Files", "Commits", "Checks"];

  return (
    <div className="content-scroll">
      <div className="detail-heading">
        <div>
          <span className="eyebrow">Pull request #{props.fallback.number}</span>
          <h1>{detail?.title ?? props.fallback.title}</h1>
        </div>
        <div className="label-row">
          {(detail?.labels ?? props.fallback.labels).map((label) => (
            <span className="label" style={{ borderColor: `#${label.color}` }} key={label.id}>
              {label.name}
            </span>
          ))}
        </div>
      </div>
      <TabBar tabs={tabs} selected={props.tab} onSelect={props.onTab} />
      {!detail ? (
        <Skeleton />
      ) : props.tab === "Description" ? (
        <MarkdownBlock value={detail.body || "No description."} />
      ) : props.tab === "Comments" ? (
        <StackedList
          empty="No comments"
          items={detail.comments}
          render={(comment) => (
            <ArticleCard key={comment.id} title={comment.author?.login ?? "unknown"} meta={formatRelative(comment.updatedAt ?? comment.createdAt)}>
              <MarkdownBlock value={comment.body} compact />
            </ArticleCard>
          )}
        />
      ) : props.tab === "Reviews" ? (
        <StackedList
          empty="No reviews"
          items={detail.reviews}
          render={(review) => (
            <ArticleCard key={review.id} title={review.author?.login ?? "unknown"} meta={review.state}>
              <MarkdownBlock value={review.body || "No review body."} compact />
            </ArticleCard>
          )}
        />
      ) : props.tab === "Files" ? (
        <StackedList
          empty="No changed files"
          items={detail.files}
          render={(file) => (
            <div className="file-row" key={file.path}>
              <FileCode2 size={15} />
              <span>{file.path}</span>
              <span className="diff-stat positive">+{file.additions}</span>
              <span className="diff-stat negative">-{file.deletions}</span>
            </div>
          )}
        />
      ) : props.tab === "Commits" ? (
        <StackedList
          empty="No commits"
          items={detail.commits}
          render={(commit) => (
            <div className="commit-row" key={commit.oid}>
              <GitBranch size={15} />
              <span>{commit.messageHeadline}</span>
              <code>{shortSha(commit.oid)}</code>
            </div>
          )}
        />
      ) : (
        <StackedList
          empty="No checks"
          items={detail.checks}
          render={(check) => (
            <div className="check-row" key={`${check.name}-${check.url ?? ""}`}>
              <StatusIcon status={check.status} conclusion={check.conclusion} />
              <span>{check.name}</span>
              <span className={cx("state-chip", statusTone(check.status, check.conclusion))}>
                {check.conclusion ?? check.status ?? "check"}
              </span>
            </div>
          )}
        />
      )}
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

function WorkflowContent(props: { workflow: WorkflowSummary; repo: RepoSummary; onRun(workflow: WorkflowSummary): void }) {
  return (
    <div className="content-scroll">
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
    </div>
  );
}

function WorkflowRunContent(props: {
  detail: WorkflowRunDetail | null;
  fallback: WorkflowRunSummary;
  tab: string;
  onTab(tab: string): void;
}) {
  const run = props.detail ?? props.fallback;
  const tabs = ["Summary", "Jobs", "Artifacts", "Logs"];

  return (
    <div className="content-scroll">
      <div className="detail-heading">
        <div>
          <span className="eyebrow">Workflow run</span>
          <h1>{run.displayTitle || run.name || `Run ${run.id}`}</h1>
        </div>
        <span className={cx("state-chip large-chip", statusTone(run.status, run.conclusion))}>
          {run.conclusion ?? run.status ?? "run"}
        </span>
      </div>
      <TabBar tabs={tabs} selected={props.tab} onSelect={props.onTab} />
      {!props.detail ? (
        <Skeleton />
      ) : props.tab === "Summary" ? (
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
      ) : props.tab === "Jobs" ? (
        <StackedList
          empty="No jobs"
          items={props.detail.jobs}
          render={(job) => (
            <ArticleCard key={job.id} title={job.name} meta={job.conclusion ?? job.status ?? ""}>
              {job.steps.map((step) => (
                <div className="check-row" key={`${job.id}-${step.number}-${step.name}`}>
                  <StatusIcon status={step.status} conclusion={step.conclusion} />
                  <span>{step.name}</span>
                  <span className={cx("state-chip", statusTone(step.status, step.conclusion))}>
                    {step.conclusion ?? step.status ?? "step"}
                  </span>
                </div>
              ))}
            </ArticleCard>
          )}
        />
      ) : props.tab === "Artifacts" ? (
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
      ) : (
        <StackedList
          empty="No jobs"
          items={props.detail.jobs}
          render={(job) => (
            <div className="file-row" key={job.id}>
              <ListChecks size={15} />
              <span>{job.name}</span>
              <span className="muted-line">{job.conclusion ?? job.status ?? "job"}</span>
            </div>
          )}
        />
      )}
    </div>
  );
}

function TabBar(props: { tabs: string[]; selected: string; onSelect(tab: string): void }) {
  return (
    <div className="tab-bar">
      {props.tabs.map((tab) => (
        <button key={tab} className={cx("tab-button", props.selected === tab && "active")} onClick={() => props.onSelect(tab)}>
          {tab}
        </button>
      ))}
    </div>
  );
}

function MarkdownBlock({ value, compact = false }: { value: string; compact?: boolean }) {
  return (
    <div className={cx("markdown-block", compact && "compact")}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
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
        {value}
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

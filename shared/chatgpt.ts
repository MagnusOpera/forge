import type {
  CodexAttachment,
  CodexItem,
  CodexModel,
  CodexTurnTiming,
} from "./codex.js";
export interface ChatProject {
  id: string;
  name: string;
  instructions: string;
}
export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  attachments?: CodexAttachment[];
  images?: CodexAttachment[];
  activity?: CodexItem[];
  timing?: CodexTurnTiming;
  status: "complete" | "streaming" | "stopped" | "failed";
}
export interface ChatThread {
  id: string;
  projectId: string;
  title: string;
  model: string;
  effort?: string;
  speed?: "normal" | "fast";
  updatedAt: number;
  messages: ChatMessage[];
  error?: string;
}
export interface ChatState {
  projects: ChatProject[];
  threads: ChatThread[];
  connected: boolean;
  error?: string;
  models: ({ slug: string; displayName: string } & Partial<
    Omit<CodexModel, "id" | "name">
  >)[];
}
export interface ChatRequests {
  state: { input: undefined; output: ChatState };
  refreshModels: { input: undefined; output: void };
  openLink: { input: { url: string }; output: void };
  project: {
    input: { id?: string; name: string; instructions: string };
    output: ChatProject;
  };
  reorderProjects: {
    input: { sourceId: string; targetId: string };
    output: void;
  };
  deleteProject: { input: { id: string }; output: boolean };
  create: { input: { projectId: string; model: string }; output: ChatThread };
  rename: { input: { id: string; title: string }; output: void };
  delete: { input: { id: string }; output: void };
  attach: {
    input: {
      id: string;
      paths?: string[];
      files?: { name: string; data: Uint8Array }[];
    };
    output: CodexAttachment[];
  };
  openAttachment: { input: { id: string; attachmentId: string }; output: void };
  attachmentImage: {
    input: { id: string; attachmentId: string };
    output: string;
  };
  saveAttachment: { input: { id: string; attachmentId: string }; output: void };
  send: {
    input: {
      id: string;
      text: string;
      model: string;
      attachments?: CodexAttachment[];
      effort?: string;
      speed?: "normal" | "fast";
    };
    output: void;
  };
  stop: { input: { id: string }; output: void };
}
export interface ChatApi {
  attachFiles?(
    input: { id: string },
    files: File[],
  ): Promise<CodexAttachment[]>;
  request<K extends keyof ChatRequests>(
    method: K,
    input: ChatRequests[K]["input"],
  ): Promise<ChatRequests[K]["output"]>;
  onChanged(callback: (state: ChatState) => void): () => void;
}

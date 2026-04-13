export type Role = "user" | "assistant" | "tool";
export type AgentMode = "main" | "subagent";

export type TranscriptMessage = {
  role: Role;
  text: string;
  toolName?: string;
};

export type Session = {
  id: string;
  transcript: TranscriptMessage[];
};

export type Skill = {
  id: string;
  title: string;
  summary: string;
  filePath: string;
  prompt: string;
};

export type ToolCall = {
  id: string;
  name: string;
  args: Record<string, unknown>;
};

export type ModelMessage =
  | {
      role: "system" | "user" | "assistant";
      content: string;
    }
  | {
      role: "assistant";
      content: string;
      toolCalls: ToolCall[];
    }
  | {
      role: "tool";
      content: string;
      toolName: string;
      toolCallId: string;
    };

export type AgentTool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute(args: Record<string, unknown>): Promise<string>;
};

export type ToolResult = {
  callId: string;
  toolName: string;
  text: string;
};

export type ModelStreamEvent =
  | { type: "reasoning_delta"; text: string }
  | { type: "text_delta"; text: string }
  | { type: "tool_call"; call: ToolCall }
  | { type: "done" };

export type ModelTurnContext = {
  messages: ModelMessage[];
  tools: AgentTool[];
  mode: AgentMode;
};

export type AgentEvent =
  | { type: "lifecycle"; phase: "start" | "end"; sessionId: string; runId: string }
  | { type: "reasoning_delta"; sessionId: string; runId: string; text: string; fullText: string }
  | { type: "assistant_delta"; sessionId: string; runId: string; text: string; fullText: string }
  | { type: "skills_catalog"; sessionId: string; runId: string; skills: Skill[] }
  | {
      type: "subagent";
      phase: "spawned" | "completed";
      parentSessionId: string;
      childSessionId: string;
      runId: string;
      label: string;
      text?: string;
    }
  | { type: "tool_start"; sessionId: string; runId: string; call: ToolCall }
  | { type: "tool_end"; sessionId: string; runId: string; result: ToolResult };

import { randomUUID } from "node:crypto";
import { EventBus } from "./event-bus.js";
import { SessionStore } from "./session-store.js";
import { buildMiniSystemPrompt } from "./skills.js";
import type {
  AgentMode,
  AgentTool,
  ModelMessage,
  ModelStreamEvent,
  ModelTurnContext,
  Skill,
  ToolCall,
  ToolResult,
} from "./types.js";

type TurnModel = {
  streamTurn(context: ModelTurnContext): AsyncGenerator<ModelStreamEvent>;
};

type SpawnedSubagent = {
  label: string;
  task: string;
  sessionId: string;
  status: "pending" | "completed";
  finalText?: string;
};

export class AgentRunner {
  constructor(
    private readonly sessions: SessionStore,
    private readonly events: EventBus,
    private readonly model: TurnModel,
    private readonly tools: AgentTool[],
    private readonly skills: Skill[],
    private readonly options?: {
      mode?: AgentMode;
      depth?: number;
      maxSubagentDepth?: number;
    },
  ) {}

  async run(params: { sessionId: string; message: string }) {
    const runId = randomUUID();
    const session = this.sessions.getOrCreate(params.sessionId);
    const modelMessages = this.buildModelMessages(session.id, params.message);

    this.sessions.append(session.id, {
      role: "user",
      text: params.message,
    });

    this.events.emit({
      type: "lifecycle",
      phase: "start",
      sessionId: session.id,
      runId,
    });
    this.events.emit({
      type: "skills_catalog",
      sessionId: session.id,
      runId,
      skills: this.skills,
    });

    let assistantText = "";
    let reasoningText = "";
    const spawnedChildren: SpawnedSubagent[] = [];

    for (let step = 0; step < 8; step += 1) {
      let requestedTool: ToolCall | null = null;

      for await (const event of this.model.streamTurn({
        messages: modelMessages,
        tools: this.tools,
        mode: this.options?.mode ?? "main",
      })) {
        if (event.type === "reasoning_delta") {
          reasoningText += event.text;
          this.events.emit({
            type: "reasoning_delta",
            sessionId: session.id,
            runId,
            text: event.text,
            fullText: reasoningText,
          });
          continue;
        }

        if (event.type === "text_delta") {
          assistantText += event.text;
          this.events.emit({
            type: "assistant_delta",
            sessionId: session.id,
            runId,
            text: event.text,
            fullText: assistantText,
          });
          continue;
        }

        if (event.type === "tool_call") {
          requestedTool = event.call;
          modelMessages.push({
            role: "assistant",
            content: assistantText,
            toolCalls: [event.call],
          });
          break;
        }

        if (event.type === "done") {
          this.sessions.append(session.id, {
            role: "assistant",
            text: assistantText,
          });
          this.events.emit({
            type: "lifecycle",
            phase: "end",
            sessionId: session.id,
            runId,
          });
          return {
            runId,
            session,
            finalText: assistantText,
          };
        }
      }

      if (!requestedTool) {
        break;
      }

      const toolResult = await this.runTool(session.id, runId, requestedTool, spawnedChildren);
      this.sessions.append(session.id, {
        role: "tool",
        text: toolResult.text,
        toolName: toolResult.toolName,
      });
      modelMessages.push({
        role: "tool",
        content: toolResult.text,
        toolName: toolResult.toolName,
        toolCallId: toolResult.callId,
      });
    }

    throw new Error("Agent loop exited unexpectedly.");
  }

  private buildModelMessages(sessionId: string, userMessage: string): ModelMessage[] {
    const session = this.sessions.read(sessionId);
    const messages: ModelMessage[] = [
      {
        role: "system",
        content: buildMiniSystemPrompt(this.skills, this.options?.mode ?? "main"),
      },
    ];

    for (const message of session.transcript) {
      if (message.role === "tool" && message.toolName) {
        messages.push({
          role: "tool",
          content: message.text,
          toolName: message.toolName,
          toolCallId: "previous",
        });
        continue;
      }
      messages.push({
        role: message.role,
        content: message.text,
      });
    }

    messages.push({
      role: "user",
      content: userMessage,
    });

    return messages;
  }

  private async runTool(
    sessionId: string,
    runId: string,
    call: ToolCall,
    spawnedChildren: SpawnedSubagent[],
  ): Promise<ToolResult> {
    if (call.name === "spawn_subagent") {
      return this.spawnSubagent(sessionId, runId, call, spawnedChildren);
    }
    if (call.name === "wait_subagents") {
      return this.waitForSubagents(sessionId, runId, call, spawnedChildren);
    }

    const tool = this.tools.find((entry) => entry.name === call.name);
    if (!tool) {
      throw new Error(`Unknown tool: ${call.name}`);
    }

    this.events.emit({
      type: "tool_start",
      sessionId,
      runId,
      call,
    });

    const text = await tool.execute(call.args);
    const result: ToolResult = {
      callId: call.id,
      toolName: call.name,
      text,
    };

    this.events.emit({
      type: "tool_end",
      sessionId,
      runId,
      result,
    });

    return result;
  }

  private async spawnSubagent(
    sessionId: string,
    runId: string,
    call: ToolCall,
    spawnedChildren: SpawnedSubagent[],
  ): Promise<ToolResult> {
    const currentDepth = this.options?.depth ?? 0;
    const maxDepth = this.options?.maxSubagentDepth ?? 1;
    if (currentDepth >= maxDepth) {
      return {
        callId: call.id,
        toolName: call.name,
        text: "Subagent spawn blocked: max depth reached.",
      };
    }

    const label = typeof call.args.label === "string" ? call.args.label : "worker";
    const task = typeof call.args.task === "string" ? call.args.task : "Handle the delegated task.";
    const childSessionId = `${sessionId}:subagent:${label}`;

    spawnedChildren.push({
      label,
      task,
      sessionId: childSessionId,
      status: "pending",
    });

    this.events.emit({
      type: "subagent",
      phase: "spawned",
      parentSessionId: sessionId,
      childSessionId,
      runId,
      label,
    });

    return {
      callId: call.id,
      toolName: call.name,
      text: `Spawned subagent ${label} (${childSessionId}).`,
    };
  }

  private async waitForSubagents(
    sessionId: string,
    runId: string,
    call: ToolCall,
    spawnedChildren: SpawnedSubagent[],
  ): Promise<ToolResult> {
    const pending = spawnedChildren.filter((entry) => entry.status === "pending");
    if (pending.length === 0) {
      return {
        callId: call.id,
        toolName: call.name,
        text: "No pending subagents.",
      };
    }

    const summaries: string[] = [];
    const childTools = this.tools.filter(
      (tool) => tool.name !== "spawn_subagent" && tool.name !== "wait_subagents",
    );

    for (const child of pending) {
      const childRunner = new AgentRunner(
        this.sessions,
        this.events,
        this.model,
        childTools,
        this.skills,
        {
          mode: "subagent",
          depth: (this.options?.depth ?? 0) + 1,
          maxSubagentDepth: this.options?.maxSubagentDepth ?? 1,
        },
      );

      const result = await childRunner.run({
        sessionId: child.sessionId,
        message: child.task,
      });

      child.status = "completed";
      child.finalText = result.finalText;
      summaries.push(`${child.label}: ${result.finalText}`);

      this.events.emit({
        type: "subagent",
        phase: "completed",
        parentSessionId: sessionId,
        childSessionId: child.sessionId,
        runId,
        label: child.label,
        text: result.finalText,
      });
    }

    return {
      callId: call.id,
      toolName: call.name,
      text: summaries.join(" "),
    };
  }
}

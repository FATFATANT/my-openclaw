import crypto from "node:crypto";
import type {
  AnyAgentTool,
  OpenClawPluginApi,
  OpenClawPluginToolContext,
} from "openclaw/plugin-sdk/plugin-entry";
import { jsonResult } from "openclaw/plugin-sdk/tool-results";
import { Type } from "typebox";

export const WORKBENCH_MENU_TOOL = "workbench_delegate_menu_search";
export const WORKBENCH_FORM_TOOL = "workbench_delegate_form_assistance";
export const WORKBENCH_TOOL_BRIDGE_BINDING = "workbenchToolBridge";

export type WorkbenchProgress = {
  phase: string;
  text: string;
  agentId?: string;
  skill?: string;
  tool?: string;
};

export type WorkbenchToolBridge = {
  onProgress: (progress: WorkbenchProgress) => void;
  onStructuredResult: (tool: string, result: unknown) => void;
};

type DelegationConfig = {
  parentAgentId: string;
  model: string;
};

function splitModel(ref: string): { provider: string; model: string } {
  const slash = ref.indexOf("/");
  if (slash <= 0 || slash === ref.length - 1) {
    throw new Error(`invalid provider/model: ${ref}`);
  }
  return { provider: ref.slice(0, slash), model: ref.slice(slash + 1) };
}

function delegatedSessionId(parentSessionId: string, targetAgentId: string): string {
  const hex = crypto
    .createHash("sha256")
    .update(`${parentSessionId}:${targetAgentId}`)
    .digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function finalText(
  result: Awaited<ReturnType<OpenClawPluginApi["runtime"]["agent"]["runEmbeddedAgent"]>>,
): string {
  return (result.payloads ?? [])
    .filter((payload) => !payload.isReasoning && !payload.isError)
    .map((payload) => payload.text ?? "")
    .filter(Boolean)
    .join("\n");
}

function requestParam(raw: unknown): { request: string; context?: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("request is required");
  }
  const value = raw as Record<string, unknown>;
  const request = typeof value.request === "string" ? value.request.trim() : "";
  const context = typeof value.context === "string" ? value.context.trim() : "";
  if (!request) {
    throw new Error("request is required");
  }
  return { request, ...(context ? { context } : {}) };
}

function toolResultText(value: string): unknown {
  const trimmed = value.trim();
  const candidate = trimmed.startsWith("```json")
    ? trimmed.slice(7, trimmed.endsWith("```") ? -3 : undefined).trim()
    : trimmed.startsWith("```")
      ? trimmed.slice(3, trimmed.endsWith("```") ? -3 : undefined).trim()
      : trimmed;
  try {
    return JSON.parse(candidate) as unknown;
  } catch {
    return { schema: "workbench.response.v1", type: "text", message: trimmed };
  }
}

function toolBridge(context: OpenClawPluginToolContext): WorkbenchToolBridge | undefined {
  const value = context.toolBindings?.[WORKBENCH_TOOL_BRIDGE_BINDING];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const bridge = value as Partial<WorkbenchToolBridge>;
  return typeof bridge.onProgress === "function" && typeof bridge.onStructuredResult === "function"
    ? (bridge as WorkbenchToolBridge)
    : undefined;
}

function delegatedTask(targetAgentId: string): { label: string; skill: string } {
  return targetAgentId === "menu-search"
    ? { label: "菜单搜索", skill: "menu-search" }
    : { label: "辅助填单", skill: "survey-form-assistance" };
}

async function runDelegate(params: {
  api: OpenClawPluginApi;
  context: OpenClawPluginToolContext;
  config: DelegationConfig;
  targetAgentId: string;
  sourceTool: string;
  request: string;
  businessContext?: string;
}): Promise<unknown> {
  const senderId = params.context.requesterSenderId;
  const parentSessionId = params.context.sessionId;
  if (!senderId || !parentSessionId) {
    throw new Error(
      "This delegation tool is only available in an authenticated Workbench session.",
    );
  }
  const cfg = structuredClone(params.api.runtime.config.current()) as unknown as Parameters<
    typeof params.api.runtime.agent.resolveAgentWorkspaceDir
  >[0];
  const workspaceDir = params.api.runtime.agent.resolveAgentWorkspaceDir(cfg, params.targetAgentId);
  const sessionId = delegatedSessionId(parentSessionId, params.targetAgentId);
  const sessionKey = `agent:${params.targetAgentId}:workbench:${senderId}:${sessionId}`;
  const prompt = params.businessContext
    ? `${params.request}\n\n已知业务上下文：\n${params.businessContext}`
    : params.request;
  const { provider, model } = splitModel(params.config.model);
  const bridge = toolBridge(params.context);
  const task = delegatedTask(params.targetAgentId);
  bridge?.onProgress({
    phase: "delegating",
    text: `已识别为${task.label}任务，正在调用${task.label}智能体...`,
    agentId: params.targetAgentId,
  });
  bridge?.onProgress({
    phase: "skill",
    text: `已加载 ${task.skill} Skill，正在分析任务...`,
    agentId: params.targetAgentId,
    skill: task.skill,
  });
  const result = await params.api.runtime.agent.runEmbeddedAgent({
    sessionId,
    sessionKey,
    sandboxSessionKey: sessionKey,
    agentId: params.targetAgentId,
    senderId,
    senderIsOwner: false,
    messageProvider: "workbench",
    workspaceDir,
    config: cfg,
    prompt,
    transcriptPrompt: prompt,
    inputProvenance: {
      kind: "inter_session",
      sourceSessionKey: params.context.sessionKey,
      sourceChannel: params.context.messageChannel ?? "workbench",
      sourceTool: params.sourceTool,
    },
    provider,
    model,
    timeoutMs: params.api.runtime.agent.resolveAgentTimeoutMs({ cfg }),
    runId: crypto.randomUUID(),
    trigger: "manual",
    onExecutionPhase: (event) => {
      if (event.phase === "model_call_started") {
        bridge?.onProgress({
          phase: "agent",
          text: `${task.label}智能体正在理解业务上下文...`,
          agentId: params.targetAgentId,
          skill: task.skill,
        });
      }
    },
    onAgentEvent: (event) => {
      if (event.stream !== "tool") {
        return;
      }
      if (event.data.phase !== "start" && event.data.phase !== "result") {
        return;
      }
      const name = typeof event.data.name === "string" ? event.data.name : "业务工具";
      const label = typeof event.data.label === "string" ? event.data.label : name;
      const progressText =
        typeof event.data.progressText === "string" ? event.data.progressText : undefined;
      bridge?.onProgress({
        phase: "tool",
        text:
          progressText ??
          (event.data.phase === "start" ? `正在调用「${label}」...` : `「${label}」调用完成`),
        agentId: params.targetAgentId,
        skill: task.skill,
        tool: name,
      });
    },
  });
  const structured = toolResultText(finalText(result));
  bridge?.onStructuredResult(params.sourceTool, structured);
  bridge?.onProgress({
    phase: "result",
    text: `${task.label}已完成，正在整理结果...`,
    agentId: params.targetAgentId,
    skill: task.skill,
  });
  return structured;
}

const DELEGATION_PARAMETERS = Type.Object(
  {
    request: Type.String({ description: "The user's complete request to delegate." }),
    context: Type.Optional(
      Type.String({ description: "Known business context needed for the task." }),
    ),
  },
  { additionalProperties: false },
);

export function createWorkbenchDelegationTools(params: {
  api: OpenClawPluginApi;
  context: OpenClawPluginToolContext;
  config: DelegationConfig;
}): AnyAgentTool[] | null {
  if (params.context.agentId !== params.config.parentAgentId) {
    return null;
  }

  const delegate = (targetAgentId: string, sourceTool: string, raw: unknown) => {
    const input = requestParam(raw);
    return runDelegate({
      ...params,
      targetAgentId,
      sourceTool,
      request: input.request,
      businessContext: input.context,
    });
  };

  return [
    {
      name: WORKBENCH_MENU_TOOL,
      label: "菜单搜索",
      description: "将菜单、页面或功能入口查询交给菜单搜索智能体，并返回工作台菜单卡片数据。",
      parameters: DELEGATION_PARAMETERS,
      execute: async (_toolCallId, raw) =>
        jsonResult(await delegate("menu-search", WORKBENCH_MENU_TOOL, raw)),
    },
    {
      name: WORKBENCH_FORM_TOOL,
      label: "辅助填单",
      description: "将调查报告或调查表的读取、草稿生成、检查与确认后写入交给辅助填单智能体。",
      parameters: DELEGATION_PARAMETERS,
      execute: async (_toolCallId, raw) =>
        jsonResult(await delegate("form-assistant", WORKBENCH_FORM_TOOL, raw)),
    },
  ];
}

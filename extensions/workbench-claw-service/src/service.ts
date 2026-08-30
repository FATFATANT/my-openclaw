import crypto from "node:crypto";
import fs from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import type {
  OpenClawPluginApi,
  OpenClawPluginToolContext,
} from "openclaw/plugin-sdk/plugin-entry";
import { runDetachedWebhookWork } from "openclaw/plugin-sdk/webhook-request-guards";
import {
  createWorkbenchDelegationTools,
  WORKBENCH_FORM_TOOL,
  WORKBENCH_MENU_TOOL,
  WORKBENCH_TOOL_BRIDGE_BINDING,
  type WorkbenchToolBridge,
} from "./delegation-tools.js";
import {
  issueClawToken,
  verifyClawToken,
  verifyWorkbenchToken,
  type WorkbenchIdentity,
} from "./token.js";

type ServiceConfig = {
  defaultAgentId?: string;
  model: string;
  mcpUrl: string;
  clawTokenTtlSeconds: number;
  runRetentionSeconds: number;
};

type Session = {
  id: string;
  owner: string;
  title: string;
  agentId?: string;
  activeDomainAgentId?: string;
  lastInterruption?: { question: string; partialText: string; interruptedAt: number };
  createdAt: number;
};

type SkillSelection = { name: string; path: string };

type RunEvent = {
  id: number;
  type:
    | "status"
    | "reasoning"
    | "answer_delta"
    | "answer_snapshot"
    | "final"
    | "interrupted"
    | "error"
    | "complete";
  data: unknown;
};

type Run = {
  id: string;
  owner: string;
  sessionId: string;
  createdAt: number;
  events: RunEvent[];
  subscribers: Set<(event: RunEvent) => void>;
  completed: boolean;
  question: string;
  abortController: AbortController;
  interrupted: boolean;
};

const BASE_PATH = "/api/v1/workbench";
const MAX_BODY_BYTES = 1024 * 1024;

function shouldLeaveFormAssistance(question: string): boolean {
  const text = question.trim();
  if (!text) return false;
  const stillFormRelated =
    /(调查报告|调查表|客户号|确认选择客户|确认选择报告|reportId|runId|sectionCode|一码授权|模块|已上传)/i.test(
      text,
    );
  if (stillFormRelated) return false;
  return /^(?:你好|在吗|你是谁|介绍一下|今天天气)|(菜单|页面|入口|在哪里|怎么进)/.test(text);
}

function asksForSurveyCustomer(text: string): boolean {
  return /(哪家|哪个).{0,8}(客户|公司).{0,12}调查报告|(客户|公司).{0,8}(名称|简称)/.test(text);
}

function startsSurveyAssistance(question: string): boolean {
  return /(调查报告|调查表)/.test(question) && /(填|辅助|维护|处理)/.test(question);
}

type RegisteredRequesterIdentity = WorkbenchIdentity & { expiresAt: number };

function identityRegistryPath(): string {
  const stateDir = process.env.OPENCLAW_STATE_DIR?.trim();
  if (!stateDir) {
    throw new Error("OPENCLAW_STATE_DIR is required for workbench requester identities");
  }
  return path.join(stateDir, "workbench-requester-identities.json");
}

function readRequesterIdentities(): Record<string, RegisteredRequesterIdentity> {
  try {
    const parsed = JSON.parse(fs.readFileSync(identityRegistryPath(), "utf8")) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, RegisteredRequesterIdentity>)
      : {};
  } catch {
    return {};
  }
}

function registerRequesterIdentity(user: WorkbenchIdentity, ttlSeconds: number): void {
  const now = Math.floor(Date.now() / 1000);
  const identities = Object.fromEntries(
    Object.entries(readRequesterIdentities()).filter(([, identity]) => identity.expiresAt > now),
  );
  identities[user.sub] = { ...user, expiresAt: now + ttlSeconds };
  const target = identityRegistryPath();
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  const temporary = `${target}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(identities)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  fs.renameSync(temporary, target);
}

function resolveRequesterIdentity(senderId: string): WorkbenchIdentity | null {
  const identity = readRequesterIdentities()[senderId];
  if (!identity || identity.expiresAt <= Math.floor(Date.now() / 1000)) return null;
  return {
    sub: identity.sub,
    name: identity.name,
    role: identity.role,
    lineCodes: identity.lineCodes,
    positionCodes: identity.positionCodes,
  };
}

function resolveConfig(api: OpenClawPluginApi): ServiceConfig {
  const raw = api.pluginConfig ?? {};
  return {
    defaultAgentId: typeof raw.defaultAgentId === "string" ? raw.defaultAgentId : undefined,
    model: typeof raw.model === "string" ? raw.model : "deepseek/deepseek-v4-flash",
    mcpUrl: typeof raw.mcpUrl === "string" ? raw.mcpUrl : "http://127.0.0.1:8080/mcp",
    clawTokenTtlSeconds:
      typeof raw.clawTokenTtlSeconds === "number" ? raw.clawTokenTtlSeconds : 3600,
    runRetentionSeconds:
      typeof raw.runRetentionSeconds === "number" ? raw.runRetentionSeconds : 3600,
  };
}

function resolveSecret(): string {
  const secret =
    process.env.OPENCLAW_WORKBENCH_TOKEN_SECRET ?? process.env.AI_WORKBENCH_SHARED_TOKEN_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error(
      "OPENCLAW_WORKBENCH_TOKEN_SECRET (or AI_WORKBENCH_SHARED_TOKEN_SECRET) must be at least 16 characters",
    );
  }
  return secret;
}

function json(res: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  });
  res.end(body);
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += buffer.length;
    if (length > MAX_BODY_BYTES) throw new Error("request body is too large");
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {};
  const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("request body must be a JSON object");
  }
  return parsed as Record<string, unknown>;
}

function bearer(req: IncomingMessage): string | null {
  const value = req.headers.authorization;
  if (!value?.startsWith("Bearer ")) return null;
  return value.slice(7).trim() || null;
}

function routePath(req: IncomingMessage): string {
  return new URL(req.url ?? "/", "http://localhost").pathname;
}

function textField(
  body: Record<string, unknown>,
  name: string,
  required = true,
): string | undefined {
  const value = body[name];
  if (typeof value === "string" && value.trim()) return value.trim();
  if (required) throw new Error(`${name} is required`);
  return undefined;
}

function skillSelections(body: Record<string, unknown>): SkillSelection[] | undefined {
  if (body.skills === undefined) return undefined;
  if (!Array.isArray(body.skills)) throw new Error("skills must be an array");
  return body.skills.map((item) => {
    if (!item || typeof item !== "object") throw new Error("each skill must be an object");
    const value = item as Record<string, unknown>;
    const name = textField(value, "name");
    const path = textField(value, "path");
    return { name: name!, path: path! };
  });
}

function splitModel(ref: string): { provider: string; model: string } {
  const slash = ref.indexOf("/");
  if (slash <= 0 || slash === ref.length - 1) throw new Error(`invalid provider/model: ${ref}`);
  return { provider: ref.slice(0, slash), model: ref.slice(slash + 1) };
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

export function createWorkbenchClawService(api: OpenClawPluginApi) {
  const config = resolveConfig(api);
  const secret = resolveSecret();
  const sessions = new Map<string, Session>();
  const runs = new Map<string, Run>();

  const emit = (run: Run, type: RunEvent["type"], data: unknown) => {
    const event = { id: run.events.length + 1, type, data } satisfies RunEvent;
    run.events.push(event);
    for (const subscriber of run.subscribers) subscriber(event);
  };

  const identity = (req: IncomingMessage): WorkbenchIdentity | null => {
    const token = bearer(req);
    return token ? verifyClawToken(token, secret) : null;
  };

  const cleanup = () => {
    const cutoff = Date.now() - config.runRetentionSeconds * 1000;
    for (const [id, run] of runs) {
      if (run.completed && run.createdAt < cutoff) runs.delete(id);
    }
  };

  const execute = async (
    run: Run,
    session: Session,
    user: WorkbenchIdentity,
    question: string,
    agentId: string | undefined,
    skills: SkillSelection[] | undefined,
  ) => {
    emit(run, "status", { phase: "intent", text: "正在识别您的需求..." });
    try {
      if (
        !agentId &&
        !session.agentId &&
        session.activeDomainAgentId === "form-assistant" &&
        shouldLeaveFormAssistance(question)
      ) {
        delete session.activeDomainAgentId;
      }
      const selectedAgent =
        agentId ??
        session.agentId ??
        session.activeDomainAgentId ??
        config.defaultAgentId ??
        "main";
      const continuingFormAssistance =
        !agentId && !session.agentId && session.activeDomainAgentId === "form-assistant";
      if (continuingFormAssistance) {
        emit(run, "status", {
          phase: "agent",
          text: "正在继续使用辅助填单智能体...",
          agentId: "form-assistant",
        });
      }
      const baseAgentPrompt = continuingFormAssistance
        ? `当前正在继续调查报告辅助填写任务。用户上一轮已被要求补充客户或继续卡片步骤，请把下面内容作为该任务的后续回答处理：\n\n${question}`
        : question;
      const previousInterruption = session.lastInterruption;
      delete session.lastInterruption;
      const agentPrompt = previousInterruption
        ? [
            "上一轮回答被用户主动停止。请结合已经展示给用户的进度继续理解本轮问题，不要机械地从头重复上一轮回答。",
            `上一轮问题：${previousInterruption.question}`,
            `停止前已展示内容：${previousInterruption.partialText || "（尚未生成正文）"}`,
            `本轮用户问题：${baseAgentPrompt}`,
          ].join("\n\n")
        : baseAgentPrompt;
      const cfg = structuredClone(api.runtime.config.current()) as unknown as Parameters<
        typeof api.runtime.agent.resolveAgentWorkspaceDir
      >[0];
      const workspaceDir = api.runtime.agent.resolveAgentWorkspaceDir(cfg, selectedAgent);
      const { provider, model } = splitModel(config.model);
      const sessionKey = `agent:${selectedAgent}:workbench:${user.sub}:${session.id}`;
      let structuredWorkbenchResult: unknown;
      const toolBridge: WorkbenchToolBridge = {
        abortSignal: run.abortController.signal,
        onProgress: (progress) => emit(run, "status", progress),
        onStructuredResult: (tool, result) => {
          if (tool === WORKBENCH_MENU_TOOL || tool === WORKBENCH_FORM_TOOL) {
            structuredWorkbenchResult = result;
          }
          if (tool === WORKBENCH_FORM_TOOL) {
            session.activeDomainAgentId = "form-assistant";
          }
        },
      };
      const result = await api.runtime.agent.runEmbeddedAgent({
        sessionId: session.id,
        sessionKey,
        sandboxSessionKey: sessionKey,
        agentId: selectedAgent,
        senderId: user.sub,
        senderIsOwner: false,
        messageProvider: "workbench",
        toolBindings: { [WORKBENCH_TOOL_BRIDGE_BINDING]: toolBridge },
        workspaceDir,
        config: cfg,
        prompt: agentPrompt,
        transcriptPrompt: question,
        inputProvenance: { kind: "external_user", sourceChannel: "workbench" },
        provider,
        model,
        explicitSkillSelections: skills,
        timeoutMs: api.runtime.agent.resolveAgentTimeoutMs({ cfg }),
        runId: run.id,
        trigger: "user",
        abortSignal: run.abortController.signal,
        reasoningLevel: "stream",
        streamReasoningInNonStreamModes: true,
        onExecutionPhase: (event) => {
          if (event.phase === "model_call_started") {
            emit(run, "status", {
              phase: "agent",
              text:
                selectedAgent === "form-assistant"
                  ? "辅助填单智能体正在理解业务上下文..."
                  : selectedAgent === "menu-search"
                    ? "菜单搜索智能体正在理解您的需求..."
                    : "业务智能体正在分析您的需求...",
              agentId: selectedAgent,
            });
          }
        },
        onAgentEvent: (event) => {
          if (event.stream !== "tool") return;
          if (event.data.phase !== "start" && event.data.phase !== "result") return;
          const name = typeof event.data.name === "string" ? event.data.name : "业务工具";
          const label = typeof event.data.label === "string" ? event.data.label : name;
          const progressText =
            typeof event.data.progressText === "string" ? event.data.progressText : undefined;
          emit(run, "status", {
            phase: "tool",
            text:
              progressText ??
              (event.data.phase === "start" ? `正在调用「${label}」...` : `「${label}」调用完成`),
            agentId: selectedAgent,
            tool: name,
          });
        },
        onReasoningStream: (payload) => {
          if (!run.interrupted && payload.text) emit(run, "reasoning", { text: payload.text });
        },
        onPartialReply: (payload) => {
          if (run.interrupted) return;
          if (payload.delta) emit(run, "answer_delta", { delta: payload.delta });
          else if (payload.text) emit(run, "answer_snapshot", { text: payload.text });
        },
      });
      if (run.interrupted || run.abortController.signal.aborted) {
        emit(run, "interrupted", { runId: run.id });
        return;
      }
      const answerText = finalText(result);
      if (
        selectedAgent === (config.defaultAgentId ?? "main") &&
        (startsSurveyAssistance(question) || asksForSurveyCustomer(answerText))
      ) {
        // The next short reply is normally only a customer name. Keep it in the
        // form domain so it does not pay for another main-agent routing turn.
        session.activeDomainAgentId = "form-assistant";
      }
      emit(run, "final", {
        text:
          structuredWorkbenchResult === undefined
            ? answerText
            : JSON.stringify(structuredWorkbenchResult),
        provider: result.meta.agentMeta?.provider,
        model: result.meta.agentMeta?.model,
        usage: result.meta.agentMeta?.usage,
      });
    } catch (error) {
      if (run.interrupted || run.abortController.signal.aborted) {
        emit(run, "interrupted", { runId: run.id });
      } else {
        api.logger.error(`workbench run ${run.id} failed: ${String(error)}`);
        emit(run, "error", {
          message: error instanceof Error ? error.message : String(error),
        });
      }
    } finally {
      run.completed = true;
      emit(run, "complete", { runId: run.id });
    }
  };

  const stream = (req: IncomingMessage, res: ServerResponse, run: Run) => {
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    const write = (event: RunEvent) => {
      res.write(`id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`);
      if (event.type === "complete") {
        close();
        res.end();
      }
    };
    const close = () => {
      if (heartbeat) clearInterval(heartbeat);
      run.subscribers.delete(write);
    };
    const lastId = Number(req.headers["last-event-id"] ?? 0);
    for (const event of run.events) if (event.id > lastId) write(event);
    if (run.completed) {
      res.end();
      return;
    }
    run.subscribers.add(write);
    heartbeat = setInterval(() => res.write(": keepalive\n\n"), 15_000);
    req.on("close", close);
  };

  const handleRequest = async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
    const path = routePath(req);
    if (!path.startsWith(BASE_PATH)) return false;
    try {
      if (req.method === "POST" && path === `${BASE_PATH}/token/exchange`) {
        const body = await readJson(req);
        const rawToken = textField(body, "token")!;
        const user = verifyWorkbenchToken(rawToken, secret);
        if (!user) {
          json(res, 401, { code: "INVALID_WORKBENCH_TOKEN" });
          return true;
        }
        registerRequesterIdentity(user, config.clawTokenTtlSeconds);
        api.logger.info(`workbench requester identity registered: senderId=${user.sub}`);
        const issued = issueClawToken(user, secret, config.clawTokenTtlSeconds);
        json(res, 200, {
          clawToken: issued.token,
          expiresAt: issued.expiresAt,
        });
        return true;
      }

      const user = identity(req);
      if (!user) {
        json(res, 401, { code: "INVALID_CLAW_TOKEN" });
        return true;
      }

      if (req.method === "POST" && path === `${BASE_PATH}/sessions`) {
        const body = await readJson(req);
        const session: Session = {
          id: crypto.randomUUID(),
          owner: user.sub,
          title: textField(body, "title")!,
          agentId: textField(body, "agentId", false),
          createdAt: Date.now(),
        };
        sessions.set(session.id, session);
        json(res, 201, { sessionId: session.id });
        return true;
      }

      const appendMatch = path.match(/^\/api\/v1\/workbench\/sessions\/([^/]+)\/runs$/);
      if (req.method === "POST" && appendMatch) {
        const session = sessions.get(decodeURIComponent(appendMatch[1]!));
        if (!session || session.owner !== user.sub) {
          json(res, 404, { code: "SESSION_NOT_FOUND" });
          return true;
        }
        const body = await readJson(req);
        const question = textField(body, "question")!;
        const agentId = textField(body, "agentId", false);
        const skills = skillSelections(body);
        const run: Run = {
          id: crypto.randomUUID(),
          owner: user.sub,
          sessionId: session.id,
          createdAt: Date.now(),
          events: [],
          subscribers: new Set(),
          completed: false,
          question,
          abortController: new AbortController(),
          interrupted: false,
        };
        runs.set(run.id, run);
        cleanup();
        void runDetachedWebhookWork(() => execute(run, session, user, question, agentId, skills));
        json(res, 202, { runId: run.id });
        return true;
      }

      const cancelMatch = path.match(/^\/api\/v1\/workbench\/runs\/([^/]+)\/cancel$/);
      if (req.method === "POST" && cancelMatch) {
        const run = runs.get(decodeURIComponent(cancelMatch[1]!));
        if (!run || run.owner !== user.sub) {
          json(res, 404, { code: "RUN_NOT_FOUND" });
          return true;
        }
        const body = await readJson(req);
        const partialText = textField(body, "partialText", false) ?? "";
        if (!run.completed && !run.interrupted) {
          run.interrupted = true;
          const session = sessions.get(run.sessionId);
          if (session) {
            session.lastInterruption = {
              question: run.question,
              partialText,
              interruptedAt: Date.now(),
            };
          }
          emit(run, "status", { phase: "interrupted", text: "用户已停止本轮回答" });
          run.abortController.abort(new Error("workbench_user_interrupted"));
        }
        json(res, 200, { runId: run.id, cancelled: run.interrupted });
        return true;
      }

      const trackMatch = path.match(/^\/api\/v1\/workbench\/runs\/([^/]+)\/events$/);
      if (req.method === "GET" && trackMatch) {
        const run = runs.get(decodeURIComponent(trackMatch[1]!));
        if (!run || run.owner !== user.sub) {
          json(res, 404, { code: "RUN_NOT_FOUND" });
          return true;
        }
        stream(req, res, run);
        return true;
      }

      json(res, 404, { code: "NOT_FOUND" });
      return true;
    } catch (error) {
      json(res, 400, {
        code: "BAD_REQUEST",
        message: error instanceof Error ? error.message : String(error),
      });
      return true;
    }
  };

  return {
    handleRequest,
    createDelegationTools: (context: OpenClawPluginToolContext) =>
      createWorkbenchDelegationTools({
        api,
        context,
        config: {
          parentAgentId: config.defaultAgentId ?? "micro-business",
          model: config.model,
        },
      }),
    resolveMcpConnection: ({ requesterSenderId }: { requesterSenderId: string }) => {
      const user = resolveRequesterIdentity(requesterSenderId);
      if (!user) {
        api.logger.warn(`workbench MCP connection denied: requesterSenderId=${requesterSenderId}`);
        return null;
      }
      const token = issueClawToken(user, secret, config.clawTokenTtlSeconds).token;
      api.logger.info("workbench MCP connection resolved for authenticated requester");
      return {
        url: config.mcpUrl,
        headers: { Authorization: `Bearer ${token}` },
      };
    },
  };
}

import crypto from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import { runDetachedWebhookWork } from "openclaw/plugin-sdk/webhook-request-guards";
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
};

const BASE_PATH = "/api/v1/workbench";
const MAX_BODY_BYTES = 1024 * 1024;

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
  const identities = new Map<string, WorkbenchIdentity>();

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
    emit(run, "status", { phase: "running" });
    try {
      const selectedAgent = agentId ?? session.agentId ?? config.defaultAgentId ?? "main";
      const cfg = structuredClone(api.runtime.config.current()) as unknown as Parameters<
        typeof api.runtime.agent.resolveAgentWorkspaceDir
      >[0];
      const workspaceDir = api.runtime.agent.resolveAgentWorkspaceDir(cfg, selectedAgent);
      const { provider, model } = splitModel(config.model);
      const result = await api.runtime.agent.runEmbeddedAgent({
        sessionId: session.id,
        sessionKey: `workbench:${user.sub}:${session.id}`,
        sandboxSessionKey: `workbench:${user.sub}:${session.id}`,
        agentId: selectedAgent,
        senderId: user.sub,
        senderIsOwner: false,
        messageProvider: "workbench",
        workspaceDir,
        config: cfg,
        prompt: question,
        transcriptPrompt: question,
        inputProvenance: { kind: "external_user", sourceChannel: "workbench" },
        provider,
        model,
        explicitSkillSelections: skills,
        timeoutMs: api.runtime.agent.resolveAgentTimeoutMs({ cfg }),
        runId: run.id,
        trigger: "user",
        reasoningLevel: "stream",
        streamReasoningInNonStreamModes: true,
        onReasoningStream: (payload) => {
          if (payload.text) emit(run, "reasoning", { text: payload.text });
        },
        onPartialReply: (payload) => {
          if (payload.delta) emit(run, "answer_delta", { delta: payload.delta });
          else if (payload.text) emit(run, "answer_snapshot", { text: payload.text });
        },
      });
      emit(run, "final", {
        text: finalText(result),
        provider: result.meta.agentMeta?.provider,
        model: result.meta.agentMeta?.model,
        usage: result.meta.agentMeta?.usage,
      });
    } catch (error) {
      api.logger.error(`workbench run ${run.id} failed: ${String(error)}`);
      emit(run, "error", { message: error instanceof Error ? error.message : String(error) });
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
        identities.set(user.sub, user);
        const issued = issueClawToken(user, secret, config.clawTokenTtlSeconds);
        json(res, 200, { clawToken: issued.token, expiresAt: issued.expiresAt });
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
        };
        runs.set(run.id, run);
        cleanup();
        void runDetachedWebhookWork(() => execute(run, session, user, question, agentId, skills));
        json(res, 202, { runId: run.id });
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
    resolveMcpConnection: ({ requesterSenderId }: { requesterSenderId: string }) => {
      const user = identities.get(requesterSenderId);
      if (!user) return null;
      const token = issueClawToken(user, secret, config.clawTokenTtlSeconds).token;
      return { url: config.mcpUrl, headers: { Authorization: `Bearer ${token}` } };
    },
  };
}

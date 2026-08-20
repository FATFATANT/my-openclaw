# Workbench Claw service

The bundled `workbench-claw-service` plugin exposes a small authenticated HTTP facade for the AI workbench. It runs requests through OpenClaw's embedded agent runtime and binds the declared `ai-workbench` MCP server to the authenticated requester.

## Configuration

Set the same HMAC secret used by the workbench backend and provide the DeepSeek key:

```bash
export AI_WORKBENCH_SHARED_TOKEN_SECRET='replace-with-a-long-random-secret'
export DEEPSEEK_API_KEY='...'
```

Enable the plugin in the OpenClaw configuration:

```json5
{
  plugins: {
    entries: {
      "workbench-claw-service": {
        enabled: true,
        config: {
          model: "deepseek/deepseek-v4-flash",
          mcpUrl: "http://127.0.0.1:8080/mcp",
          clawTokenTtlSeconds: 3600,
          runRetentionSeconds: 3600,
        },
      },
    },
  },
}
```

`defaultAgentId` is optional. A request can override it when creating a session or appending a run. A run can also provide explicit skills as `{ name, path }` objects; `path` must point to the selected `SKILL.md`.

## HTTP API

All bodies are JSON. Tokens are never accepted in query strings.

1. `POST /api/v1/workbench/token/exchange` with `{ "token": "<X-Workbench-Token>" }` returns `clawToken` and `expiresAt`.
2. `POST /api/v1/workbench/sessions` with `Authorization: Bearer <claw-token>` and `{ "title": "...", "agentId": "optional" }` returns `sessionId`.
3. `POST /api/v1/workbench/sessions/{sessionId}/runs` with the same authorization and `{ "question": "...", "agentId": "optional", "skills": [] }` returns `runId`.
4. `GET /api/v1/workbench/runs/{runId}/events` returns SSE events: `status`, `reasoning`, `answer_delta`, `answer_snapshot`, `final`, `error`, and `complete`.

Session and run access is owner-scoped. The plugin supplies a short-lived requester token to the Spring AI MCP endpoint as an `Authorization` bearer token.

## Operational limits

Session ownership and active run streams are process-local in this first implementation. Restarting the gateway invalidates service session ids and unfinished run ids; the workbench should create a replacement session. Completed runs are removed after `runRetentionSeconds`.

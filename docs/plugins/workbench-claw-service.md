# Workbench Claw service

The bundled `workbench-claw-service` plugin exposes a small authenticated HTTP facade for the AI workbench. It runs requests through OpenClaw's embedded agent runtime and binds the declared `ai-workbench` MCP server to the authenticated requester.

## Configuration

For local workbench verification, put the DeepSeek key in the repository-local `.llm` file and use `openclaw.workbench.json5`:

```bash
cp .llm.example .llm
./start-workbench-claw.sh
```

Open the authenticated Control UI URL with:

```bash
./start-workbench-claw.sh dashboard
```

The script persists a dedicated Gateway operator token under `.workbench-local/gateway-token`. It is separate from the workbench login token and from the Claw token used for MCP calls.

The startup script reads both `api_key` and `workbench_token_secret` from the repository-local `.llm`. The latter must equal `AI_WORKBENCH_SHARED_TOKEN_SECRET` in the workbench `.myenv`. This secret signs tokens; it is not a user token. User tokens are issued after password login and are never startup environment settings. No workbench repository path is referenced by the OpenClaw startup script.

The bundled `openclaw.workbench.json5` enables the plugin with:

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

The local verification config runs in service mode rather than personal-assistant onboarding mode:

- `main` is the Control UI smoke-test agent, loads no skills, uses the `minimal` tool profile, and disables provider streaming to avoid duplicate live/final rendering in the bundled Control UI.
- `workbench` is the default agent for Workbench API runs and keeps the `coding` profile so selected skills and the Workbench MCP server remain available.
- Automatic Code Mode is disabled; the workbench agent still receives its allowed tools directly instead of through the generic `exec` bridge.
- Workspace bootstrap/context injection is disabled, so a fresh state directory does not start the personal identity ritual.
- The memory plugin is disabled for this verification deployment, avoiding an unrelated embeddings provider requirement.

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

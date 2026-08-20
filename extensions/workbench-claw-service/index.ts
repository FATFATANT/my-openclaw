import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { createWorkbenchClawService } from "./src/service.js";

export default definePluginEntry({
  id: "workbench-claw-service",
  name: "AI Workbench Claw Service",
  description: "Expose token exchange, sessions, runs, streaming, and requester-scoped MCP",
  register(api) {
    const service = createWorkbenchClawService(api);
    api.registerHttpRoute({
      path: "/api/v1/workbench",
      auth: "plugin",
      match: "prefix",
      handler: service.handleRequest,
    });
    api.registerMcpServerConnectionResolver({
      serverName: "ai-workbench",
      resolve: service.resolveMcpConnection,
    });
  },
});

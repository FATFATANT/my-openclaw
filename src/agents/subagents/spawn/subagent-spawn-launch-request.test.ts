import { describe, expect, it } from "vitest";
import { buildSubagentLaunchRequest } from "./subagent-spawn-launch-request.js";

function build(requesterSenderId?: string | null) {
  return buildSubagentLaunchRequest({
    childDepth: 1,
    maxSpawnDepth: 2,
    spawnMode: "run",
    task: "search menus",
    spawnedByKey: "agent:main:main",
    toolSpawnMetadata: {},
    childSessionKey: "agent:menu-search:subagent:test",
    collect: true,
    childIdem: "idem-1",
    deliverInitialChildRunDirectly: false,
    childSystemPrompt: "child",
    runTimeoutSeconds: 30,
    lightContext: false,
    expectsCompletionMessage: false,
    requesterSenderId,
    swarmMaxConcurrent: 1,
  });
}

describe("buildSubagentLaunchRequest requester identity", () => {
  it("carries a trusted parent sender into the internal child request", () => {
    expect(build(" user-42 ").childLaunch.request.internalRequesterSenderId).toBe("user-42");
  });

  it("omits an empty requester sender", () => {
    expect(build(" ").childLaunch.request).not.toHaveProperty("internalRequesterSenderId");
  });
});

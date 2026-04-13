import { AgentRunner } from "./agent-runner.js";
import { loadMiniOpenClawEnv } from "./env.js";
import { EventBus } from "./event-bus.js";
import { MockModel } from "./mock-model.js";
import { OpenAICompatibleModel } from "./openai-compatible-model.js";
import { SessionStore } from "./session-store.js";
import { createDemoSkills } from "./skills.js";
import { createDemoTools } from "./tools.js";

loadMiniOpenClawEnv();

const sessions = new SessionStore();
const events = new EventBus();
const skills = createDemoSkills();
const tools = createDemoTools(skills);
const model =
  process.env.OPENCLAW_MINI_MODEL === "real" ? new OpenAICompatibleModel() : new MockModel();
const runner = new AgentRunner(sessions, events, model, tools, skills);

events.subscribe((event) => {
  switch (event.type) {
    case "lifecycle":
      console.log(`[lifecycle] ${event.phase} session=${event.sessionId} run=${event.runId}`);
      break;
    case "skills_catalog":
      console.log(
        `[skills] catalog=${event.skills.map((skill) => skill.title).join(", ") || "(none)"}`,
      );
      break;
    case "reasoning_delta":
      console.log(
        `[reasoning] delta=${JSON.stringify(event.text)} full=${JSON.stringify(event.fullText)}`,
      );
      break;
    case "assistant_delta":
      console.log(
        `[assistant] delta=${JSON.stringify(event.text)} full=${JSON.stringify(event.fullText)}`,
      );
      break;
    case "subagent":
      console.log(
        `[subagent] ${event.phase} label=${event.label} child=${event.childSessionId}${event.text ? ` text=${JSON.stringify(event.text)}` : ""}`,
      );
      break;
    case "tool_start":
      console.log(`[tool:start] ${event.call.name} args=${JSON.stringify(event.call.args)}`);
      break;
    case "tool_end":
      console.log(`[tool:end] ${event.result.toolName} -> ${event.result.text}`);
      break;
  }
});

const result = await runner.run({
  sessionId: "demo-session",
  message: "帮我看看 Hangzhou 今天天气怎么样，我一会儿要出门",
});

console.log("\nFinal Answer:");
console.log(result.finalText);

console.log("\nTranscript:");
for (const message of result.session.transcript) {
  const label = message.toolName ? `${message.role}:${message.toolName}` : message.role;
  console.log(`- ${label}: ${message.text}`);
}

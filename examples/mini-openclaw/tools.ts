import type { AgentTool, Skill } from "./types.js";

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createDemoTools(skills: Skill[]): AgentTool[] {
  return [
    {
      name: "spawn_subagent",
      description: "Spawn a focused child agent for a separable subtask.",
      inputSchema: {
        type: "object",
        properties: {
          label: { type: "string", description: "Short name for the child worker." },
          task: { type: "string", description: "Focused task for the child worker." },
        },
        required: ["label", "task"],
      },
      async execute() {
        return "spawn_subagent is handled by the runner";
      },
    },
    {
      name: "wait_subagents",
      description: "Wait for previously spawned child agents and collect their results.",
      inputSchema: {
        type: "object",
        properties: {},
      },
      async execute() {
        return "wait_subagents is handled by the runner";
      },
    },
    {
      name: "read_skill",
      description: "Load the full instructions for a skill by id.",
      inputSchema: {
        type: "object",
        properties: {
          skillId: { type: "string", description: "The skill id to load." },
        },
        required: ["skillId"],
      },
      async execute(args) {
        await wait(100);
        const skillId = typeof args.skillId === "string" ? args.skillId : "";
        const skill = skills.find((entry) => entry.id === skillId);
        if (!skill) {
          return `Skill not found: ${skillId}`;
        }
        return `SKILL ${skill.id}: ${skill.prompt}`;
      },
    },
    {
      name: "get_weather",
      description: "Return a fake weather report for a city.",
      inputSchema: {
        type: "object",
        properties: {
          city: { type: "string", description: "The city to check." },
        },
        required: ["city"],
      },
      async execute(args) {
        await wait(250);
        const city = typeof args.city === "string" ? args.city : "unknown";
        return `${city} is 21C and sunny`;
      },
    },
    {
      name: "read_note",
      description: "Read a fake note from the workspace.",
      inputSchema: {
        type: "object",
        properties: {
          topic: { type: "string", description: "The note topic." },
        },
        required: ["topic"],
      },
      async execute(args) {
        await wait(150);
        const topic = typeof args.topic === "string" ? args.topic : "general";
        return `Note for ${topic}: remember to keep the design simple`;
      },
    },
  ];
}

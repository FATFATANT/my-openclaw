import path from "node:path";
import type { AgentMode, Skill } from "./types.js";

export function createDemoSkills(): Skill[] {
  return [
    {
      id: "weather-brief",
      title: "Weather Brief",
      summary: "Answer weather questions with a short summary first.",
      filePath: path.join("examples", "mini-openclaw", "skills", "weather-brief", "SKILL.md"),
      prompt:
        "When the user asks about weather, keep the final answer concise: summary first, suggestion second.",
    },
    {
      id: "travel-helper",
      title: "Travel Helper",
      summary: "Prefer practical travel advice and packing suggestions.",
      filePath: path.join("examples", "mini-openclaw", "skills", "travel-helper", "SKILL.md"),
      prompt:
        "When the topic is travel, prefer practical planning advice and mention one concrete next step.",
    },
  ];
}

export function renderSkillCatalog(skills: Skill[]): string {
  if (skills.length === 0) {
    return "";
  }
  const lines = [
    "The following skills provide specialized instructions for specific tasks.",
    "If a task matches a skill, call the read_skill tool with the skill id before answering.",
    "Use at most one tool call at a time.",
    "",
    "<available_skills>",
  ];
  for (const skill of skills) {
    lines.push("  <skill>");
    lines.push(`    <id>${skill.id}</id>`);
    lines.push(`    <title>${skill.title}</title>`);
    lines.push(`    <summary>${skill.summary}</summary>`);
    lines.push(`    <location>${skill.filePath}</location>`);
    lines.push("  </skill>");
  }
  lines.push("</available_skills>");
  return lines.join("\n");
}

export function buildMiniSystemPrompt(skills: Skill[], mode: AgentMode): string {
  const lines = [
    "You are a small OpenClaw-style agent for learning.",
    "Follow a ReAct-style loop: reason briefly, take one action, observe the result, then continue.",
    "Decide whether you need a skill before answering.",
    "If a skill is relevant, call read_skill first.",
    "When you need outside data, call a tool instead of inventing facts.",
  ];

  if (mode === "main") {
    lines.push(
      "If a task contains a separable subtask, you may call spawn_subagent with a focused task.",
      "After spawning child workers, call wait_subagents before giving your final answer.",
    );
  } else {
    lines.push(
      "You are a focused subagent. Complete only the assigned subtask.",
      "Do not spawn more subagents from a subagent session in this mini example.",
    );
  }

  const catalog = renderSkillCatalog(skills);
  if (catalog) {
    lines.push("", catalog);
  }

  return lines.join("\n");
}

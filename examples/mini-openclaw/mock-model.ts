import { inferDemoSql, isSqlQuestion } from "./sql.js";
import type { ModelMessage, ModelStreamEvent, ModelTurnContext } from "./types.js";

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getLastUserMessage(messages: ModelMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === "user") {
      return message.content;
    }
  }
  return "";
}

function hasToolResult(messages: ModelMessage[], toolName: string, needle?: string): boolean {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "tool" || message.toolName !== toolName) {
      continue;
    }
    if (!needle) {
      return true;
    }
    if (message.content.includes(needle)) {
      return true;
    }
  }
  return false;
}

function getLastToolText(messages: ModelMessage[], toolName: string): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === "tool" && message.toolName === toolName) {
      return message.content;
    }
  }
  return "";
}

async function* emitReasoningAndToolCall(params: {
  reasoning: string[];
  call: ModelStreamEvent & { type: "tool_call" };
}): AsyncGenerator<ModelStreamEvent> {
  for (const chunk of params.reasoning) {
    await wait(100);
    yield { type: "reasoning_delta", text: chunk };
  }
  yield params.call;
}

export class MockModel {
  async *streamTurn(context: ModelTurnContext): AsyncGenerator<ModelStreamEvent> {
    const userText = getLastUserMessage(context.messages).toLowerCase();
    const wantsSql = isSqlQuestion(userText);
    const needsWeather = userText.includes("weather") || userText.includes("天气");
    const wantsTravelAdvice =
      userText.includes("travel") ||
      userText.includes("trip") ||
      userText.includes("出门") ||
      userText.includes("packing");

    if (wantsSql) {
      const generatedSql = inferDemoSql(userText);
      const wantsExecution =
        userText.includes("执行") || userText.includes("run") || userText.includes("结果");

      if (!hasToolResult(context.messages, "read_skill", "sql-analyst")) {
        yield* emitReasoningAndToolCall({
          reasoning: ["这是一个自然语言转 SQL 任务，我先读取 SQL 分析 skill。"],
          call: {
            type: "tool_call",
            call: {
              id: "tool-skill-sql",
              name: "read_skill",
              args: { skillId: "sql-analyst" },
            },
          },
        });
        return;
      }

      if (!hasToolResult(context.messages, "describe_data_schema")) {
        yield* emitReasoningAndToolCall({
          reasoning: ["我需要先看 schema，确认表和字段再生成 SQL。"],
          call: {
            type: "tool_call",
            call: {
              id: "tool-schema",
              name: "describe_data_schema",
              args: {},
            },
          },
        });
        return;
      }

      if (wantsExecution && !hasToolResult(context.messages, "run_sql_query")) {
        yield* emitReasoningAndToolCall({
          reasoning: ["我已经有 SQL 了，再跑一次只读预览确认结果。"],
          call: {
            type: "tool_call",
            call: {
              id: "tool-run-sql",
              name: "run_sql_query",
              args: { sql: generatedSql },
            },
          },
        });
        return;
      }

      await wait(100);
      yield { type: "reasoning_delta", text: "schema 已确认，现在返回 SQL。" };
      await wait(100);
      yield {
        type: "text_delta",
        text: `我建议使用下面这条 SQL：\n\n\`\`\`sql\n${generatedSql}\n\`\`\``,
      };

      const sqlPreview = getLastToolText(context.messages, "run_sql_query");
      if (sqlPreview) {
        await wait(100);
        yield { type: "text_delta", text: `\n\n执行预览：${sqlPreview}` };
      }
      yield { type: "done" };
      return;
    }

    if (context.mode === "subagent") {
      const hasTravelSkill = hasToolResult(context.messages, "read_skill", "travel-helper");
      if (wantsTravelAdvice && !hasTravelSkill) {
        yield* emitReasoningAndToolCall({
          reasoning: ["我先读取一个和出行建议相关的 skill，再输出子任务结果。"],
          call: {
            type: "tool_call",
            call: {
              id: "tool-subagent-skill-travel",
              name: "read_skill",
              args: { skillId: "travel-helper" },
            },
          },
        });
        return;
      }

      const travelAdvice = hasTravelSkill
        ? "子任务建议：带一件薄外套，并预留十分钟机动时间。"
        : "子任务建议：提前检查天气并准备轻便外套。";
      await wait(100);
      yield { type: "reasoning_delta", text: "我已经拿到了子任务需要的上下文，现在直接给出建议。" };
      await wait(100);
      yield { type: "text_delta", text: travelAdvice };
      yield { type: "done" };
      return;
    }

    if (needsWeather && !hasToolResult(context.messages, "read_skill", "weather-brief")) {
      yield* emitReasoningAndToolCall({
        reasoning: ["我先判断有没有和天气回答风格相关的 skill。"],
        call: {
          type: "tool_call",
          call: {
            id: "tool-skill-weather",
            name: "read_skill",
            args: { skillId: "weather-brief" },
          },
        },
      });
      return;
    }

    if (wantsTravelAdvice && !hasToolResult(context.messages, "spawn_subagent")) {
      yield* emitReasoningAndToolCall({
        reasoning: ["天气和出行建议可以拆开做，我先分派一个 travel 子代理。"],
        call: {
          type: "tool_call",
          call: {
            id: "tool-spawn-travel",
            name: "spawn_subagent",
            args: {
              label: "travel-advisor",
              task: `Give one concise travel or packing recommendation for this user request: ${userText}`,
            },
          },
        },
      });
      return;
    }

    if (wantsTravelAdvice && !hasToolResult(context.messages, "wait_subagents")) {
      yield* emitReasoningAndToolCall({
        reasoning: ["我已经把子任务派出去了，先等待子代理结果回来。"],
        call: {
          type: "tool_call",
          call: {
            id: "tool-wait-subagents",
            name: "wait_subagents",
            args: {},
          },
        },
      });
      return;
    }

    if (needsWeather && !hasToolResult(context.messages, "get_weather")) {
      const city =
        userText.includes("shanghai") || userText.includes("上海") ? "Shanghai" : "Hangzhou";
      yield* emitReasoningAndToolCall({
        reasoning: ["我已经拿到回答策略和子任务结果，接下来查询天气观测值。"],
        call: {
          type: "tool_call",
          call: {
            id: "tool-weather",
            name: "get_weather",
            args: { city },
          },
        },
      });
      return;
    }

    const weatherText = getLastToolText(context.messages, "get_weather");
    const hasWeatherSkill = hasToolResult(context.messages, "read_skill", "weather-brief");
    const childSummary = getLastToolText(context.messages, "wait_subagents");

    await wait(100);
    yield { type: "reasoning_delta", text: "我已经观察到了所有工具结果，现在整理成最终回答。" };
    const finalChunks = hasWeatherSkill
      ? [
          "天气摘要：",
          weatherText || "暂时没有天气数据",
          childSummary ? `。${childSummary}` : "。今天适合正常出行。",
        ]
      : ["我整理了一下：", weatherText || "暂时没有天气数据", "。"];

    for (const chunk of finalChunks) {
      await wait(100);
      yield { type: "text_delta", text: chunk };
    }
    yield { type: "done" };
  }
}

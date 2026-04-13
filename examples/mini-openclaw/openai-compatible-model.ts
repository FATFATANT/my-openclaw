import type {
  AgentTool,
  ModelMessage,
  ModelStreamEvent,
  ModelTurnContext,
  ToolCall,
} from "./types.js";

type OpenAIToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};

type OpenAIChatMessage =
  | { role: "system" | "user" | "assistant"; content: string; tool_calls?: OpenAIToolCall[] }
  | { role: "tool"; content: string; tool_call_id: string };

type ChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string | null;
      tool_calls?: OpenAIToolCall[];
    };
  }>;
};

function mapMessages(messages: ModelMessage[]): OpenAIChatMessage[] {
  return messages.map((message) => {
    if (message.role === "tool") {
      return {
        role: "tool",
        content: message.content,
        tool_call_id: message.toolCallId,
      };
    }
    if (message.role === "assistant" && "toolCalls" in message) {
      return {
        role: "assistant",
        content: message.content,
        tool_calls: message.toolCalls.map((toolCall) => ({
          id: toolCall.id,
          type: "function",
          function: {
            name: toolCall.name,
            arguments: JSON.stringify(toolCall.args),
          },
        })),
      };
    }
    return {
      role: message.role,
      content: message.content,
    };
  });
}

function mapTools(tools: AgentTool[]) {
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    },
  }));
}

function parseToolCall(toolCall: OpenAIToolCall): ToolCall {
  let args: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(toolCall.function.arguments);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      args = parsed as Record<string, unknown>;
    }
  } catch {
    args = {};
  }
  return {
    id: toolCall.id,
    name: toolCall.function.name,
    args,
  };
}

export class OpenAICompatibleModel {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;

  constructor(options?: { apiKey?: string; model?: string; baseUrl?: string }) {
    this.apiKey = options?.apiKey ?? process.env.OPENAI_API_KEY ?? "";
    this.model = options?.model ?? process.env.OPENCLAW_MINI_MODEL_NAME ?? "gpt-4o-mini";
    this.baseUrl = options?.baseUrl ?? process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";
    if (!this.apiKey) {
      throw new Error("OPENAI_API_KEY is required for OpenAICompatibleModel.");
    }
  }

  async *streamTurn(context: ModelTurnContext): AsyncGenerator<ModelStreamEvent> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: mapMessages(context.messages),
        tools: mapTools(context.tools),
        tool_choice: "auto",
        temperature: 0.2,
      }),
    });
    if (!response.ok) {
      throw new Error(`Model request failed: ${response.status} ${await response.text()}`);
    }

    const json = (await response.json()) as ChatCompletionResponse;
    const message = json.choices?.[0]?.message;
    if (!message) {
      throw new Error("Model returned no message.");
    }

    const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
    if (toolCalls.length > 0) {
      yield { type: "tool_call", call: parseToolCall(toolCalls[0]) };
      return;
    }

    const text = typeof message.content === "string" ? message.content : "";
    if (text) {
      yield { type: "text_delta", text };
    }
    yield { type: "done" };
  }
}

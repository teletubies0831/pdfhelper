import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import type { McpServer } from "@modelcontextprotocol/server";

import {
  AGENT_TOOL_DEFINITIONS,
  createAgentToolServer,
  getAgentToolByProtocolName,
} from "../../../../modules/ai/public";
import type {
  AiNativeToolCall,
  AiStreamStartMessage,
  AiStreamToolResult,
} from "../../../../modules/ai/public";

import {
  createAgentToolHandlers,
  type AgentToolHandler,
} from "./agent-tool-handlers";

function textFromMcpContent(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .flatMap((item) =>
      item &&
      typeof item === "object" &&
      "type" in item &&
      item.type === "text" &&
      "text" in item &&
      typeof item.text === "string"
        ? [item.text]
        : [],
    )
    .join("\n")
    .trim();
}

export class EmbeddedAgentToolRuntime {
  private readonly handlers: Map<string, AgentToolHandler>;
  private readonly server: McpServer;
  private readonly client: Client;
  private activeContext: AiStreamStartMessage["context"];
  private connectionPromise?: Promise<void>;
  private executionQueue: Promise<void> = Promise.resolve();

  constructor() {
    this.handlers = createAgentToolHandlers();
    const missingHandlers = AGENT_TOOL_DEFINITIONS.filter(
      (definition) => !this.handlers.has(definition.applicationName),
    );
    if (missingHandlers.length > 0) {
      throw new Error(
        `以下 MCP 工具缺少执行器：${missingHandlers
          .map((definition) => definition.applicationName)
          .join(", ")}`,
      );
    }
    this.server = createAgentToolServer(async (definition, argumentsValue) => {
      const handler = this.handlers.get(definition.applicationName);
      if (!handler) {
        return {
          ok: false,
          error: `工具 ${definition.applicationName} 尚未注册执行器。`,
          modelContent: `工具 ${definition.applicationName} 尚未注册执行器。`,
        };
      }
      return handler(argumentsValue, this.activeContext);
    });
    this.client = new Client({ name: "pdfpal-viewer", version: "1.0.0" });
  }

  private ensureConnected(): Promise<void> {
    if (!this.connectionPromise) {
      const [clientTransport, serverTransport] =
        InMemoryTransport.createLinkedPair();
      this.connectionPromise = Promise.all([
        this.server.connect(serverTransport),
        this.client.connect(clientTransport),
      ]).then(() => undefined);
    }
    return this.connectionPromise;
  }

  listTools(): Promise<Awaited<ReturnType<Client["listTools"]>>> {
    return this.ensureConnected().then(() => this.client.listTools());
  }

  executeToolCalls(
    calls: AiNativeToolCall[],
    context: AiStreamStartMessage["context"],
  ): Promise<AiStreamToolResult[]> {
    const execution = this.executionQueue.then(async () => {
      await this.ensureConnected();
      this.activeContext = context;
      try {
        return await Promise.all(
          calls.map(async (call): Promise<AiStreamToolResult> => {
            const definition = getAgentToolByProtocolName(call.name);
            const applicationName = definition?.applicationName ?? call.name;
            console.info("[PDFPal MCP] tools/call", {
              toolCallId: call.id,
              protocolName: call.name,
              applicationName,
              arguments: call.arguments,
            });
            try {
              const result = await this.client.callTool({
                name: call.name,
                arguments: call.arguments ?? {},
              });
              const content = textFromMcpContent(result.content);
              const ok = result.isError !== true;
              console.info("[PDFPal MCP] tools/result", {
                toolCallId: call.id,
                applicationName,
                ok,
              });
              return {
                toolCallId: call.id,
                name: applicationName,
                ok,
                content: content || (ok ? "工具执行完成。" : "工具执行失败。"),
              };
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              console.error("[PDFPal MCP] tools/call failed", {
                toolCallId: call.id,
                applicationName,
                error: message,
              });
              return {
                toolCallId: call.id,
                name: applicationName,
                ok: false,
                content: message,
              };
            }
          }),
        );
      } finally {
        this.activeContext = undefined;
      }
    });
    this.executionQueue = execution.then(
      () => undefined,
      () => undefined,
    );
    return execution;
  }
}

export const embeddedAgentToolRuntime = new EmbeddedAgentToolRuntime();

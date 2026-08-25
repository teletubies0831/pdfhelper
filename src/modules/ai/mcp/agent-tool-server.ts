import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import {
  AGENT_TOOL_DEFINITIONS,
  type AgentToolDefinition,
} from "./agent-tool-catalog";

export interface AgentToolExecutionResult {
  ok: boolean;
  data?: unknown;
  error?: string;
  modelContent: string;
}

export type AgentToolExecutor = (
  tool: AgentToolDefinition,
  argumentsValue: Record<string, unknown>,
) => Promise<AgentToolExecutionResult>;

const commonToolResultSchema = z.object({
  ok: z.boolean(),
  tool: z.string(),
  data: z.unknown().optional(),
  error: z.string().optional(),
});

export function createAgentToolServer(
  executeTool: AgentToolExecutor,
): McpServer {
  const server = new McpServer(
    { name: "pdfpal-agent-tools", version: "1.0.0" },
    {
      instructions:
        "Use document tools for current-PDF evidence, memory tools for durable user context, journal tools for saved reading notes, and library tools for historical papers.",
    },
  );

  for (const definition of AGENT_TOOL_DEFINITIONS) {
    server.registerTool(
      definition.protocolName,
      {
        title: definition.label,
        description: definition.description,
        inputSchema: definition.inputSchema,
        outputSchema: commonToolResultSchema,
        annotations: definition.annotations,
      },
      async (argumentsValue) => {
        try {
          const result = await executeTool(
            definition,
            argumentsValue as Record<string, unknown>,
          );
          return {
            ...(result.ok ? {} : { isError: true }),
            content: [{ type: "text", text: result.modelContent }],
            structuredContent: {
              ok: result.ok,
              tool: definition.applicationName,
              ...(result.data === undefined ? {} : { data: result.data }),
              ...(result.error ? { error: result.error } : {}),
            },
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return {
            isError: true,
            content: [{ type: "text", text: message }],
            structuredContent: {
              ok: false,
              tool: definition.applicationName,
              error: message,
            },
          };
        }
      },
    );
  }
  return server;
}

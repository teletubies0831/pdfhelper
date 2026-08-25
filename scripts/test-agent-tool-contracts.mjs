import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  AGENT_TOOL_DEFINITIONS,
  convertMcpToolsToProviderFunctions,
  getAgentToolByApplicationName,
  getAgentToolByProtocolName,
  getProviderAgentTools,
} from "../src/modules/ai/mcp/agent-tool-catalog.ts";
import { parseAgentToolResult } from "../src/viewer/features/assistant/mcp/agent-tool-result.ts";
import {
  mergeEvidenceSources,
  readKnowledgeEvidenceSources,
} from "../src/viewer/features/assistant/tool-evidence.ts";

const applicationNames = AGENT_TOOL_DEFINITIONS.map(
  (tool) => tool.applicationName,
);
const protocolNames = AGENT_TOOL_DEFINITIONS.map((tool) => tool.protocolName);

assert.equal(
  new Set(applicationNames).size,
  applicationNames.length,
  "Application tool names must be unique.",
);
assert.equal(
  new Set(protocolNames).size,
  protocolNames.length,
  "MCP protocol tool names must be unique.",
);

for (const definition of AGENT_TOOL_DEFINITIONS) {
  assert.equal(
    getAgentToolByApplicationName(definition.applicationName),
    definition,
  );
  assert.equal(
    getAgentToolByProtocolName(definition.protocolName),
    definition,
  );
  assert.match(definition.protocolName, /^[a-z][a-z0-9_]*$/);
  assert.ok(definition.description.trim());
  assert.ok(definition.trigger.trim());
}

const providerTools = getProviderAgentTools();
assert.deepEqual(
  providerTools.map((tool) => tool.function.name),
  protocolNames,
  "Provider tools must be generated from the MCP catalog.",
);
assert.equal(
  getProviderAgentTools(["memory.upsert"])[0].function.name,
  "memory_upsert",
);
assert.equal(
  convertMcpToolsToProviderFunctions([
    {
      name: "sample_tool",
      description: "Sample",
      inputSchema: { type: "object", properties: {} },
    },
  ])[0].function.name,
  "sample_tool",
);

const searchTool = getAgentToolByProtocolName("document_search");
assert.equal(searchTool.inputSchema.safeParse({ query: "method" }).success, true);
assert.equal(
  searchTool.inputSchema.safeParse({ query: "method", limit: 99 }).success,
  false,
);
assert.equal(
  searchTool.inputSchema.safeParse({ query: "method", unknown: true }).success,
  false,
);

const forgetTool = getAgentToolByApplicationName("memory.forget");
assert.equal(forgetTool.annotations.destructiveHint, true);

const librarySearchTool = getAgentToolByApplicationName("library.searchPapers");
assert.match(librarySearchTool.description, /关键词、语义或混合检索/);
assert.match(librarySearchTool.trigger, /另一篇文献/);

const directToolResult = parseAgentToolResult(
  JSON.stringify({ knowledgeMatches: [{ recordKey: "note:1" }] }),
  "library.searchPapers",
  true,
);
assert.equal(directToolResult.ok, true);
assert.deepEqual(directToolResult.data, {
  knowledgeMatches: [{ recordKey: "note:1" }],
});

const wrappedToolResult = parseAgentToolResult(
  JSON.stringify({ ok: true, tool: "library.searchPapers", data: ["paper"] }),
  "library.searchPapers",
  true,
);
assert.deepEqual(wrappedToolResult.data, ["paper"]);

const evidence = readKnowledgeEvidenceSources(JSON.stringify({
  knowledgeMatches: [
    {
      documentId: "paper-1",
      documentName: "Paper One.pdf",
      startPage: 7,
      recentEntryId: "recent-1",
    },
    {
      documentId: "paper-1",
      documentName: "Paper One.pdf",
      startPage: 7,
      recentEntryId: "recent-1",
    },
  ],
}));
assert.deepEqual(evidence, [{
  documentId: "paper-1",
  documentName: "Paper One.pdf",
  pageNumber: 7,
  recentEntryId: "recent-1",
}]);
assert.deepEqual(readKnowledgeEvidenceSources("not-json"), []);
assert.equal(mergeEvidenceSources(evidence, evidence).length, 1);

const chatControllerSource = await readFile(
  new URL("../src/viewer/features/assistant/chat-controller.ts", import.meta.url),
  "utf8",
);
for (const removedPreflight of [
  "runKnowledgeAgentTools",
  "persistImmediateExplicitMemories",
  "buildAgentEvidence",
  "automatic-library-search",
]) {
  assert.doesNotMatch(
    chatControllerSource,
    new RegExp(removedPreflight),
    `Chat must not restore the preflight path: ${removedPreflight}`,
  );
}
assert.match(
  chatControllerSource,
  /result\.ok && result\.name === "library\.searchPapers"/,
  "Knowledge evidence must be created from an actual successful tool result.",
);

console.log("MCP agent tool contract tests passed.");

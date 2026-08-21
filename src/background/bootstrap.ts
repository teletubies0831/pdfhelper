import { browser } from "wxt/browser";

import { isSelectionAction } from "../../shared/selection";
import { extractPdfSource } from "../../shared/pdf-source";

import {
  AI_STREAM_PORT_NAME,
  isAiRuntimeRequest,
  type AiStreamToolResult,
} from "../../shared/ai";
import {
  isResearchRuntimeRequest,
  type CcfLookupResponse,
  type RelatedResearchResponse,
} from "../../shared/research";
import {
  runCcfLookupGraph,
  runRelatedResearchGraph,
} from "../modules/research/public";

import {
  MENU_PREFIX,
  openEnhancedViewer,
  openHelperPanelPage,
  registerContextMenus,
  saveSelection,
} from "./context-menu/context-menu-controller";
import {
  handleAiRequest,
  isAiStreamStartMessage,
  isAiStreamToolResultsMessage,
  postAiStreamMessage,
  streamAiResponse,
} from "./ai/ai-runtime";
import { getSafeErrorDetails } from "./ai/vision-service";

export function bootstrapBackground(): void {
  void registerContextMenus();

  browser.action.onClicked.addListener(() => {
    void openEnhancedViewer();
  });

  browser.runtime.onMessage.addListener((message) => {
    if (isResearchRuntimeRequest(message)) {
      if (message.type === "pdf-helper:research-related") {
        return runRelatedResearchGraph(
          message,
        ) satisfies Promise<RelatedResearchResponse>;
      }
      return runCcfLookupGraph(message)
        .then((result): CcfLookupResponse => ({ ok: true, result }))
        .catch(
          (error): CcfLookupResponse => ({
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          }),
        );
    }
    if (!isAiRuntimeRequest(message)) return undefined;
    return handleAiRequest(message);
  });

  browser.runtime.onConnect.addListener((port) => {
    if (port.name !== AI_STREAM_PORT_NAME) return;

    let activeRequest: AbortController | undefined;
    let pendingToolResults:
      | { requestId: string; resolve: (results: AiStreamToolResult[]) => void }
      | undefined;
    const waitForToolResults = (
      requestId: string,
      signal: AbortSignal,
    ): Promise<AiStreamToolResult[]> =>
      new Promise((resolve) => {
        const timeoutId = setTimeout(() => {
          if (pendingToolResults?.requestId !== requestId) return;
          pendingToolResults = undefined;
          console.error("[PDFPal AI] 工具结果等待超时", {
            requestId,
            timeoutMs: 45_000,
          });
          resolve([]);
        }, 45_000);
        const finish = (results: AiStreamToolResult[]): void => {
          clearTimeout(timeoutId);
          resolve(results);
        };
        if (signal.aborted) {
          finish([]);
          return;
        }
        pendingToolResults = { requestId, resolve: finish };
        signal.addEventListener(
          "abort",
          () => {
            if (pendingToolResults?.requestId === requestId) {
              pendingToolResults = undefined;
              finish([]);
            }
          },
          { once: true },
        );
      });
    port.onMessage.addListener((message) => {
      if (isAiStreamToolResultsMessage(message)) {
        if (pendingToolResults?.requestId === message.requestId) {
          const resolve = pendingToolResults.resolve;
          pendingToolResults = undefined;
          resolve(message.results);
        }
        return;
      }
      if (!isAiStreamStartMessage(message)) return;

      activeRequest?.abort();
      pendingToolResults = undefined;
      activeRequest = new AbortController();
      const { signal } = activeRequest;
      void streamAiResponse(message, port, signal, waitForToolResults).catch(
        (error) => {
          if (signal.aborted) return;
          const details = getSafeErrorDetails(error);
          console.error("[PDFPal AI] 流式请求失败", {
            requestId: message.requestId,
            error: error instanceof Error ? error.message : String(error),
            details,
          });
          postAiStreamMessage(port, {
            type: "error",
            requestId: message.requestId,
            error: error instanceof Error ? error.message : String(error),
            details,
          });
        },
      );
    });
    port.onDisconnect.addListener(() => {
      activeRequest?.abort();
      pendingToolResults = undefined;
      activeRequest = undefined;
    });
  });

  browser.contextMenus.onClicked.addListener(async (info, tab) => {
    if (
      typeof info.menuItemId !== "string" ||
      !info.menuItemId.startsWith(MENU_PREFIX) ||
      !info.selectionText
    ) {
      return;
    }

    const action = info.menuItemId.slice(MENU_PREFIX.length);
    if (!isSelectionAction(action)) return;

    const pdfSource = extractPdfSource(tab?.url);
    if (
      !pdfSource &&
      !tab?.url?.startsWith(browser.runtime.getURL("/viewer.html"))
    ) {
      return;
    }

    await saveSelection(action, info.selectionText, tab);

    await openHelperPanelPage();
  });
}

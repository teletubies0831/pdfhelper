import { browser } from "wxt/browser";

import { isSelectionAction } from "../modules/selection/public";
import { extractPdfSource } from "../infrastructure/browser/pdf-source";
import {
  hasSeenSidepanelFirstRun,
  isSidepanelFirstRunSeenMessage,
} from "../viewer-launcher/sidepanel-first-run";

import {
  AI_STREAM_PORT_NAME,
  isAiRuntimeRequest,
  type AiStreamToolResult,
} from "../modules/ai/public";

import {
  MENU_PREFIX,
  openEnhancedViewer,
  openSelectionPage,
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
import { getSafeProviderErrorDetails as getSafeErrorDetails } from "../modules/ai/public";
import { withAiRequestLifetime } from "./ai/request-lifetime";
import { registerExplanationStreamPort } from "./ai/explanation-stream";
import { registerTranslationStreamPort } from "./ai/translation-stream";

async function configureActionBehavior(): Promise<void> {
  if (!browser.sidePanel?.setPanelBehavior) return;
  const hasSeenFirstRun = await hasSeenSidepanelFirstRun();
  await browser.sidePanel.setPanelBehavior({
    openPanelOnActionClick: !hasSeenFirstRun,
  });
}

async function handleActionClick(): Promise<void> {
  if (!browser.sidePanel?.setPanelBehavior) {
    await openEnhancedViewer();
    return;
  }

  if (await hasSeenSidepanelFirstRun()) {
    await openEnhancedViewer();
  }
}

export function bootstrapBackground(): void {
  void registerContextMenus();

  void configureActionBehavior().catch(() => undefined);

  // The one-line entity explanation has its own port: it streams a sentence, not a conversation.
  registerExplanationStreamPort();
  // The translation card does too, and asks for its two halves in parallel.
  registerTranslationStreamPort();

  browser.action.onClicked.addListener(() => {
    void handleActionClick().catch(() => undefined);
  });

  browser.runtime.onMessage.addListener((message) => {
    if (isSidepanelFirstRunSeenMessage(message)) {
      if (browser.sidePanel?.setPanelBehavior) {
        void browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
      }
      return undefined;
    }
    if (!isAiRuntimeRequest(message)) return undefined;
    return withAiRequestLifetime(() => handleAiRequest(message, async (progress) => {
      if (message.type !== 'pdf-helper:ai-generate-document-overview') return;
      await browser.runtime.sendMessage({
        type: 'pdf-helper:ai-document-overview-progress', requestId: message.requestId, ...progress,
      }).catch(() => undefined);
    }));
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
        let settled = false;
        let timeoutId: ReturnType<typeof setTimeout> | undefined;
        // Each call settles itself, once, whatever happens first: the tool results arriving, the 45 s ceiling, or an
        // abort. The listener is removed as well — a leftover listener from round 1 used to consume round 2's abort and
        // leave its promise unresolved, which pinned the service worker through `withAiRequestLifetime` forever.
        const finish = (results: AiStreamToolResult[]): void => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timeoutId);
          signal.removeEventListener("abort", onAbort);
          if (pendingToolResults?.requestId === requestId) pendingToolResults = undefined;
          resolve(results);
        };
        const onAbort = (): void => finish([]);
        timeoutId = setTimeout(() => {
          console.error("[PDFPal AI] 工具结果等待超时", {
            requestId,
            timeoutMs: 45_000,
          });
          finish([]);
        }, 45_000);
        if (signal.aborted) {
          finish([]);
          return;
        }
        pendingToolResults = { requestId, resolve: finish };
        signal.addEventListener("abort", onAbort, { once: true });
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
      void withAiRequestLifetime(() => streamAiResponse(message, port, signal, waitForToolResults)).catch(
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

    await openSelectionPage();
  });
}

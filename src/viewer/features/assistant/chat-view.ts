






import { type AiImageAttachment } from "../../../../shared/ai";









import { chatImagePreviewOverlay, pendingChatImages } from "../../core/pdf-reader/public";
import { renderChatMarkdown } from "../../shared-ui/markdown/markdown-renderer";
import { chatAttachmentsElement, chatInput, chatMessagesElement } from "../../app/viewer-elements";
import { setStatus } from "../recent-files/public";











export function failActiveChatActivities(
  message: HTMLElement,
  detail = "本轮请求失败，已停止等待。",
): void {
  for (const activity of message.querySelectorAll<HTMLElement>(
    ".chat-message-activity",
  )) {
    let hadActiveRow = false;
    for (const row of activity.querySelectorAll<HTMLElement>(
      '.chat-activity-row[data-state="active"]',
    )) {
      hadActiveRow = true;
      row.dataset.state = "error";
    }

    // The spinner is driven by the compact summary, not only by its detail
    // rows.  Mark both states so an error cannot leave the summary rotating.
    const summary = activity.querySelector<HTMLButtonElement>(
      ".chat-activity-summary",
    );
    if (hadActiveRow || summary?.dataset.state === "active") {
      activity.dataset.state = "error";
      summary?.setAttribute("data-state", "error");
      summary?.setAttribute("aria-label", "请求失败，展开查看详情");
      const label = summary?.querySelector<HTMLElement>(
        ".chat-activity-summary-label",
      );
      const summaryDetail = summary?.querySelector<HTMLElement>(
        ".chat-activity-summary-detail",
      );
      if (label) label.textContent = "请求失败";
      if (summaryDetail) {
        summaryDetail.textContent = detail;
        summaryDetail.hidden = false;
      }
    }
  }
}



export function renderChatMessageImages(
  message: HTMLElement,
  images: AiImageAttachment[] | undefined,
): void {
  message.querySelector(".chat-message-images")?.remove();
  if (!images?.length) return;
  const gallery = document.createElement("div");
  gallery.className = "chat-message-images";
  for (const attachment of images) {
    const image = document.createElement("img");
    image.className = "chat-message-image";
    image.src = attachment.dataUrl;
    image.alt = attachment.name || "聊天截图";
    image.title = attachment.name || "聊天截图";
    image.tabIndex = 0;
    image.setAttribute("role", "button");
    image.setAttribute(
      "aria-label",
      `放大查看 ${attachment.name || "聊天截图"}`,
    );
    gallery.append(image);
  }
  const body = message.querySelector(".chat-message-content");
  if (body) message.insertBefore(gallery, body);
  else message.append(gallery);
}



export function closeChatImagePreview(): void {
  const overlay = chatImagePreviewOverlay.value;
  if (!overlay) return;
  chatImagePreviewOverlay.value = null;
  overlay.classList.remove("visible");
  window.setTimeout(() => overlay.remove(), 160);
}



export function openChatImagePreview(source: string, alternativeText: string): void {
  closeChatImagePreview();
  const overlay = document.createElement("div");
  overlay.className = "chat-image-preview-overlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", "截图大图预览；再次点击退出");
  overlay.tabIndex = -1;

  const image = document.createElement("img");
  image.className = "chat-image-preview-image";
  image.src = source;
  image.alt = alternativeText || "聊天截图大图";
  const hint = document.createElement("div");
  hint.className = "chat-image-preview-hint";
  hint.textContent = "再次点击退出查看 · Esc 关闭";
  overlay.append(image, hint);
  overlay.addEventListener("click", closeChatImagePreview);
  document.body.append(overlay);
  chatImagePreviewOverlay.value = overlay;
  requestAnimationFrame(() => overlay.classList.add("visible"));
  overlay.focus();
}



export function updateChatReasoning(
  message: HTMLElement,
  content: string,
  streaming: boolean,
): void {
  let details = message.querySelector<HTMLDetailsElement>(
    ".chat-message-reasoning",
  );
  if (!content.trim()) {
    if (!streaming) details?.remove();
    return;
  }

  if (!details) {
    details = document.createElement("details");
    details.className = "chat-message-reasoning";
    details.open = true;

    const summary = document.createElement("summary");
    const label = document.createElement("span");
    label.className = "chat-reasoning-label";
    const state = document.createElement("span");
    state.className = "chat-reasoning-state";
    summary.append(label, state);

    const body = document.createElement("div");
    body.className = "chat-reasoning-content";
    details.append(summary, body);
    summary.addEventListener("click", (event) => {
      event.preventDefault();
      details?.classList.toggle("expanded");
      if (details) details.open = true;
      const nextState = details?.querySelector<HTMLElement>(
        ".chat-reasoning-state",
      );
      if (nextState) {
        nextState.textContent = details?.classList.contains("expanded")
          ? "点击收起"
          : "点击展开";
      }
    });

    const answerBody = message.querySelector(".chat-message-content");
    if (answerBody) message.insertBefore(details, answerBody);
    else message.append(details);
  }

  const label = details.querySelector<HTMLElement>(".chat-reasoning-label");
  const state = details.querySelector<HTMLElement>(".chat-reasoning-state");
  const body = details.querySelector<HTMLElement>(".chat-reasoning-content");
  if (label) label.textContent = streaming ? "正在思考…" : "思考过程";
  if (state) {
    state.textContent = streaming
      ? "生成中"
      : details.classList.contains("expanded")
        ? "点击收起"
        : "点击展开";
  }
  if (body) renderChatMarkdown(body, content, true, !streaming);
}



export function updateChatMessage(
  message: HTMLElement,
  content: string,
  options: { pending?: boolean; streaming?: boolean; error?: boolean } = {},
): void {
  message.classList.toggle("pending", Boolean(options.pending));
  message.classList.toggle("streaming", Boolean(options.streaming));
  message.classList.toggle("error", Boolean(options.error));
  const body = message.querySelector<HTMLElement>(".chat-message-content");
  if (!body) return;

  if (message.classList.contains("assistant") && !options.error) {
    renderChatMarkdown(
      body,
      content,
      !options.streaming,
      !options.streaming,
    );
  } else {
    body.textContent = content;
  }
  chatMessagesElement.scrollTop = chatMessagesElement.scrollHeight;
}



export function appendChatMessage(
  role: "user" | "assistant",
  content: string,
  options: {
    pending?: boolean;
    error?: boolean;
    images?: AiImageAttachment[];
  } = {},
): HTMLElement {
  const message = document.createElement("article");
  message.className = `chat-message ${role}`;
  message.classList.toggle("pending", Boolean(options.pending));
  message.classList.toggle("error", Boolean(options.error));

  const roleLabel = document.createElement("div");
  roleLabel.className = "chat-message-role";
  roleLabel.textContent = role === "user" ? "你" : "PDFPal";

  const body = document.createElement("div");
  body.className = "chat-message-content";

  message.append(roleLabel, body);
  chatMessagesElement.append(message);
  renderChatMessageImages(message, options.images);
  updateChatMessage(message, content, options);
  return message;
}



export const MAX_CHAT_IMAGE_COUNT = 3;


export const MAX_CHAT_IMAGE_BYTES = 15 * 1024 * 1024;


export const MAX_CHAT_IMAGE_EDGE = 1600;



export async function createChatImageAttachment(
  blob: Blob,
  fallbackName = "screenshot.png",
): Promise<AiImageAttachment> {
  if (!blob.type.startsWith("image/")) throw new Error("只能添加图片文件。");
  if (blob.size > MAX_CHAT_IMAGE_BYTES)
    throw new Error("单张图片不能超过 15 MB。");

  const bitmap = await createImageBitmap(blob);
  try {
    const scale = Math.min(
      1,
      MAX_CHAT_IMAGE_EDGE / Math.max(bitmap.width, bitmap.height),
    );
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("浏览器无法处理这张图片。");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.drawImage(bitmap, 0, 0, width, height);
    return {
      id: crypto.randomUUID(),
      name: blob instanceof File && blob.name ? blob.name : fallbackName,
      mediaType: "image/jpeg",
      dataUrl: canvas.toDataURL("image/jpeg", 0.88),
      width,
      height,
    };
  } finally {
    bitmap.close();
  }
}



export function renderPendingChatImages(): void {
  chatAttachmentsElement.replaceChildren();
  chatAttachmentsElement.hidden = pendingChatImages.value.length === 0;
  for (const attachment of pendingChatImages.value) {
    const item = document.createElement("div");
    item.className = "chat-attachment";
    const image = document.createElement("img");
    image.src = attachment.dataUrl;
    image.alt = attachment.name;
    image.title = attachment.name;
    image.tabIndex = 0;
    image.setAttribute("role", "button");
    image.setAttribute("aria-label", `放大查看 ${attachment.name}`);
    image.addEventListener("click", () =>
      openChatImagePreview(image.src, image.alt),
    );
    image.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      openChatImagePreview(image.src, image.alt);
    });
    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "chat-attachment-remove";
    removeButton.textContent = "×";
    removeButton.setAttribute("aria-label", `移除 ${attachment.name}`);
    removeButton.addEventListener("click", () => {
      pendingChatImages.value = pendingChatImages.value.filter(
        (imageItem) => imageItem.id !== attachment.id,
      );
      renderPendingChatImages();
    });
    item.append(image, removeButton);
    chatAttachmentsElement.append(item);
  }
}



export async function addChatImageFiles(files: Iterable<Blob>): Promise<void> {
  const availableSlots = MAX_CHAT_IMAGE_COUNT - pendingChatImages.value.length;
  if (availableSlots <= 0) {
    setStatus(`一次最多添加 ${MAX_CHAT_IMAGE_COUNT} 张截图。`, true);
    return;
  }
  const candidates = Array.from(files).slice(0, availableSlots);
  for (const [index, file] of candidates.entries()) {
    try {
      pendingChatImages.value.push(
        await createChatImageAttachment(file, `screenshot-${index + 1}.png`),
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error), true);
    }
  }
  renderPendingChatImages();
  chatInput.focus();
}

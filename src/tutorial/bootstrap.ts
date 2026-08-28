import DOMPurify from "dompurify";
import { marked } from "marked";
import { PROVIDER_GUIDES, type ProviderGuide } from "./provider-guides";

function renderProviderNavigation(
  container: HTMLElement,
  activeGuide: ProviderGuide,
  selectGuide: (guide: ProviderGuide) => void,
): void {
  container.replaceChildren();

  for (const guide of PROVIDER_GUIDES) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "provider-guide-link";
    button.classList.toggle("active", guide.id === activeGuide.id);
    button.setAttribute("aria-current", guide.id === activeGuide.id ? "page" : "false");
    button.innerHTML = `<span aria-hidden="true">${guide.shortName}</span><span><strong>${guide.name}</strong><small>${guide.description}</small></span>`;
    button.addEventListener("click", () => selectGuide(guide));
    container.append(button);
  }
}

function renderGuide(container: HTMLElement, guide: ProviderGuide): void {
  const html = marked.parse(guide.markdown, { gfm: true, breaks: false });
  container.innerHTML = DOMPurify.sanitize(html as string);

  for (const link of container.querySelectorAll<HTMLAnchorElement>("a[href^='http']")) {
    link.target = "_blank";
    link.rel = "noreferrer noopener";
  }

  for (const image of container.querySelectorAll<HTMLImageElement>("img")) {
    image.classList.add("tutorial-zoomable-image");
    image.tabIndex = 0;
    image.setAttribute("role", "button");
    image.setAttribute("aria-label", `放大查看：${image.alt || "教程截图"}`);
  }
}

export function bootstrapTutorial(): void {
  const navigation = document.querySelector<HTMLElement>("#provider-guide-navigation");
  const content = document.querySelector<HTMLElement>("#tutorial-content");
  const lightbox = document.querySelector<HTMLDialogElement>("#tutorial-image-lightbox");
  const lightboxImage = document.querySelector<HTMLImageElement>("#tutorial-image-lightbox-image");
  const lightboxClose = document.querySelector<HTMLButtonElement>("#tutorial-image-lightbox-close");
  const initialGuide = PROVIDER_GUIDES[0];
  if (!navigation || !content || !lightbox || !lightboxImage || !lightboxClose || !initialGuide) return;

  const openImageLightbox = (image: HTMLImageElement): void => {
    lightboxImage.src = image.currentSrc || image.src;
    lightboxImage.alt = image.alt;
    lightbox.showModal();
    lightboxClose.focus();
  };

  const closeImageLightbox = (): void => {
    if (lightbox.open) lightbox.close();
  };

  content.addEventListener("click", (event) => {
    const image = event.target instanceof HTMLImageElement
      ? event.target.closest<HTMLImageElement>(".tutorial-zoomable-image")
      : null;
    if (image) openImageLightbox(image);
  });
  content.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const image = event.target instanceof HTMLImageElement
      ? event.target.closest<HTMLImageElement>(".tutorial-zoomable-image")
      : null;
    if (!image) return;
    event.preventDefault();
    openImageLightbox(image);
  });
  lightboxClose.addEventListener("click", closeImageLightbox);
  lightbox.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeImageLightbox();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !lightbox.open) return;
    event.preventDefault();
    closeImageLightbox();
  });
  lightbox.addEventListener("click", (event) => {
    if (event.target === lightbox || event.target instanceof HTMLElement && event.target.classList.contains("image-lightbox-stage")) {
      closeImageLightbox();
    }
  });
  lightbox.addEventListener("close", () => {
    lightboxImage.removeAttribute("src");
    lightboxImage.alt = "";
  });

  const selectGuide = (guide: ProviderGuide): void => {
    renderGuide(content, guide);
    renderProviderNavigation(navigation, guide, selectGuide);
    document.title = `${guide.name} API Key 申请指南 · PDFPal`;
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  selectGuide(initialGuide);
}

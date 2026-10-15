import {
  findBar,
  findCloseButton,
  findInput,
  findNextButton,
  findPreviousButton,
  nextButton,
  pageNumberInput,
  previousButton,
  quickCurrentLocationButton,
  quickLastLocationButton,
  zoomInButton,
  zoomOutButton,
} from "../../viewer-elements";
import {
  closeFindBar,
  navigateToPdfPageWhenVisible,
  runSearch,
  updateControls,
} from "../../../core/pdf-reader/public";
import { returnToLastReadingPosition } from "../../../features/recent-files/public";
import { pdfDocument, pdfViewer } from "../../viewer-state";

export function registerReaderNavigationEvents(): void {
  previousButton.addEventListener("click", () => {
    if (pdfViewer.currentPageNumber > 1) pdfViewer.currentPageNumber -= 1;
  });

  nextButton.addEventListener("click", () => {
    if (
      pdfDocument.value &&
      pdfViewer.currentPageNumber < pdfDocument.value.numPages
    ) {
      pdfViewer.currentPageNumber += 1;
    }
  });

  pageNumberInput.addEventListener("change", () => {
    const page = Number(pageNumberInput.value);
    if (
      pdfDocument.value &&
      Number.isInteger(page) &&
      page >= 1 &&
      page <= pdfDocument.value.numPages
    ) {
      navigateToPdfPageWhenVisible(page);
    } else {
      updateControls();
    }
  });

  quickCurrentLocationButton.addEventListener("click", () => {
    navigateToPdfPageWhenVisible(pdfViewer.currentPageNumber);
  });

  quickLastLocationButton.addEventListener("click", () => {
    returnToLastReadingPosition();
  });

  zoomOutButton.addEventListener("click", () => {
    pdfViewer.currentScale = Math.max(0.25, pdfViewer.currentScale / 1.1);
  });

  zoomInButton.addEventListener("click", () => {
    pdfViewer.currentScale = Math.min(5, pdfViewer.currentScale * 1.1);
  });

  findBar.addEventListener("submit", (event) => {
    event.preventDefault();
    runSearch(false, true);
  });

  findInput.addEventListener("input", () => runSearch(false, false));

  findPreviousButton.addEventListener("click", () => runSearch(true, true));

  findNextButton.addEventListener("click", () => runSearch(false, true));

  findCloseButton.addEventListener("click", closeFindBar);
}

import type { KnowledgeItem, SavedPaperOverview } from "../../core/pdf-reader/public";
import {
  normalizePaperVenueYearDisplay,
  readSavedPaperCards,
  readSavedPaperOverviews,
} from "../paper-card/public";

export interface PaperLibraryCardMetadata {
  venueYear: string;
  authors: string;
}

function normalizeDocumentName(value: string): string {
  return value
    .trim()
    .replace(/\.pdf$/i, "")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function findLinkedOverview(item: KnowledgeItem): SavedPaperOverview | undefined {
  const overviews = readSavedPaperOverviews();

  if (item.source === "paper-overview") {
    return overviews.find((overview) => overview.id === item.id);
  }

  if (item.source !== "reading-card") return undefined;

  const readingCard = readSavedPaperCards().find((card) => card.id === item.id);
  if (!readingCard) return undefined;

  if (readingCard.paperOverviewId) {
    const linked = overviews.find(
      (overview) => overview.id === readingCard.paperOverviewId,
    );
    if (linked) return linked;
  }

  if (readingCard.documentId) {
    const linked = overviews.find(
      (overview) => overview.documentId === readingCard.documentId,
    );
    if (linked) return linked;
  }

  const documentName = normalizeDocumentName(readingCard.documentName);
  return overviews.find(
    (overview) => normalizeDocumentName(overview.documentName) === documentName,
  );
}

function inferVenueYearFromDocumentName(item: KnowledgeItem): string {
  const documentName = item.documentName.replace(/\.pdf$/i, "").trim();
  const year = documentName.match(/\b(?:19|20)\d{2}\b/)?.[0] ?? "";

  const knownVenue = documentName.match(
    /\b(USENIX|EUROCRYPT|CRYPTO|TIFS|TDSC|CCS|NDSS|S&P|IEEE|ACM|AAAI|NEURIPS|ICML|ICLR)\b/i,
  )?.[1];

  if (knownVenue) {
    const venue = knownVenue.toUpperCase() === "NEURIPS"
      ? "NeurIPS"
      : knownVenue.toUpperCase();
    return year ? `${venue} · ${year}` : venue;
  }

  return year ? `${item.title} · ${year}` : item.title;
}

export function getPaperLibraryCardMetadata(
  item: KnowledgeItem,
): PaperLibraryCardMetadata | null {
  if (
    item.originMode !== "paper"
    || (item.source !== "paper-overview" && item.source !== "reading-card")
  ) {
    return null;
  }

  const overview = findLinkedOverview(item);

  const venueYear = overview?.venueYear?.trim()
    ? normalizePaperVenueYearDisplay(overview.venueYear, overview.title)
    : inferVenueYearFromDocumentName(item);

  return {
    venueYear,
    authors: overview?.authors?.trim() ?? "",
  };
}

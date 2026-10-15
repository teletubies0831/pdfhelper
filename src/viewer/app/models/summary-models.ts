import type { SummaryScope } from "../../core/pdf-reader/reader-controls";
import { createStateCell } from "../state-cell";

export interface SummaryContext {
  scope: SummaryScope;
  rangeLabel: string;
  sourceLabel: string;
  positionLabel: string;
  text: string;
}

export interface SavedSummaryNote {
  id: string;
  documentName: string;
  scope: SummaryScope;
  rangeLabel: string;
  sourceLabel: string;
  positionLabel: string;
  points: string[];
  createdAt: string;
}

export const summaryAbortController = createStateCell<AbortController | null>(null);

export const activeSummaryScope = createStateCell<SummaryScope>("selection");

export const lastSummaryRequestKey = createStateCell("");

export const lastSummaryPoints = createStateCell<string[]>([]);

export const currentSummaryContext = createStateCell<SummaryContext | null>(null);

export const summaryGenerationTimer = createStateCell<ReturnType<typeof setTimeout> | null>(null);

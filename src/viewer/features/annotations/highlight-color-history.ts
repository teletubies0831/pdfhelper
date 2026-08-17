import {
  highlightColorHistoryButtons,
  quickHighlightButtons,
} from "../../app/viewer-elements";
import {
  readJsonValue,
  writeJsonValue,
} from "../../../platform/storage/browser-json-repository";

const HIGHLIGHT_COLOR_HISTORY_STORAGE_KEY =
  "pdf-helper.highlight-color-history.v1";
const HIGHLIGHT_COLOR_HISTORY_LIMIT = 3;
const MINIMUM_HIGHLIGHT_COLOR_DISTANCE = 18;
const DEFAULT_HIGHLIGHT_COLOR = "#fff066";
const DEFAULT_HIGHLIGHT_COLOR_HISTORY = [
  DEFAULT_HIGHLIGHT_COLOR,
  "#ff9fc9",
  "#9be7a5",
];

function normalizeHighlightColor(value: unknown): string | null {
  if (typeof value !== "string" || !/^#[0-9a-f]{6}$/i.test(value)) {
    return null;
  }
  return value.toLowerCase();
}

function convertHexToLab(color: string): [number, number, number] {
  const rgb = Number.parseInt(color.slice(1), 16);
  const channels = [rgb >> 16, (rgb >> 8) & 0xff, rgb & 0xff].map((value) => {
    const channel = value / 255;
    return channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  });
  const [red = 0, green = 0, blue = 0] = channels;
  const xyz = [
    (red * 0.4124564 + green * 0.3575761 + blue * 0.1804375) / 0.95047,
    red * 0.2126729 + green * 0.7151522 + blue * 0.072175,
    (red * 0.0193339 + green * 0.119192 + blue * 0.9503041) / 1.08883,
  ].map((value) =>
    value > 216 / 24389
      ? Math.cbrt(value)
      : (841 / 108) * value + 4 / 29,
  );
  const [x = 0, y = 0, z = 0] = xyz;
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

function getHighlightColorDistance(left: string, right: string): number {
  const leftLab = convertHexToLab(left);
  const rightLab = convertHexToLab(right);
  return Math.hypot(
    leftLab[0] - rightLab[0],
    leftLab[1] - rightLab[1],
    leftLab[2] - rightLab[2],
  );
}

function completeHighlightColorHistory(values: unknown[]): string[] {
  const colors: string[] = [];
  for (const value of [...values, ...DEFAULT_HIGHLIGHT_COLOR_HISTORY]) {
    const color = normalizeHighlightColor(value);
    if (
      !color ||
      colors.some(
        (existingColor) =>
          getHighlightColorDistance(existingColor, color) <
          MINIMUM_HIGHLIGHT_COLOR_DISTANCE,
      )
    ) {
      continue;
    }
    colors.push(color);
    if (colors.length === HIGHLIGHT_COLOR_HISTORY_LIMIT) break;
  }
  return colors;
}

function readHighlightColorHistory(): string[] {
  const stored = readJsonValue<unknown>(HIGHLIGHT_COLOR_HISTORY_STORAGE_KEY, []);
  return completeHighlightColorHistory(Array.isArray(stored) ? stored : []);
}

function persistHighlightColorHistory(colors: string[]): void {
  try {
    writeJsonValue(HIGHLIGHT_COLOR_HISTORY_STORAGE_KEY, colors);
  } catch {
    // Color selection remains usable when browser storage is unavailable.
  }
}

function renderHighlightColorHistory(
  colors: string[],
  selectedColor: string,
): void {
  const normalizedSelectedColor = normalizeHighlightColor(selectedColor);
  highlightColorHistoryButtons.forEach((button, index) => {
    const color = colors[index];
    if (!color) {
      button.hidden = true;
      button.removeAttribute("data-highlight-color");
      return;
    }
    button.hidden = false;
    button.dataset.highlightColor = color;
    button.style.setProperty("--recent-highlight-color", color);
    button.title = `使用最近颜色 ${color.toUpperCase()}`;
    button.setAttribute("aria-label", `使用最近颜色 ${color.toUpperCase()}`);
    button.setAttribute(
      "aria-pressed",
      String(color === normalizedSelectedColor),
    );
  });

  quickHighlightButtons.forEach((button, index) => {
    const color = colors[index];
    if (!color) {
      button.hidden = true;
      button.removeAttribute("data-quick-highlight-color");
      button.style.removeProperty("--quick-highlight-color");
      return;
    }
    button.hidden = false;
    button.dataset.quickHighlightColor = color;
    button.style.setProperty("--quick-highlight-color", color);
    button.title = `使用最近颜色 ${color.toUpperCase()}`;
    button.setAttribute("aria-label", `使用最近颜色 ${color.toUpperCase()}`);
  });
}

export function initializeHighlightColorHistory(): string {
  const colors = readHighlightColorHistory();
  const selectedColor = colors[0] ?? DEFAULT_HIGHLIGHT_COLOR;
  persistHighlightColorHistory(colors);
  renderHighlightColorHistory(colors, selectedColor);
  return selectedColor;
}

export function rememberHighlightColor(color: string): void {
  const normalizedColor = normalizeHighlightColor(color);
  if (!normalizedColor) return;
  const colors = completeHighlightColorHistory([
    normalizedColor,
    ...readHighlightColorHistory(),
  ]);
  persistHighlightColorHistory(colors);
  renderHighlightColorHistory(colors, normalizedColor);
}

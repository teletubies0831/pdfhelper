export interface VerticalClientRegion {
  top: number;
  bottom: number;
  width?: number;
  height?: number;
}

export function calculateCenteredScrollTop({
  currentScrollTop,
  viewportTop,
  viewportHeight,
  regionTop,
  regionBottom,
  maximumScrollTop,
}: {
  currentScrollTop: number;
  viewportTop: number;
  viewportHeight: number;
  regionTop: number;
  regionBottom: number;
  maximumScrollTop: number;
}): number {
  const regionCenter = (regionTop + regionBottom) / 2;
  const viewportCenter = viewportTop + viewportHeight / 2;
  const requested = currentScrollTop + regionCenter - viewportCenter;
  return Math.min(Math.max(0, maximumScrollTop), Math.max(0, requested));
}

/** Centers the union of all supplied client rectangles in a scroll viewport. */
export function centerClientRegionsInScrollContainer(
  container: HTMLElement,
  regions: readonly VerticalClientRegion[],
): number | null {
  const visibleRegions = regions.filter((region) =>
    Number.isFinite(region.top)
    && Number.isFinite(region.bottom)
    && region.bottom > region.top
    && (region.width === undefined || region.width > 0)
    && (region.height === undefined || region.height > 0));
  if (visibleRegions.length === 0 || container.clientHeight <= 0) return null;
  const bounds = container.getBoundingClientRect();
  const scrollTop = calculateCenteredScrollTop({
    currentScrollTop: container.scrollTop,
    viewportTop: bounds.top + container.clientTop,
    viewportHeight: container.clientHeight,
    regionTop: Math.min(...visibleRegions.map((region) => region.top)),
    regionBottom: Math.max(...visibleRegions.map((region) => region.bottom)),
    maximumScrollTop: container.scrollHeight - container.clientHeight,
  });
  container.scrollTop = scrollTop;
  return scrollTop;
}

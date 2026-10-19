import { setStatus } from '../../app/status-bar';

/**
 * Graph export: the current graph as a PNG image.
 *
 * There used to be a JSON export/import pair as well. Once the graph became a projection of the knowledge base,
 * importing a file was the odd one out — it restored papers and entities that no document in the library owned, which
 * the next sync would then treat as stale records. Exporting an image needs no such contract: a picture is a
 * picture, it cannot be half-imported, and it cannot disagree with the library.
 *
 * The mechanics are spelled out rather than assumed: an object URL, an `<a download>`, and an explicit revoke.
 * `revokeObjectURL` runs after a delay instead of immediately, because revoking in the same tick races the browser's
 * own read of the blob on some builds — a bug that only shows up as an occasional empty file.
 */

/** `canvas.toBlob` as a promise; resolves `null` if the browser refuses to encode. */
function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), 'image/png');
  });
}

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.rel = 'noopener';
  document.body.append(link);
  link.click();
  link.remove();
  // Not revoked synchronously: the browser may not have read the blob yet.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * Encodes a rendered graph canvas and hands it to the browser as a download.
 *
 * `counts` comes from the snapshot that produced the canvas, so the status line cannot describe a different graph
 * than the picture.
 */
export async function downloadGraphImage(
  image: { canvas: HTMLCanvasElement; fileName: string },
  counts: { papers: number; entities: number },
): Promise<void> {
  const blob = await canvasToPngBlob(image.canvas);
  if (!blob) {
    setStatus('导出失败：浏览器无法把图谱编码为 PNG，请重试。', true);
    return;
  }
  downloadBlob(blob, image.fileName);
  setStatus(
    `已导出 ${image.fileName}：${counts.papers} 篇文献、${counts.entities} 个实体`
    + `（${image.canvas.width}×${image.canvas.height} 像素，${Math.round(blob.size / 1024)} KB）。`,
  );
}

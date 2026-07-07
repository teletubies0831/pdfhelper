const PDF_EXTENSION = '.pdf';

function isDirectPdfUrl(url: URL): boolean {
  return (
    (url.protocol === 'http:' ||
      url.protocol === 'https:' ||
      url.protocol === 'file:') &&
    url.pathname.toLowerCase().endsWith(PDF_EXTENSION)
  );
}

export function extractPdfSource(tabUrl?: string): string | null {
  if (!tabUrl) return null;

  try {
    const url = new URL(tabUrl);
    if (isDirectPdfUrl(url)) return url.href;

    for (const key of ['file', 'url', 'source']) {
      const candidate = url.searchParams.get(key);
      if (!candidate) continue;

      try {
        const candidateUrl = new URL(candidate);
        if (isDirectPdfUrl(candidateUrl)) return candidateUrl.href;
      } catch {
        // Continue with embedded URL detection below.
      }
    }

    if (url.protocol === 'chrome-extension:' || url.protocol === 'edge-extension:') {
      const decoded = decodeURIComponent(url.href);
      for (const protocol of ['file:///', 'https://', 'http://']) {
        const start = decoded.indexOf(protocol);
        if (start < 0) continue;

        const candidate = decoded.slice(start);
        const pdfEnd = candidate.toLowerCase().indexOf(PDF_EXTENSION);
        if (pdfEnd >= 0) return candidate.slice(0, pdfEnd + PDF_EXTENSION.length);
      }
    }
  } catch {
    return null;
  }

  return null;
}

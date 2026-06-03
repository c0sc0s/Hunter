export const htmlFetchLimits = {
  timeoutMs: 9_000,
  maxBytes: 1_200_000
};

const acceptedContentTypes = ["text/html", "application/xhtml+xml", "text/plain"];

export async function fetchHtmlDocument(url: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), htmlFetchLimits.timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Huntter/0.1 (+https://localhost)"
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch ${url}: HTTP ${response.status}`);
    }

    assertHtmlContentType(url, response.headers.get("content-type"));
    assertContentLength(url, response.headers.get("content-length"));
    return await readBoundedText(url, response);
  } finally {
    clearTimeout(timeout);
  }
}

function assertHtmlContentType(url: string, contentType: string | null): void {
  if (!contentType) return;
  const normalized = contentType.toLowerCase().split(";")[0]?.trim() ?? "";
  if (!acceptedContentTypes.includes(normalized)) {
    throw new Error(`Skipped ${url}: expected HTML content, received ${contentType}`);
  }
}

function assertContentLength(url: string, contentLength: string | null): void {
  const bytes = Number(contentLength);
  if (Number.isFinite(bytes) && bytes > htmlFetchLimits.maxBytes) {
    throw new Error(`Skipped ${url}: HTML response is larger than ${htmlFetchLimits.maxBytes} bytes`);
  }
}

async function readBoundedText(url: string, response: Response): Promise<string> {
  if (!response.body) {
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > htmlFetchLimits.maxBytes) {
      throw new Error(`Skipped ${url}: HTML response is larger than ${htmlFetchLimits.maxBytes} bytes`);
    }
    return new TextDecoder().decode(buffer);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let receivedBytes = 0;
  let html = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      receivedBytes += value.byteLength;
      if (receivedBytes > htmlFetchLimits.maxBytes) {
        await reader.cancel();
        throw new Error(`Skipped ${url}: HTML response is larger than ${htmlFetchLimits.maxBytes} bytes`);
      }

      html += decoder.decode(value, { stream: true });
    }

    return html + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

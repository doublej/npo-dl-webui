import { sleep } from '../../lib/utils.js';

/**
 * Wait for HTTP response with specific suffix
 * @param {Page} page
 * @param {string} suffix
 * @returns {Promise<HTTPResponse>}
 */
export async function waitResponseSuffix(page, suffix) {
  const response = page.waitForResponse(async (response) => {
    const request = response.request();
    const method = request.method().toUpperCase();

    if (method != "GET" && method != "POST") {
      return false;
    }
    const url = response.url();
    if (!url.endsWith(suffix)) {
      return false;
    }

    console.log(`request: ${url} method: ${method}`);
    try {
      const body = await response.buffer();
    } catch (error) {
      console.error("preflight error");
      return false;
    }

    return url.endsWith(suffix);
  });
  return await response;
}

/**
 * Generate filename from page elements
 * @param {Page} page
 * @returns {Promise<string>}
 */
export async function generateFileName(page) {
  // Ensure the player info block is present
  try {
    await page.waitForSelector('[data-testid="player-info"]', { timeout: 10000 });
  } catch (_) {
    // Fall back silently; we'll still try to read whatever we can
  }

  // Extract robust metadata using stable data-testid hooks
  const info = await page.evaluate(() => {
    const scope = document.querySelector('[data-testid="player-info"]');

    const title = scope?.querySelector('[data-testid="txt-header"]')?.textContent?.trim() ?? null;

    const metaText = scope?.querySelector('[data-testid="txt-metadata"]')?.innerText?.trim() ?? "";
    const parts = metaText.split("•").map(s => s.trim());

    let episodeNumber = null;
    const m = /Afl\.\s*(\d+)/i.exec(parts[0] || "");
    if (m) episodeNumber = Number(m[1]);

    return { title, episodeNumber };
  });

  // Build filename with available data
  let filename = '';
  if (info?.episodeNumber != null && !Number.isNaN(info.episodeNumber)) {
    filename += `E${String(info.episodeNumber).padStart(2, '0')} - `;
  }
  filename += (info?.title || 'episode');

  // Sanitize filename
  filename = filename.replace(/[\/\\?%*:|"<>]/g, '#');
  return filename;
}

/**
 * Extracts episode details from the player info block using stable data-testid selectors.
 * @param {Page} page
 * @returns {Promise<{title: string|null, episodeNumber: number|null, airing: string|null, description: string|null}>}
 */
export async function extractPlayerInfo(page) {
  await page.waitForSelector('[data-testid="player-info"]');
  const result = await page.evaluate(() => {
    const scope = document.querySelector('[data-testid="player-info"]');

    const title = scope?.querySelector('[data-testid="txt-header"]')?.textContent?.trim() ?? null;

    const metaText = scope?.querySelector('[data-testid="txt-metadata"]')?.innerText?.trim() ?? "";
    const parts = metaText.split("•").map(s => s.trim());

    let episodeNumber = null;
    const m = /Afl\.\s*(\d+)/i.exec(parts[0] || "");
    if (m) episodeNumber = Number(m[1]);

    const airing = parts[1] || null;

    let description = scope?.querySelector('p[data-testid="txt-synopsis"]')?.innerText?.trim() ?? null;
    if (description) {
      description = description.replace(/\s*Lees meer\s*$/i, '').trim();
    }

    return { title, episodeNumber, airing, description };
  });
  return result;
}

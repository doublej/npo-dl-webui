/**
 * @typedef {import('puppeteer').HTTPResponse} HTTPResponse
 * @typedef {import('puppeteer').Page} Page
 */

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

    if (method !== "GET" && method !== "POST") {
      return false;
    }
    const url = response.url();
    if (!url.endsWith(suffix)) {
      return false;
    }

    console.log(`request: ${url} method: ${method}`);
    try {
      await response.buffer();
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
 * @returns {Promise<{title: string|null, seriesTitle: string|null, episodeNumber: number|null, seasonNumber: number|null, airing: string|null, description: string|null}>}
 */
export async function extractPlayerInfo(page) {
  await page.waitForSelector('[data-testid="player-info"]');
  return await page.evaluate(() => {
    const scope = document.querySelector('[data-testid="player-info"]');

    // The episode title
    const title = scope?.querySelector('[data-testid="txt-header"]')?.textContent?.trim() ?? null;

    // Try to find series title - often in breadcrumb or in a parent element
    let seriesTitle = null;

    // First try: Look for series title in breadcrumb navigation
    const breadcrumb = document.querySelector('nav[aria-label="Breadcrumb"]');
    if (breadcrumb) {
      const links = breadcrumb.querySelectorAll('a');
      // Usually the series is the second-to-last item in breadcrumb
      if (links.length >= 2) {
        seriesTitle = links[links.length - 2]?.textContent?.trim();
      }
    }

    // Second try: Look for series link near the player
    if (!seriesTitle) {
      const seriesLink = document.querySelector('a[href*="/start/serie/"]');
      if (seriesLink && !seriesLink.href.includes('/afspelen')) {
        seriesTitle = seriesLink.textContent?.trim();
      }
    }

    // Third try: Extract from the title if it follows a pattern
    if (!seriesTitle && title) {
      // If title is the series name itself (common for first episodes)
      seriesTitle = title;
    }

    const metaText = scope?.querySelector('[data-testid="txt-metadata"]')?.innerText?.trim() ?? "";
    const parts = metaText.split("•").map(s => s.trim());

    let episodeNumber = null;
    let seasonNumber = null;

    // Look for episode number (Afl. X)
    const episodeMatch = /Afl\.\s*(\d+)/i.exec(parts[0] || "");
    if (episodeMatch) episodeNumber = Number(episodeMatch[1]);

    // Look for season number (Seizoen X or S X)
    const seasonMatch = /(?:Seizoen|S)\s*(\d+)/i.exec(metaText);
    if (seasonMatch) seasonNumber = Number(seasonMatch[1]);

    const airing = parts[1] || null;

    let description = scope?.querySelector('p[data-testid="txt-synopsis"]')?.innerText?.trim() ?? null;
    if (description) {
      description = description.replace(/\s*Lees meer\s*$/i, '').trim();
    }

    return { title, seriesTitle, episodeNumber, seasonNumber, airing, description };
  });
}


// Clearer aliases (non-breaking)
export {
  waitResponseSuffix as waitForResponseWithSuffix,
  generateFileName as buildOutputFilename,
  extractPlayerInfo as parsePlayerInfoFromPage,
};

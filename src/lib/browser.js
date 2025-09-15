import { launch } from "puppeteer-core";
import { getConfig } from '../config/env.js';

let browserInstance = null;

/**
 * Build launch options based on configuration.
 * @param {ReturnType<typeof getConfig>} config
 */
function buildLaunchOptions(config) {
  return {
    headless: config.HEADLESS,
    channel: "chrome",
  };
}

/**
 * Launch browser instance (singleton).
 * @returns {Promise<import('puppeteer-core').Browser>}
 */
export async function launchBrowser() {
  if (browserInstance) {
    return browserInstance;
  }

  const config = getConfig();

  try {
    browserInstance = await launch(buildLaunchOptions(config));

    console.log('Browser launched successfully');
    return browserInstance;
  } catch (error) {
    console.error('Failed to launch browser:', error.message);
    throw error;
  }
}

/**
 * Get browser instance (launch if needed).
 * @returns {Promise<import('puppeteer-core').Browser>}
 */
export async function getBrowser() {
  if (!browserInstance) {
    return await launchBrowser();
  }
  return browserInstance;
}

/**
 * Whether a browser instance is currently open.
 * @returns {boolean}
 */
export function isBrowserOpen() {
  return Boolean(browserInstance);
}

/**
 * Close browser instance if open.
 */
export async function closeBrowser() {
  if (browserInstance) {
    try {
      await browserInstance.close();
      console.log('Browser closed successfully');
    } catch (error) {
      console.error('Error closing browser:', error.message);
    } finally {
      browserInstance = null;
    }
  }
}

/**
 * Create a new page with common settings and a clean state.
 * @returns {Promise<import('puppeteer-core').Page>}
 */
export async function createPage() {
  const browser = await getBrowser();
  const page = await browser.newPage();

  // Clear all cookies to ensure clean state
  console.log('Clearing all browser cookies...');
  const client = await page.target().createCDPSession();
  await client.send('Network.clearBrowserCookies');
  await client.send('Network.clearBrowserCache');
  console.log('✓ Browser cookies and cache cleared');

  // Also clear any localStorage and sessionStorage
  await page.evaluateOnNewDocument(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  // Set common page settings
  await page.setViewport({ width: 1280, height: 720 });

  return page;
}

/**
 * Graceful shutdown handler to close the browser.
 */
export async function gracefulShutdown() {
  console.log('Shutting down browser...');
  await closeBrowser();
}

// Handle process cleanup
process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);
process.on('exit', gracefulShutdown);

// Clearer alias exports to improve readability in callers while keeping compatibility
export { createPage as openPage, gracefulShutdown as registerGracefulShutdown };

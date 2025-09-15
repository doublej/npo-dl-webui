import { launch } from "puppeteer-core";
import { getConfig } from '../config/env.js';

let browserInstance = null;

// Launch browser instance
export async function launchBrowser() {
  if (browserInstance) {
    return browserInstance;
  }

  const config = getConfig();

  try {
    browserInstance = await launch({
      headless: config.HEADLESS,
      channel: "chrome"
    });

    console.log('Browser launched successfully');
    return browserInstance;
  } catch (error) {
    console.error('Failed to launch browser:', error.message);
    throw error;
  }
}

// Get browser instance (launch if needed)
export async function getBrowser() {
  if (!browserInstance) {
    return await launchBrowser();
  }
  return browserInstance;
}

// Close browser instance
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

// Create new page with common settings
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

// Graceful shutdown
export async function gracefulShutdown() {
  console.log('Shutting down browser...');
  await closeBrowser();
}

// Handle process cleanup
process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);
process.on('exit', gracefulShutdown);
import { createPage } from '../../lib/browser.js';
import { getConfig } from '../../config/env.js';
import { sleep } from '../../lib/utils/time.js';
import { waitResponseSuffix } from './utils.js';
import { writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import logger from '../../lib/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROFILES_FILE = join(__dirname, '../../../profiles.json');

// Save profiles to file
async function saveProfiles(profiles) {
  try {
    await writeFile(PROFILES_FILE, JSON.stringify(profiles, null, 2));
    logger.debug('Profile', `Saved ${profiles.length} profiles to cache`);
  } catch (error) {
    logger.error('Profile', `Failed to save profiles: ${error.message}`);
  }
}

// Load profiles from file
async function loadProfiles() {
  try {
    if (existsSync(PROFILES_FILE)) {
      const data = await readFile(PROFILES_FILE, 'utf-8');
      return JSON.parse(data);
    }
  } catch (error) {
    logger.error('Profile', `Failed to load profiles: ${error.message}`);
  }
  return null;
}

// Get cached profiles without logging in
export async function getCachedProfiles() {
  return await loadProfiles();
}

export async function npoLogin(options = {}) {
  logger.group('NPO LOGIN');

  const config = getConfig();
  const profileToUse = options.profile || config.NPO_PROFILE;

  logger.debug('Login', `Profile: ${profileToUse || 'not specified'}`);
  logger.debug('Login', `Credentials: ${config.NPO_EMAIL && config.NPO_PASSW ? 'configured' : 'missing'}`);

  // Use provided page or create a new one
  let page = options.page;
  const shouldClosePage = !page;
  if (!page) {
    page = await createPage();
    logger.debug('Login', 'Browser page created');
  }

  logger.info('Login', 'Navigating to NPO Start...');
  await page.goto("https://npo.nl/start");
  logger.debug('Login', `Current URL: ${page.url()}`);

  // check that email and password are set
  if (!config.NPO_EMAIL || !config.NPO_PASSW) {
    logger.error('Login', 'NPO credentials not configured in .env file');
    if (shouldClosePage) await page.close();
    logger.groupEnd();
    return;
  }

  logger.info('Login', 'Clicking login button...');
  await page.waitForSelector("div[data-testid='btn-login']");
  await page.click("div[data-testid='btn-login']");

  logger.info('Login', 'Entering credentials...');
  await page.waitForSelector("#EmailAddress");
  await page.$eval("#EmailAddress", (el, secret) => el.value = secret, config.NPO_EMAIL);
  await page.$eval("#Password", (el, secret) => el.value = secret, config.NPO_PASSW);

  await sleep(1000);

  logger.info('Login', 'Submitting login form...');
  await page.waitForSelector("button[value='login']");
  await page.click("button[value='login']");

  // Wait for profile selection screen
  logger.info('Login', 'Checking for profile selection...');
  try {
    await page.waitForSelector("div[data-testid='profiles']", { timeout: 10000 });
    await sleep(2000); // Let profiles fully load
    await page.waitForSelector("button[data-testid*='btn-profile']", { timeout: 5000 });

    // Extract all profile options (excluding "nieuw")
    const profiles = await page.evaluate(() => {
      // Try multiple selectors to find profile buttons
      let profileElements = document.querySelectorAll("button[data-testid*='-btn-profile']");

      if (profileElements.length === 0) {
        profileElements = document.querySelectorAll("button[data-testid*='btn-profile']");
      }

      if (profileElements.length === 0) {
        profileElements = document.querySelectorAll("button.group.w-full.bg-transparent.cursor-pointer");
      }

      const profileList = [];

      profileElements.forEach((button) => {
        const testId = button.getAttribute('data-testid');

        // Skip the "add profile" button
        if (testId === 'btn-profile-add-general') return;

        // Find the name span within each profile button
        const nameElement = button.querySelector("span[data-testid='txt-name']");
        if (nameElement) {
          const profileName = nameElement.textContent.trim();

          // Skip the "nieuw" option
          if (profileName.toLowerCase() !== 'nieuw') {
            const index = testId ? testId.split('-')[0] : null;
            profileList.push({
              name: profileName,
              index: index,
              testId: testId
            });
          }
        }
      });

      return profileList;
    });

    logger.info('Login', `Found ${profiles.length} profiles: ${profiles.map(p => p.name).join(', ')}`);

    // Save profiles to file for future use
    if (profiles.length > 0) {
      await saveProfiles(profiles);
    }

    // Check if NPO_PROFILE is set (either from env or passed as option)
    const profileToSelect = options.profile || config.NPO_PROFILE;

    // If NPO_PROFILE is not set, return profiles for user selection
    if (!profileToSelect && profiles.length > 0) {
      logger.warn('Login', 'No profile specified - returning profile list');

      // Logout to prevent session establishment
      await page.goto("https://npo.nl/logout");
      await sleep(2000);

      if (shouldClosePage) {
        await page.close();
      }
      logger.groupEnd();
      return {
        success: false,
        needsProfileSelection: true,
        profiles: profiles,
        message: "Please select a profile to continue"
      };
    }

    // If profiles are found and NPO_PROFILE is set, select the specified profile
    if (profiles.length > 0 && profileToSelect) {
      const selectedProfile = profiles.find(p =>
        p.name.toLowerCase() === profileToSelect.toLowerCase()
      );

      if (selectedProfile) {
        logger.info('Login', `Selecting profile: ${selectedProfile.name}`);
        await page.click(`button[data-testid='${selectedProfile.testId}']`);
      } else {
        // Profile not found, return error
        logger.error('Login', `Profile "${profileToSelect}" not found`);
        if (shouldClosePage) {
          await page.close();
        }
        logger.groupEnd();
        return {
          success: false,
          error: `Profile "${profileToSelect}" not found`,
          profiles: profiles,
          message: `Available profiles: ${profiles.map(p => p.name).join(', ')}`
        };
      }
    }

    logger.info('Login', 'Establishing session...');
    await waitResponseSuffix(page, "session");

    if (shouldClosePage) {
      await page.close();
    }

    logger.groupEnd('Login successful');

    // Return success with selected profile
    return {
      success: true,
      profiles: profiles,
      selectedProfile: profileToSelect
    };

  } catch (error) {
    // No profile selection screen appeared, login might be direct
    console.log("⚠️ Profile selection screen not found or timed out");
    console.log("Error details:", error.message);
    console.log("Attempting direct login without profile selection...");

    try {
      console.log("Waiting for session response (direct login)...");
      await waitResponseSuffix(page, "session");
      console.log("✓ Session established (direct login)");

      if (shouldClosePage) {
        await page.close();
        console.log("✓ Browser closed");
      }
      console.log("=== LOGIN SUCCESSFUL (Direct) ===");
      return { success: true, profiles: [], selectedProfile: null };
    } catch (sessionError) {
      console.error("✗ Failed to establish session:", sessionError.message);
      if (shouldClosePage) {
        await page.close();
      }
      console.log("=== LOGIN FAILED ===");
      throw sessionError;
    }
  }
}

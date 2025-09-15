import { createPage } from '../../lib/browser.js';
import { getConfig } from '../../config/env.js';
import { sleep } from '../../lib/utils.js';
import { waitResponseSuffix } from './utils.js';
import { writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROFILES_FILE = join(__dirname, '../../../profiles.json');

// Save profiles to file
async function saveProfiles(profiles) {
  try {
    await writeFile(PROFILES_FILE, JSON.stringify(profiles, null, 2));
    console.log(`Saved ${profiles.length} profiles to profiles.json`);
  } catch (error) {
    console.error('Failed to save profiles:', error);
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
    console.error('Failed to load profiles:', error);
  }
  return null;
}

// Get cached profiles without logging in
export async function getCachedProfiles() {
  return await loadProfiles();
}

export async function npoLogin(options = {}) {
  console.log("=== NPO LOGIN FLOW STARTED ===");
  console.log("Options received:", JSON.stringify(options));

  const config = getConfig();
  console.log("Config loaded - NPO_EMAIL:", config.NPO_EMAIL ? 'SET' : 'NOT SET');
  console.log("Config loaded - NPO_PASSW:", config.NPO_PASSW ? 'SET' : 'NOT SET');
  console.log("Config loaded - NPO_PROFILE:", config.NPO_PROFILE || 'NOT SET');

  // Use provided page or create a new one
  let page = options.page;
  const shouldClosePage = !page;
  if (!page) {
    page = await createPage();
    console.log("Browser page created");
  } else {
    console.log("Using provided browser page");
  }

  console.log("Step 1: Navigating to https://npo.nl/start");
  await page.goto("https://npo.nl/start");
  console.log("Navigation complete - Current URL:", page.url());

  // check that email and password are set
  if (!config.NPO_EMAIL) {
    console.error("ERROR: NPO_EMAIL is not set in .env file");
    if (shouldClosePage) {
      await page.close();
    }
    return;
  }
  if (!config.NPO_PASSW) {
    console.error("ERROR: NPO_PASSW is not set in .env file");
    if (shouldClosePage) {
      await page.close();
    }
    return;
  }

  console.log("Step 2: Looking for login button...");
  await page.waitForSelector("div[data-testid='btn-login']");
  console.log("Login button found, clicking...");
  await page.click("div[data-testid='btn-login']");
  console.log("Login button clicked");

  console.log("Step 3: Waiting for email field...");
  await page.waitForSelector("#EmailAddress");
  console.log("Email field found, entering credentials...");
  await page.$eval("#EmailAddress", (el, secret) => el.value = secret, config.NPO_EMAIL);
  await page.$eval("#Password", (el, secret) => el.value = secret, config.NPO_PASSW);
  console.log("Credentials entered");

  console.log("Step 4: Waiting 1 second before submitting...");
  await sleep(1000);

  console.log("Step 5: Looking for login submit button...");
  await page.waitForSelector("button[value='login']");
  console.log("Submit button found, clicking...");
  await page.click("button[value='login']");
  console.log("Login form submitted");

  // Wait for profile selection screen
  console.log("Step 6: Checking for profile selection screen...");
  try {
    console.log("Waiting up to 10 seconds for profile screen...");
    await page.waitForSelector("div[data-testid='profiles']", { timeout: 10000 });
    console.log("✓ Profile selection screen FOUND!");

    // Wait a bit more for all profiles to load
    console.log("Waiting 2 seconds for profiles to fully load...");
    await sleep(2000);

    // Wait specifically for profile buttons to be present
    console.log("Looking for profile buttons...");
    await page.waitForSelector("button[data-testid*='btn-profile']", { timeout: 5000 });
    console.log("✓ Profile buttons found!");

    // Extract all profile options (excluding "nieuw")
    console.log("Step 7: Extracting available profiles...");
    const profiles = await page.evaluate(() => {
      console.log("[Browser Context] Looking for profile elements...");

      // Try multiple selectors to find profile buttons
      let profileElements = document.querySelectorAll("button[data-testid*='-btn-profile']");
      console.log(`[Browser Context] Found ${profileElements.length} elements with selector: button[data-testid*='-btn-profile']`);

      // If the above doesn't work, try another approach
      if (profileElements.length === 0) {
        profileElements = document.querySelectorAll("button[data-testid*='btn-profile']");
        console.log(`[Browser Context] Found ${profileElements.length} elements with selector: button[data-testid*='btn-profile']`);
      }

      // As a fallback, look for buttons with the specific class
      if (profileElements.length === 0) {
        profileElements = document.querySelectorAll("button.group.w-full.bg-transparent.cursor-pointer");
        console.log(`[Browser Context] Found ${profileElements.length} elements with class selector`);
      }

      const profileList = [];

      profileElements.forEach((button, i) => {
        const testId = button.getAttribute('data-testid');
        console.log(`[Browser Context] Processing button ${i}: testId="${testId}"`);

        // Skip the "add profile" button
        if (testId === 'btn-profile-add-general') {
          console.log(`[Browser Context] Skipping "add profile" button`);
          return;
        }

        // Find the name span within each profile button
        const nameElement = button.querySelector("span[data-testid='txt-name']");
        if (nameElement) {
          const profileName = nameElement.textContent.trim();
          console.log(`[Browser Context] Found profile name: "${profileName}"`);

          // Skip the "nieuw" option
          if (profileName.toLowerCase() !== 'nieuw') {
            // Extract profile index from data-testid
            const index = testId ? testId.split('-')[0] : null;

            profileList.push({
              name: profileName,
              index: index,
              testId: testId
            });
            console.log(`[Browser Context] Added profile: ${profileName} (index: ${index})`);
          } else {
            console.log(`[Browser Context] Skipping "nieuw" profile`);
          }
        } else {
          console.log(`[Browser Context] No name element found for button ${i}`);
        }
      });

      console.log(`[Browser Context] Total profiles found: ${profileList.length}`);
      return profileList;
    });

    console.log(`✓ Extracted ${profiles.length} profiles:`, profiles);

    // Save profiles to file for future use
    if (profiles.length > 0) {
      console.log("Step 8: Saving profiles to profiles.json...");
      await saveProfiles(profiles);
    }

    // Check if NPO_PROFILE is set (either from env or passed as option)
    const profileToSelect = options.profile || config.NPO_PROFILE;
    console.log("Step 9: Profile selection logic:");
    console.log("  - Profile from options:", options.profile || 'NONE');
    console.log("  - Profile from env:", config.NPO_PROFILE || 'NONE');
    console.log("  - Profile to select:", profileToSelect || 'NONE');

    // If NPO_PROFILE is not set, return profiles for user selection
    if (!profileToSelect && profiles.length > 0) {
      console.log("⚠️ NO PROFILE CONFIGURED - Returning profiles for user selection");

      // Logout to prevent session establishment
      console.log("Step 10: Logging out to cancel session...");
      console.log("Navigating to logout page...");
      await page.goto("https://npo.nl/logout");
      console.log("Logout page loaded, waiting for confirmation...");
      await sleep(2000); // Wait for logout to complete
      console.log("✓ Logged out successfully");

      console.log("Closing browser and returning profile list to UI...");
      if (shouldClosePage) {
        await page.close();
      }
      return {
        success: false,
        needsProfileSelection: true,
        profiles: profiles,
        message: "Please select a profile to continue"
      };
    }

    // If profiles are found and NPO_PROFILE is set, select the specified profile
    if (profiles.length > 0) {
      console.log(`Step 10: Looking for profile "${profileToSelect}" in list...`);
      const selectedProfile = profiles.find(p =>
        p.name.toLowerCase() === profileToSelect.toLowerCase()
      );

      if (selectedProfile) {
        console.log(`✓ Profile "${selectedProfile.name}" found! Clicking profile button...`);
        await page.click(`button[data-testid='${selectedProfile.testId}']`);
        console.log(`✓ Profile selected: ${selectedProfile.name}`);
      } else {
        // Profile not found, return error
        console.error(`✗ Profile "${profileToSelect}" NOT FOUND in available profiles`);
        console.log("Available profiles were:", profiles.map(p => p.name).join(', '));
        if (shouldClosePage) {
          await page.close();
        }
        return {
          success: false,
          error: `Profile "${profileToSelect}" not found`,
          profiles: profiles,
          message: `Available profiles: ${profiles.map(p => p.name).join(', ')}`
        };
      }
    } else {
      console.warn("⚠️ No profile buttons found, continuing without profile selection");
    }

    console.log("Step 11: Waiting for session response...");
    await waitResponseSuffix(page, "session");
    console.log("✓ Session established");

    if (shouldClosePage) {
      await page.close();
      console.log("✓ Browser closed");
    }
    console.log("=== LOGIN SUCCESSFUL ===");

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
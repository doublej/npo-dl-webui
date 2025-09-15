import { createPage } from '../../lib/browser.js';
import { getConfig } from '../../config/env.js';
import { sleep } from '../../lib/utils.js';
import { waitResponseSuffix } from './utils.js';

export async function npoLogin() {
  console.log("Starting NPO login...");
  const config = getConfig();
  const page = await createPage();

  console.log("Navigating to https://npo.nl/start");
  await page.goto("https://npo.nl/start");

  // check that email and password are set
  if (!config.NPO_EMAIL) {
    console.warn("NPO_EMAIL is not set");
    await page.close();
    return;
  }
  if (!config.NPO_PASSW) {
    console.warn("NPO_PASSW is not set");
    await page.close();
    return;
  }

  console.log("Waiting for login button...");
  await page.waitForSelector("div[data-testid='btn-login']");
  await page.click("div[data-testid='btn-login']");

  await page.waitForSelector("#EmailAddress");
  await page.$eval("#EmailAddress", (el, secret) => el.value = secret, config.NPO_EMAIL);
  await page.$eval("#Password", (el, secret) => el.value = secret, config.NPO_PASSW);

  await sleep(1000);
  await page.waitForSelector("button[value='login']");
  await page.click("button[value='login']");

  // Wait for profile selection screen
  try {
    await page.waitForSelector("div[data-testid='profiles']", { timeout: 10000 });

    // Wait a bit more for all profiles to load
    await sleep(2000);

    // Wait specifically for profile buttons to be present
    await page.waitForSelector("button[data-testid*='btn-profile']", { timeout: 5000 });

    // Extract all profile options (excluding "nieuw")
    const profiles = await page.evaluate(() => {
      // Try multiple selectors to find profile buttons
      let profileElements = document.querySelectorAll("button[data-testid*='-btn-profile']");

      // If the above doesn't work, try another approach
      if (profileElements.length === 0) {
        profileElements = document.querySelectorAll("button[data-testid*='btn-profile']");
      }

      // As a fallback, look for buttons with the specific class
      if (profileElements.length === 0) {
        profileElements = document.querySelectorAll("button.group.w-full.bg-transparent.cursor-pointer");
      }

      const profileList = [];

      profileElements.forEach(button => {
        // Skip the "add profile" button
        if (button.getAttribute('data-testid') === 'btn-profile-add-general') {
          return;
        }

        // Find the name span within each profile button
        const nameElement = button.querySelector("span[data-testid='txt-name']");
        if (nameElement) {
          const profileName = nameElement.textContent.trim();
          // Skip the "nieuw" option
          if (profileName.toLowerCase() !== 'nieuw') {
            // Extract profile index from data-testid
            const testId = button.getAttribute('data-testid') || '';
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

    console.log("Available profiles:", profiles);

    // If profiles are found, select the first one or based on config
    if (profiles.length > 0) {
      // Check if a specific profile is configured
      const selectedProfile = config.NPO_PROFILE ?
        profiles.find(p => p.name.toLowerCase() === config.NPO_PROFILE.toLowerCase()) :
        profiles[0];

      if (selectedProfile) {
        await page.click(`button[data-testid='${selectedProfile.testId}']`);
        console.log(`Selected profile: ${selectedProfile.name}`);
      } else {
        // Fallback to first profile if configured profile not found
        await page.click(`button[data-testid='${profiles[0].testId}']`);
        console.log(`Selected first available profile: ${profiles[0].name}`);
      }
    } else {
      console.warn("No profile buttons found, continuing anyway");
    }

    await waitResponseSuffix(page, "session");
    await page.close();
    console.log("Login successful");

    // Return the profiles list
    return {
      success: true,
      profiles: profiles,
      selectedProfile: profiles.length > 0 ? (config.NPO_PROFILE ?
        profiles.find(p => p.name.toLowerCase() === config.NPO_PROFILE.toLowerCase())?.name || profiles[0].name :
        profiles[0].name) : null
    };

  } catch (error) {
    // No profile selection screen appeared, login might be direct
    console.log("No profile selection screen, proceeding with direct login");
    await waitResponseSuffix(page, "session");
    await page.close();
    console.log("Login successful");
    return { success: true, profiles: [], selectedProfile: null };
  }
}
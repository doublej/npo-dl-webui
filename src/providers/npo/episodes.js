import { createPage, getBrowser, closeBrowser } from '../../lib/browser.js';
import { getMetadataPath, fileExists } from '../../lib/utils/fs.js';
import { sleep } from '../../lib/utils/time.js';
import { readFileSync, writeFile } from 'node:fs';
import { XMLParser } from "fast-xml-parser";
import { waitResponseSuffix, generateFileName, extractPlayerInfo } from './utils.js';
import { npoLogin } from './login.js';
import getWvKeys from './keys.js';
import { getConfig } from '../../config/env.js';
import { downloadFromID } from '../../services/download/downloader.js';

// Small predicate helpers for clarity
function needsProfileSelection(loginResult) {
  return Boolean(loginResult && loginResult.needsProfileSelection);
}

function isLoginFailure(loginResult) {
  return Boolean(loginResult && !loginResult.success);
}

function isStartRedirect(url) {
  return url === "https://npo.nl/start";
}

function hasDrm(pssh, x_custom_data) {
  return (pssh?.length || 0) !== 0 && (x_custom_data?.length || 0) !== 0;
}

function isPlusOnlyContent(pageContent) {
  return pageContent.includes("Alleen te zien met NPO Plus");
}

// Atomic helpers (no logic changes)
async function navigateAndHandleConsent(page, url) {
  console.log(`Navigating to episode: ${url}`);
  await page.goto(url);
  console.log(`Current URL after navigation: ${page.url()}`);
  await sleep(2000);
  try {
    const acceptButton = await page.$(
      "button[data-testid*=\"accept\"], button[data-testid*=\"continue\"], button:has-text(\"Accepteren\"), button:has-text(\"Doorgaan\")"
    );
    if (acceptButton) {
      console.log("Found accept/continue button, clicking...");
      await acceptButton.click();
      await sleep(1000);
    }
  } catch (_) {
    // ignore
  }
}

async function waitForStreamAndMpd(page) {
  const mpdPromise = waitResponseSuffix(page, "mpd");
  const streamResponsePromise = waitResponseSuffix(page, "stream-link");
  // reload the page to get the stream link
  await page.reload();
  const [mpdResponse, streamResponse] = await Promise.all([
    mpdPromise,
    streamResponsePromise,
  ]);
  const mpdText = await mpdResponse.text();
  const mpdData = parser.parse(mpdText);
  const streamData = await streamResponse.json();
  return { mpdData, streamData };
}

function extractPssh(mpdData) {
  let pssh = "";
  try {
    if ("ContentProtection" in mpdData["MPD"]["Period"]["AdaptationSet"][1]) {
      pssh = mpdData["MPD"]["Period"]["AdaptationSet"][1]["ContentProtection"][3].pssh || "";
    }
  } catch (_) {
    // leave as empty string if structure is unexpected
  }
  return pssh;
}

async function readPlusOnlyFallback(page) {
  const pageContent = await page.content();
  if (isPlusOnlyContent(pageContent)) {
    console.log("Error content needs NPO Plus subscription");
    return true;
  }
  return false;
}

function buildInformation(filename, pssh, x_custom_data, streamData, episodeDetails) {
  return {
    filename,
    pssh,
    x_custom_data,
    mpdUrl: streamData["stream"]["streamURL"],
    wideVineKeyResponse: null,
    // Enriched metadata (not required for download flow)
    ...(episodeDetails || {}),
  };
}

const options = {
  ignoreAttributes: false,
  removeNSPrefix: true,
};
const parser = new XMLParser(options);

const WidevineProxyUrl = "https://npo-drm-gateway.samgcloud.nepworldwide.nl/authentication";

/**
 * Fetch episode information; handles login and profile selection flow.
 * @param {string} url
 * @param {string|null} [profileName]
 * @returns {Promise<any>} Information object or a profile selection payload
 */
export async function getEpisode(url, profileName = null) {
  console.log("=== GET EPISODE STARTED ===");
  console.log("URL:", url);
  console.log("Profile name passed:", profileName || 'NONE');

  // Create a single page to be used throughout the flow
  const page = await createPage();
  console.log("Created browser page");

  try {
    console.log("Calling npoLogin with profile:", profileName || 'NONE');
    const loginResult = await npoLogin({ profile: profileName, page });
    console.log("Login result received:", JSON.stringify(loginResult, null, 2));

    // If profile selection is needed, return that information
    if (needsProfileSelection(loginResult)) {
      console.log("⚠️ Profile selection needed - returning to UI");
      await page.close();
      await closeBrowser();
      return {
        needsProfileSelection: true,
        profiles: loginResult.profiles,
        message: loginResult.message,
        url: url  // Ensure URL is included for the modal
      };
    }

    // If login failed for other reasons
    if (isLoginFailure(loginResult)) {
      console.error("✗ Login failed:", loginResult.error);
      await page.close();
      await closeBrowser();
      throw new Error(loginResult.error || 'Login failed');
    }

    console.log("✓ Login successful, fetching episode information...");
    const result = await getInformation(url, page);

    await page.close();
    console.log("Closing browser...");
    await closeBrowser();

    console.log("=== GET EPISODE COMPLETED ===");
    return result;
  } catch (error) {
    // Make sure to close page and browser on error
    await page.close();
    await closeBrowser();
    throw error;
  }
}

/**
 * Extracts episode information from an episode page.
 * @param {string} url
 * @param {import('puppeteer-core').Page|null} [page]
 * @returns {Promise<any|null>}
 */
export async function getInformation(url, page = null) {
  // Create page only if not provided
  const shouldClosePage = !page;
  if (!page) {
    page = await createPage();
  }

  await navigateAndHandleConsent(page, url);

  if (isStartRedirect(page.url())) {
    if (shouldClosePage) {
      await page.close();
    }
    console.log(`Error wrong episode ID ${url}`);
    return null;
  }

  console.log("Waiting for player info...");
  await page.waitForSelector(`[data-testid='player-info']`);
  const filename = await generateFileName(page);

  console.log(`${filename} - ${url}`);
  const keyPath = getMetadataPath(filename);

  if (await fileExists(keyPath)) {
    if (shouldClosePage) {
      await page.close();
    }
    console.log("information already gathered");
    return JSON.parse(readFileSync(keyPath, "utf8"));
  }
  console.log("gathering information");

  const { mpdData, streamData } = await waitForStreamAndMpd(page);

  let x_custom_data = "";
  try {
    x_custom_data = streamData["stream"]["drmToken"] || "";
  } catch (TypeError) {
    if (await readPlusOnlyFallback(page)) return null;
  }

  const pssh = extractPssh(mpdData);

  // Optional: read human-friendly episode details
  let episodeDetails = null;
  try {
    episodeDetails = await extractPlayerInfo(page);
  } catch (_) {
    // Non-fatal if player info is not available
  }

  const information = buildInformation(filename, pssh, x_custom_data, streamData, episodeDetails);

  // If we have DRM values, fetch the keys
  if (hasDrm(pssh, x_custom_data)) {
    const WVKey = await getWVKeys(pssh, x_custom_data);
    information.wideVineKeyResponse = WVKey.trim();
  } else {
    console.log("probably no drm");
  }

  writeKeyFile(keyPath, JSON.stringify(information));

  try {
    if (shouldClosePage) {
      await page.close();
    }
  } catch (error) {
    console.error(error);
  }
  return information;
}

/**
 * Build a list of episode URLs starting from a known first ID.
 * @param {string} firstId
 * @param {number} episodeCount
 * @returns {Promise<any>} Result of getEpisodes on the constructed URLs
 */
export function getEpisodesInOrder(firstId, episodeCount) {
  const index = firstId.lastIndexOf("_") + 1;

  const id = firstId.substring(index, firstId.length);
  let prefix = firstId.substring(0, index);
  // if id start with 0 add 0 to the prefix
  if (id.startsWith("0")) {
    prefix += "0";
  }
  const urls = [];
  for (let i = 0; i < episodeCount; i++) {
    const episodeId = prefix + (parseInt(id) + i);
    urls.push(`https://www.npostart.nl/${episodeId}`);
  }
  return getEpisodes(urls);
}

/**
 * Retrieve all episode URLs from a show page.
 * @param {string} url
 * @param {number} [seasonCount=-1] - Limit seasons; -1 means all.
 * @param {boolean} [reverse=false]
 * @returns {Promise<string[]>}
 */
export async function getAllEpisodesFromShow(url, seasonCount = -1, reverse = false) {
  const page = await createPage();

  await page.goto(url);

  const jsonData = await page.evaluate(() => {
    return JSON.parse(document.getElementById("__NEXT_DATA__").innerText) ||
      null;
  });

  if (jsonData === null) {
    console.log("Error retrieving show data");
    return null;
  }

  await page.close();

  const show =
    jsonData["props"]["pageProps"]["dehydratedState"]["queries"][0]["state"][
      "data"
    ]["slug"];
  const seasons =
    jsonData["props"]["pageProps"]["dehydratedState"]["queries"][1]["state"][
      "data"
    ];
  if (!reverse) { // the normal season order is already reversed
    seasons.reverse();
  }

  const seasonsLength = seasonCount !== -1 ? seasonCount : seasons.length;
  const urls = [];
  const perSeasonEpisodes = [];

  for (let i = 0; i < seasonsLength; i++) {
    const seasonEpisodes = getAllEpisodesFromSeason(
      `https://npo.nl/start/serie/${show}/${seasons[i]["slug"]}`,
      reverse,
    );
    perSeasonEpisodes.push(seasonEpisodes);
  }

  await Promise.all(perSeasonEpisodes)
    .then((result) => {
      for (const season of result) {
        urls.push(...season);
      }
    });

  return urls;
}

/**
 * Retrieve all episode URLs from a season page.
 * @param {string} url
 * @param {boolean} [reverse=false]
 * @returns {Promise<string[]>}
 */
export async function getAllEpisodesFromSeason(url, reverse = false) {
  const page = await createPage();

  const urls = [];

  await page.goto(url);

  await page.waitForSelector("div[data-testid='btn-login']");
  const jsonData = await page.evaluate(() => {
    return JSON.parse(document.getElementById("__NEXT_DATA__").innerText) ||
      null;
  });

  if (jsonData === null) {
    console.log("Error retrieving episode data");
    return null;
  }

  const show = jsonData["query"]["seriesSlug"];
  const season = jsonData["query"]["seriesParams"][0];
  const episodes =
    jsonData["props"]["pageProps"]["dehydratedState"]["queries"][2]["state"][
      "data"
    ];
  if (!reverse) { // the normal is already reversed, so if we want to start from the first episode we need to reverse it
    episodes.reverse();
  }

  for (let x = 0; x < episodes.length; x++) {
    let programKey = episodes[x]["programKey"];
    let slug = episodes[x]["slug"];
    let productId = episodes[x]["productId"];
    console.log(`ep. ${programKey} - ${slug} - ${productId}`);
    urls.push(`https://npo.nl/start/serie/${show}/${season}/${slug}/afspelen`);
  }

  await page.close();

  return urls;
}

/**
 * Given a set of episode URLs, log in (if needed), fetch info for each,
 * and trigger downloads in parallel.
 * @param {string[]} urls
 * @param {string|null} [profileName]
 * @returns {Promise<any>}
 */
export async function getEpisodes(urls, profileName = null) {
  const loginResult = await npoLogin({ profile: profileName });

  // If profile selection is needed, return that information
  if (loginResult && loginResult.needsProfileSelection) {
    return {
      needsProfileSelection: true,
      profiles: loginResult.profiles,
      message: loginResult.message
    };
  }

  // If login failed for other reasons
  if (loginResult && !loginResult.success) {
    throw new Error(loginResult.error || 'Login failed');
  }

  let informationList = [];

  let count = 0;
  for (const npo_url of urls) {
    informationList.push(getInformation(npo_url));
    if (count % 10 === 0) {
      await Promise.all(informationList);
    }
  }

  const list = await Promise.all(informationList);
  await closeBrowser();

  return downloadMulti(list, true);
}

async function downloadMulti(InformationList, runParallel = false) {
  if (runParallel === true) {
    let downloadPromises = [];
    for (const information of InformationList) {
      downloadPromises.push(downloadFromID(information));
    }
    return await Promise.all(downloadPromises);
  }

  let result = [];
  for (const information of InformationList) {
    result.push(await downloadFromID(information));
  }
  return result;
}

function writeKeyFile(path, data) {
  writeFile(path, data, "utf8", (err) => {
    if (err) {
      console.log(`Error writing file: ${err}`);
    } else {
      console.log(`${path} is written successfully!`);
    }
  });
}

async function getWVKeys(pssh, x_custom_data) {
  console.log("getting keys from website");
  const config = getConfig();

  const promise = new Promise((success, reject) => {
    if (config.GETWVKEYS_API_KEY === "") {
      reject("no auth key");
    }
    const js_getWVKeys = new getWvKeys(
      pssh,
      WidevineProxyUrl,
      config.GETWVKEYS_API_KEY,
      x_custom_data,
    );
    js_getWVKeys.getWvKeys().then((result) => {
      success(result);
    });
  });
  return await promise;
}

// Clearer alias exports (non-breaking)
export { getEpisode as fetchEpisode, getInformation as fetchEpisodeInfo, getEpisodes as listEpisodes };

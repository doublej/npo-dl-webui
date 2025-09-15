import { createPage, getBrowser, closeBrowser } from '../../lib/browser.js';
import { getMetadataPath, fileExists, sleep } from '../../lib/utils.js';
import { readFileSync, writeFile } from 'node:fs';
import { XMLParser } from "fast-xml-parser";
import { waitResponseSuffix, generateFileName } from './utils.js';
import { npoLogin } from './login.js';
import getWvKeys from './keys.js';
import { getConfig } from '../../config/env.js';
import { downloadFromID } from '../../services/download/downloader.js';

const options = {
  ignoreAttributes: false,
  removeNSPrefix: true,
};
const parser = new XMLParser(options);

const WidevineProxyUrl = "https://npo-drm-gateway.samgcloud.nepworldwide.nl/authentication";

export async function getEpisode(url) {
  const promiseLogin = npoLogin();
  await promiseLogin;
  const result = await getInformation(url);
  await closeBrowser();
  return result;
}

export async function getInformation(url) {
  const page = await createPage();

  console.log(`Navigating to episode: ${url}`);
  await page.goto(url);

  console.log(`Current URL after navigation: ${page.url()}`);

  // Wait a bit to see if there are any redirects or popups
  await sleep(2000);

  // Check if we need to handle any consent screens or popups
  try {
    // Try to find and click any "accept" or "continue" buttons if they exist
    const acceptButton = await page.$('button[data-testid*="accept"], button[data-testid*="continue"], button:has-text("Accepteren"), button:has-text("Doorgaan")');
    if (acceptButton) {
      console.log("Found accept/continue button, clicking...");
      await acceptButton.click();
      await sleep(1000);
    }
  } catch (e) {
    // No accept button found, continue
  }

  if (page.url() === "https://npo.nl/start") {
    await page.close();
    console.log(`Error wrong episode ID ${url}`);
    return null;
  }

  console.log("Waiting for video player...");
  await page.waitForSelector(`.bmpui-image`);
  const filename = "filename"; // await generateFileName(page);

  console.log(`${filename} - ${url}`);
  const keyPath = getMetadataPath(filename);

  if (await fileExists(keyPath)) {
    await page.close();
    console.log("information already gathered");
    return JSON.parse(readFileSync(keyPath, "utf8"));
  }
  console.log("gathering information");

  const mpdPromise = waitResponseSuffix(page, "mpd");
  const streamResponsePromise = waitResponseSuffix(page, "stream-link");

  // reload the page to get the stream link
  await page.reload();

  const streamResponse = await streamResponsePromise;
  const streamData = await streamResponse.json();

  let x_custom_data = "";
  try {
    x_custom_data = streamData["stream"]["drmToken"] || "";
  } catch (TypeError) {
    const pageContent = await page.content();
    if (pageContent.includes("Alleen te zien met NPO Plus")) {
      console.log("Error content needs NPO Plus subscription");
      return null;
    }
  }
  const mpdResponse = await mpdPromise;
  const mpdText = await mpdResponse.text();
  const mpdData = parser.parse(mpdText);

  let pssh = "";
  // check if the mpdData contains the necessary information
  if ("ContentProtection" in mpdData["MPD"]["Period"]["AdaptationSet"][1]) {
    pssh = mpdData["MPD"]["Period"]["AdaptationSet"][1]["ContentProtection"][3]
      .pssh || "";
  }

  const information = {
    "filename": filename,
    "pssh": pssh,
    "x_custom_data": x_custom_data,
    "mpdUrl": streamData["stream"]["streamURL"],
    "wideVineKeyResponse": null,
  };

  //if pssh and x_custom_data are not empty, get the keys
  if (pssh.length !== 0 && x_custom_data.length !== 0) {
    const WVKey = await getWVKeys(pssh, x_custom_data);
    information.wideVineKeyResponse = WVKey.trim();
  } else {
    console.log("probably no drm");
  }

  writeKeyFile(keyPath, JSON.stringify(information));

  try {
    await page.close();
  } catch (error) {
    console.error(error);
  }
  return information;
}

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

export async function getEpisodes(urls) {
  const promiseLogin = npoLogin();
  let informationList = [];
  await promiseLogin;

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
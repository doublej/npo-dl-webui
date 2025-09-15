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
  const rawSerie = page.$eval(
    ".font-bold.font-npo-scandia.leading-130.text-30 .line-clamp-2",
    (el) => el["innerText"],
  );
  const rawTitle = page.$eval(
    "h2.font-bold.font-npo-scandia.leading-130.text-22",
    (el) => el["innerText"],
  );
  const rawNumber = page.$eval(
    ".mb-24 .flex.items-center .leading-130.text-13 .line-clamp-1",
    (el) => el["innerText"],
  );
  const rawSeason = page.$eval(
    ".bg-card-3.font-bold.font-npo-scandia.inline-flex.items-center",
    (el) => el["innerText"],
  );

  let filename = "";

  filename += (await rawSerie) + " - ";
  // remove word "Seizoen" from rawSeason
  const seasonNumber = parseInt((await rawSeason).replace("Seizoen ", ""));
  const episodeNumber = parseInt(
    (await rawNumber).replace("Afl. ", "").split("•")[0],
  );
  // add season and episode number to filename formatted as SxxExx
  filename += "S" + seasonNumber.toString().padStart(2, "0") + "E" +
    episodeNumber.toString().padStart(2, "0") + " - ";
  filename += await rawTitle;

  // remove illegal characters from filename
  filename = filename.replace(/[/\\?%*:|"<>]/g, "#");

  return filename;
}
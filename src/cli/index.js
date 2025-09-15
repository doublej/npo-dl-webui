#!/usr/bin/env node

// import from npo provider
import { getEpisode } from "../providers/npo/index.js";
import { Command } from "commander";
import { downloadFromID } from "../services/download/downloader.js";
import { initializeEnv, validateConfig } from "../config/env.js";
import process from "node:process";

// Initialize environment
await initializeEnv();
validateConfig();

//enter the npo start show name and download all episodes from all seasons.
//second parameter = season count (0 = all)
//third parameter = reverse seasons (false = Start from latest, true = Start from first)

// getAllEpisodesFromShow("https://npo.nl/start/serie/keuringsdienst-van-waarde").then((urls) => {
//     getEpisodes(urls).then((result) => {
//         console.log(result);
//     });
// });

// enter the npo start show name and download all episodes from the chosen season.
/*
getAllEpisodesFromSeason("keuringsdienst-van-waarde", "seizoen-3").then((urls) => {
    getEpisodes(urls);
});
*/

/*
enter the video id here, you can find it in the url of the video, full url should look like this: https://www.npostart.nl/AT_300003151
if the video ids are sequential you can use the second parameter to download multiple episodes
*/

// getEpisodesInOrder("AT_300003161", 1).then((result) => {
//     console.log(result);
// });

// getEpisode("https://npo.nl/start/serie/blauw/seizoen-1/blauw_9/afspelen").then((result) => {
//     console.log(result);
// });

// simple cli
const program = new Command();

program
  .name("npo-start-downloader")
  .description("CLI to download npo start episodes")
  .version("1.0.0");

async function download(url) {
  const information = await getEpisode(url);
  const result = await downloadFromID(information);
  console.log(result);
}

download( "http://npo.nl/start/serie/de-week-van-merijn/seizoen-1/de-week-van-merijn/afspelen" )
//
// program.command("download")
//   .description("download a single episode")
//   .argument("<url>", "url of the episode")
//   .action(async (url) => {
//     await download(url);
//   });
//
// await program.parseAsync(process.argv);

import { sendOk, sendFail } from '../http/response.js';
import { DOWNLOAD_STATUS } from '../constants/status.js';
import { getEpisode, getAllEpisodesFromShow, getAllEpisodesFromSeason } from '../../providers/npo/index.js';
import { downloadFromID } from '../../services/download/downloader.js';
import { loadEnvFile } from '../utils/env-file.js';
import { broadcastProgress, broadcastStatus } from '../websocket.js';
import logger from '../../lib/logger.js';

// In-memory download registry (kept here to scope to downloads module)
export const activeDownloads = new Map();

export async function handleDownloadEpisode(req, res) {
  try {
    const { url, profile } = await parseBody(req);
    if (!url) return sendFail(res, 'URL is required');

    const envVars = loadEnvFile();
    const profileToUse = profile || envVars.NPO_PROFILE || null;

    const downloadId = Date.now().toString();
    activeDownloads.set(downloadId, { status: DOWNLOAD_STATUS.PROCESSING, url });

    (async () => {
      try {
        activeDownloads.set(downloadId, { status: DOWNLOAD_STATUS.FETCHING_INFO });
        broadcastStatus(downloadId, DOWNLOAD_STATUS.FETCHING_INFO, { url });

        const information = await getEpisode(url, profileToUse);

        if (information && information.needsProfileSelection) {
          activeDownloads.set(downloadId, {
            status: DOWNLOAD_STATUS.NEEDS_PROFILE,
            profiles: information.profiles,
            message: information.message,
            url,
          });
          return;
        }

        if (!information) {
          activeDownloads.set(downloadId, { status: DOWNLOAD_STATUS.ERROR, error: 'Failed to get episode information' });
          broadcastStatus(downloadId, DOWNLOAD_STATUS.ERROR, { error: 'Failed to get episode information' });
          return;
        }

        activeDownloads.set(downloadId, { status: DOWNLOAD_STATUS.DOWNLOADING, filename: information.filename });
        broadcastStatus(downloadId, DOWNLOAD_STATUS.DOWNLOADING, { filename: information.filename });

        const progressCallback = (progress) => {
          // UI updates via WebSocket - no console logging needed here
          broadcastProgress(downloadId, progress);
          const current = activeDownloads.get(downloadId);
          if (current) activeDownloads.set(downloadId, { ...current, progress });
        };

        const result = await downloadFromID(information, progressCallback);
        activeDownloads.set(downloadId, { status: DOWNLOAD_STATUS.COMPLETED, result, filename: information.filename });
        broadcastStatus(downloadId, DOWNLOAD_STATUS.COMPLETED, { filename: information.filename, result });
      } catch (error) {
        activeDownloads.set(downloadId, { status: DOWNLOAD_STATUS.ERROR, error: error.message });
        broadcastStatus(downloadId, DOWNLOAD_STATUS.ERROR, { error: error.message });
      }
    })();

    sendOk(res, { downloadId, message: 'Download started' });
  } catch (error) {
    sendFail(res, error.message, 500);
  }
}

export async function handleDownloadShow(req, res) {
  try {
    const { url, seasons, reverse } = await parseBody(req);
    if (!url) return sendFail(res, 'URL is required');

    const envVars = loadEnvFile();
    const profileToUse = envVars.NPO_PROFILE || null;
    const downloadId = Date.now().toString();
    activeDownloads.set(downloadId, { status: DOWNLOAD_STATUS.PROCESSING, url, type: 'show' });

    (async () => {
      try {
        const urls = await getAllEpisodesFromShow(url, seasons || -1, reverse || false);
        activeDownloads.set(downloadId, { status: DOWNLOAD_STATUS.DOWNLOADING, totalEpisodes: urls.length });
        for (let i = 0; i < urls.length; i++) {
          activeDownloads.set(downloadId, { status: DOWNLOAD_STATUS.DOWNLOADING, totalEpisodes: urls.length, currentEpisode: i + 1 });
          const information = await getEpisode(urls[i], profileToUse);
          if (information) await downloadFromID(information);
        }
        activeDownloads.set(downloadId, { status: DOWNLOAD_STATUS.COMPLETED, totalEpisodes: urls.length });
      } catch (error) {
        activeDownloads.set(downloadId, { status: DOWNLOAD_STATUS.ERROR, error: error.message });
      }
    })();

    sendOk(res, { downloadId, message: 'Show download started' });
  } catch (error) {
    sendFail(res, error.message, 500);
  }
}

export async function handleDownloadSeason(req, res) {
  try {
    const { url, reverse } = await parseBody(req);
    if (!url) return sendFail(res, 'URL is required');

    const envVars = loadEnvFile();
    const profileToUse = envVars.NPO_PROFILE || null;
    const downloadId = Date.now().toString();
    activeDownloads.set(downloadId, { status: DOWNLOAD_STATUS.PROCESSING, url, type: 'season' });

    (async () => {
      try {
        const urls = await getAllEpisodesFromSeason(url, reverse || false);
        activeDownloads.set(downloadId, { status: DOWNLOAD_STATUS.DOWNLOADING, totalEpisodes: urls.length });
        for (let i = 0; i < urls.length; i++) {
          activeDownloads.set(downloadId, { status: DOWNLOAD_STATUS.DOWNLOADING, totalEpisodes: urls.length, currentEpisode: i + 1 });
          const information = await getEpisode(urls[i], profileToUse);
          if (information) await downloadFromID(information);
        }
        activeDownloads.set(downloadId, { status: DOWNLOAD_STATUS.COMPLETED, totalEpisodes: urls.length });
      } catch (error) {
        activeDownloads.set(downloadId, { status: DOWNLOAD_STATUS.ERROR, error: error.message });
      }
    })();

    sendOk(res, { downloadId, message: 'Season download started' });
  } catch (error) {
    sendFail(res, error.message, 500);
  }
}

export async function handleBatchDownload(req, res) {
  try {
    const { urls } = await parseBody(req);
    if (!urls || !Array.isArray(urls)) return sendFail(res, 'URLs array is required');

    const envVars = loadEnvFile();
    const profileToUse = envVars.NPO_PROFILE || null;
    const downloadId = Date.now().toString();
    activeDownloads.set(downloadId, { status: DOWNLOAD_STATUS.PROCESSING, type: 'batch', totalUrls: urls.length });

    (async () => {
      try {
        for (let i = 0; i < urls.length; i++) {
          activeDownloads.set(downloadId, { status: DOWNLOAD_STATUS.DOWNLOADING, totalUrls: urls.length, currentUrl: i + 1, currentFile: urls[i] });
          const information = await getEpisode(urls[i], profileToUse);
          if (information) await downloadFromID(information);
        }
        activeDownloads.set(downloadId, { status: DOWNLOAD_STATUS.COMPLETED, totalUrls: urls.length });
      } catch (error) {
        activeDownloads.set(downloadId, { status: DOWNLOAD_STATUS.ERROR, error: error.message });
      }
    })();

    sendOk(res, { downloadId, message: 'Batch download started' });
  } catch (error) {
    sendFail(res, error.message, 500);
  }
}

export async function handleStatus(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const downloadId = url.searchParams.get('id');
  if (downloadId && activeDownloads.has(downloadId)) {
    return sendOk(res, activeDownloads.get(downloadId));
  } else if (downloadId) {
    return sendFail(res, 'Download not found', 404);
  }
  const allDownloads = {};
  for (const [id, status] of activeDownloads) allDownloads[id] = status;
  return sendOk(res, allDownloads);
}

// Local body parser to avoid import cycles
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk.toString());
    req.on('end', () => {
      try { resolve(JSON.parse(body || '{}')); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}


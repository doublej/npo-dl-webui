import { sendOk, sendFail } from '../http/response.js';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { readdir, stat } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const VIDEOS_DIR = join(__dirname, '../../../videos/final');

export async function handleGetShowsHierarchy(req, res) {
  try {
    const METADATA_DIR = join(__dirname, '../../../videos/metadata');
    const entries = await readdir(VIDEOS_DIR, { withFileTypes: true });
    const shows = new Map();

    for (const entry of entries) {
      if (entry.isFile() && (entry.name.endsWith('.mkv') || entry.name.endsWith('.mp4'))) {
        const fullPath = join(VIDEOS_DIR, entry.name);
        const info = await stat(fullPath);

        let metadata = {};
        const baseName = entry.name.replace(/\.(mkv|mp4)$/, '');
        const metadataPath = join(METADATA_DIR, `${baseName}.json`);
        if (existsSync(metadataPath)) {
          try {
            const metadataContent = readFileSync(metadataPath, 'utf-8');
            metadata = JSON.parse(metadataContent);
          } catch (_) {}
        }

        let showTitle = metadata.seriesTitle;
        let seasonNumber = metadata.seasonNumber || 1;
        let episodeNumber = metadata.episodeNumber || 1;
        let episodeTitle = metadata.title || baseName;

        if (!showTitle && metadata.title) {
          showTitle = metadata.title;
          const episodeMatch = baseName.match(/E\d+\s*-\s*(.+)/i);
          if (episodeMatch) {
            episodeTitle = episodeMatch[1] || metadata.title;
          }
        }

        const episodeMatch = baseName.match(/(?:S(\d+))?E(\d+)\s*-\s*(.+)/i);
        if (episodeMatch) {
          seasonNumber = episodeMatch[1] ? parseInt(episodeMatch[1]) : seasonNumber;
          episodeNumber = parseInt(episodeMatch[2]);
          episodeTitle = episodeMatch[3] || episodeTitle;
        }

        if (!shows.has(showTitle || 'Onbekend')) {
          shows.set(showTitle || 'Onbekend', { title: showTitle || 'Onbekend', seasons: new Map() });
        }
        const show = shows.get(showTitle || 'Onbekend');
        if (!show.seasons.has(seasonNumber)) {
          show.seasons.set(seasonNumber, { number: seasonNumber, episodes: [] });
        }
        const season = show.seasons.get(seasonNumber);
        season.episodes.push({
          filename: entry.name,
          episodeNumber,
          title: episodeTitle,
          description: metadata.description,
          airing: metadata.airing,
          duration: metadata.duration,
          size: info.size,
          mtime: info.mtimeMs,
          fullMetadata: metadata,
        });
      }
    }

    const result = Array.from(shows.values()).map(show => ({
      title: show.title,
      seasons: Array.from(show.seasons.values()).map(season => ({
        number: season.number,
        episodes: season.episodes.sort((a, b) => a.episodeNumber - b.episodeNumber),
      })).sort((a, b) => a.number - b.number),
    }));

    sendOk(res, { shows: result });
  } catch (error) {
    sendFail(res, error.message, 500);
  }
}

export async function handleListDownloads(req, res) {
  try {
    const METADATA_DIR = join(__dirname, '../../../videos/metadata');
    const entries = await readdir(VIDEOS_DIR, { withFileTypes: true });
    const files = [];

    for (const entry of entries) {
      if (entry.isFile() && (entry.name.endsWith('.mkv') || entry.name.endsWith('.mp4'))) {
        const fullPath = join(VIDEOS_DIR, entry.name);
        const info = await stat(fullPath);

        let metadata = {};
        const baseName = entry.name.replace(/\.(mkv|mp4)$/, '');
        const metadataPath = join(METADATA_DIR, `${baseName}.json`);
        if (existsSync(metadataPath)) {
          try {
            const metadataContent = readFileSync(metadataPath, 'utf-8');
            metadata = JSON.parse(metadataContent);
          } catch (_) {}
        }

        files.push({
          name: entry.name,
          size: info.size,
          mtime: info.mtimeMs,
          metadata: {
            title: metadata.title || baseName,
            episodeNumber: metadata.episodeNumber,
            seasonNumber: metadata.seasonNumber,
            seriesTitle: metadata.seriesTitle,
            description: metadata.description,
            airing: metadata.airing,
            duration: metadata.duration,
          },
        });
      }
    }
    files.sort((a, b) => b.mtime - a.mtime);
    sendOk(res, { files });
  } catch (error) {
    sendFail(res, error.message, 500);
  }
}

export async function handleStreamVideo(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const filename = decodeURIComponent(url.pathname.replace('/videos/', ''));
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      return sendFail(res, 'Invalid filename', 400);
    }
    const filePath = join(VIDEOS_DIR, filename);
    const ext = extname(filePath).toLowerCase();
    const contentType = ext === '.mp4' ? 'video/mp4' : (ext === '.mkv' ? 'video/x-matroska' : 'application/octet-stream');

    const fs = await import('node:fs');
    const stats = await fs.promises.stat(filePath);
    const range = req.headers.range;
    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : stats.size - 1;
      if (isNaN(start) || isNaN(end) || start > end || end >= stats.size) {
        res.writeHead(416, { 'Content-Range': `bytes */${stats.size}` });
        return res.end();
      }
      const chunkSize = end - start + 1;
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${stats.size}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': contentType,
      });
      fs.createReadStream(filePath, { start, end }).pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Length': stats.size,
        'Content-Type': contentType,
        'Accept-Ranges': 'bytes',
      });
      fs.createReadStream(filePath).pipe(res);
    }
  } catch (error) {
    sendFail(res, 'File not found', 404);
  }
}


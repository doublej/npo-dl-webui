import { join, resolve } from 'node:path';
import { promises as fsPromises } from 'node:fs';
import { unlink, mkdir } from 'node:fs/promises';
import { getConfig } from '../../config/env.js';

function getVideoPaths() {
  const config = getConfig();
  const basePath = resolve(config.VIDEO_PATH);
  return {
    base: basePath,
    final: join(basePath, 'final'),
    metadata: join(basePath, 'metadata'),
    temp: join(basePath, 'temp'),
  };
}

function getVideoPath() {
  return getVideoPaths().base + '/';
}

/**
 * Slugify a string to make it safe for filenames
 * @param {string} text - The text to slugify
 * @returns {string} - Slugified text
 */
function slugify(text) {
  return text
    .toString()
    .toLowerCase()
    .normalize('NFD') // Normalize to decomposed form for accent removal
    .replace(/[\u0300-\u036f]/g, '') // Remove accents
    .replace(/[^a-z0-9]+/g, '-') // Replace non-alphanumeric with hyphens
    .replace(/^-+|-+$/g, '') // Remove leading/trailing hyphens
    .replace(/--+/g, '-') // Replace multiple hyphens with single
    .substring(0, 200); // Limit length for filesystem
}

/**
 * Ensure all required video directories exist
 */
async function ensureVideoDirectories() {
  const paths = getVideoPaths();
  const dirs = [paths.base, paths.final, paths.metadata, paths.temp];

  for (const dir of dirs) {
    try {
      await mkdir(dir, { recursive: true });
      console.log(`✓ Directory ensured: ${dir}`);
    } catch (error) {
      console.error(`Failed to create directory ${dir}:`, error.message);
    }
  }
}

const fileExists = async (path) => !!(await fsPromises.stat(path).catch(() => false));

async function deleteFile(path) {
  if (await fileExists(path)) {
    try {
      await unlink(path.toString());
      console.log(`Successfully deleted ${path}`);
    } catch (error) {
      console.error('Error deleting file:', error.message);
    }
  } else {
    console.warn(`File ${path} does not exist`);
  }
}

function getMetadataPath(filename) {
  const paths = getVideoPaths();
  return join(paths.metadata, filename + '.json');
}

function getKeyPath(filename) {
  return getMetadataPath(filename);
}

function getFinalVideoPath(filename) {
  const paths = getVideoPaths();
  return join(paths.final, filename + '.mkv');
}

function getTempPath(filename) {
  const paths = getVideoPaths();
  return join(paths.temp, filename);
}

export {
  deleteFile,
  fileExists,
  getKeyPath,
  getMetadataPath,
  getVideoPath,
  getVideoPaths,
  getFinalVideoPath,
  getTempPath,
  slugify,
  ensureVideoDirectories,
};


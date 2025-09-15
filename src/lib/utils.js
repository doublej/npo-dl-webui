import { join, resolve } from "node:path";
import { promises } from "node:fs";
import { unlink } from "node:fs/promises";
import { spawn } from "node:child_process";
import { getConfig } from '../config/env.js';

// Parse boolean from string
function parseBoolean(str) {
  if (str === "true") return true;
  if (str === "false") return false;
  if (str === undefined) return str;
  // Handle cases where the string is neither 'true' nor 'false'
  throw new Error("Invalid boolean string");
}

// Get video paths based on new structure
function getVideoPaths() {
  const config = getConfig();
  const basePath = resolve(config.VIDEO_PATH);

  return {
    base: basePath,
    final: join(basePath, 'final'),
    metadata: join(basePath, 'metadata'),
    temp: join(basePath, 'temp')
  };
}

// Legacy function for backward compatibility
function getVideoPath() {
  return getVideoPaths().base + "/";
}

// Check if file exists
const fileExists = async (path) =>
  !!(await promises.stat(path).catch(() => false));

// Delete file
async function deleteFile(path) {
  if (await fileExists(path)) {
    try {
      await unlink(path.toString());
      console.log(`Successfully deleted ${path}`);
    } catch (error) {
      console.error("Error deleting file:", error.message);
    }
  } else {
    console.warn(`File ${path} does not exist`);
  }
}

// Parse progress from yt-dlp output
function parseYtDlpProgress(line) {
  // Match patterns like: [download]  45.2% of 280.5MiB at 2.5MiB/s ETA 01:30
  const progressMatch = line.match(/\[download\]\s+(\d+\.?\d*)%.*?at\s+([\d.]+\w+\/s).*?ETA\s+([\d:]+)/);
  if (progressMatch) {
    return {
      percentage: parseFloat(progressMatch[1]),
      speed: progressMatch[2],
      eta: progressMatch[3],
      stage: 'downloading'
    };
  }

  // Match download completion
  if (line.includes('[download] 100%')) {
    return {
      percentage: 100,
      speed: '0',
      eta: '00:00',
      stage: 'completed'
    };
  }

  return null;
}

// Parse progress from ffmpeg output
function parseFfmpegProgress(line) {
  // Match patterns like: time=00:01:30.45 speed=2.5x
  const progressMatch = line.match(/time=([\d:.]+).*?speed=([\d.]+)x/);
  if (progressMatch) {
    return {
      time: progressMatch[1],
      speed: progressMatch[2] + 'x',
      stage: 'merging'
    };
  }

  return null;
}

// Run command with spawn and progress callback
async function runCommand(command, args, result, progressCallback = null) {
  return new Promise((success, reject) => {
    const cmd = spawn(command, args);
    const stdout = cmd.stdout;
    const stderr = cmd.stderr;
    let stdoutData = null;
    let stderrData = null;

    stdout.on("end", () => {
      console.log(`Finished: ${command} ${args.join(' ')}`);
      success(result);
    });

    stdout.on("readable", () => {
      stdoutData = stdout.read();
      if (stdoutData != null) {
        const output = stdoutData.toString();
        console.log(output + `\t [${result}]`);

        // Parse progress if callback provided
        if (progressCallback) {
          if (command === 'yt-dlp') {
            const progress = parseYtDlpProgress(output);
            if (progress) {
              progressCallback(progress);
            }
          }
        }
      }
    });

    // Also listen to stderr for ffmpeg (it outputs progress there)
    stderr.on("readable", () => {
      stderrData = stderr.read();
      if (stderrData != null) {
        const output = stderrData.toString();

        // Parse ffmpeg progress
        if (progressCallback && command === 'ffmpeg') {
          const progress = parseFfmpegProgress(output);
          if (progress) {
            progressCallback(progress);
          }
        }
      }
    });

    cmd.stderr.on("error", (data) => {
      reject(data);
    });
  });
}

// Sleep utility
const sleep = (milliseconds) => {
  return new Promise((success) => setTimeout(success, milliseconds));
};

// Get metadata file path (replaces getKeyPath)
function getMetadataPath(filename) {
  const paths = getVideoPaths();
  return join(paths.metadata, filename + ".json");
}

// Legacy function for backward compatibility
function getKeyPath(filename) {
  return getMetadataPath(filename);
}

// Get final video file path
function getFinalVideoPath(filename) {
  const paths = getVideoPaths();
  return join(paths.final, filename + ".mkv");
}

// Get temp file path
function getTempPath(filename) {
  const paths = getVideoPaths();
  return join(paths.temp, filename);
}

// Sanitize filename
function sanitizeFilename(filename) {
  return filename.replace(/[/\\?%*:|"<>]/g, "#");
}

export {
  deleteFile,
  fileExists,
  getKeyPath,          // Legacy compatibility
  getMetadataPath,     // New name
  getVideoPath,        // Legacy compatibility
  getVideoPaths,       // New structured paths
  getFinalVideoPath,
  getTempPath,
  parseBoolean,
  runCommand,
  sanitizeFilename,
  sleep,
};
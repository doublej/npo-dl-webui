import { spawn } from 'node:child_process';
import logger from '../logger.js';

// Track last reported progress to throttle updates
let lastReportedProgress = -1;

function parseYtDlpProgress(line) {
  const progressMatch = line.match(/\[download\]\s+(\d+\.?\d*)%.*?at\s+([\d.]+\w+\/s).*?ETA\s+([\d:]+)/);
  if (progressMatch) {
    return {
      percentage: parseFloat(progressMatch[1]),
      speed: progressMatch[2],
      eta: progressMatch[3],
      stage: 'downloading',
    };
  }
  if (line.includes('[download] 100%')) {
    return { percentage: 100, speed: '0', eta: '00:00', stage: 'completed' };
  }

  // Parse file size info
  const sizeMatch = line.match(/\[download\].*?of\s+~?\s?([\d.]+\w+)/);
  if (sizeMatch) {
    return { totalSize: sizeMatch[1] };
  }

  return null;
}

function shouldLogProgress(currentProgress) {
  // Log at 0%, 5%, 10%, 15%, ..., 95%, 100%
  const progressThreshold = 5;
  const rounded = Math.floor(currentProgress / progressThreshold) * progressThreshold;

  if (rounded !== lastReportedProgress) {
    lastReportedProgress = rounded;
    return true;
  }
  return currentProgress === 100;
}

function parseFfmpegProgress(line) {
  const progressMatch = line.match(/time=([\d:.]+).*?speed=([\d.]+)x/);
  if (progressMatch) {
    return { time: progressMatch[1], speed: progressMatch[2] + 'x', stage: 'merging' };
  }
  return null;
}

async function runCommand(command, args, result, progressCallback = null) {
  return new Promise((success, reject) => {
    const cmd = spawn(command, args);
    const stdout = cmd.stdout;
    const stderr = cmd.stderr;

    // Reset progress tracking for new command
    if (command === 'yt-dlp') {
      lastReportedProgress = -1;
    }

    let currentFileInfo = { filename: result, totalSize: null };

    stdout.on('end', () => {
      logger.info('Command', `Completed: ${command} for ${result}`);
      success(result);
    });

    stdout.on('readable', () => {
      const chunk = stdout.read();
      if (chunk != null) {
        const output = chunk.toString();

        // Handle yt-dlp output
        if (command === 'yt-dlp') {
          const lines = output.split('\n').filter(line => line.trim());

          for (const line of lines) {
            // Check for important non-progress messages
            if (line.includes('[info]') || line.includes('[error]')) {
              logger.info('Download', line.trim());
            }

            // Parse and handle progress
            const progress = parseYtDlpProgress(line);
            if (progress) {
              // Update file info if we got size
              if (progress.totalSize) {
                currentFileInfo.totalSize = progress.totalSize;
              }

              // Log progress at intervals
              if (progress.percentage !== undefined && shouldLogProgress(progress.percentage)) {
                const sizeInfo = currentFileInfo.totalSize ? ` of ${currentFileInfo.totalSize}` : '';
                logger.info('Download', `${currentFileInfo.filename}: ${progress.percentage}%${sizeInfo} at ${progress.speed} - ETA ${progress.eta}`);
              }

              // Always pass to callback for UI updates
              if (progressCallback) progressCallback(progress);
            }
          }
        } else {
          // For non-yt-dlp commands, only log important lines
          const trimmed = output.trim();
          if (trimmed && !trimmed.includes('frame=') && !trimmed.includes('fps=')) {
            logger.debug(command, trimmed);
          }
        }
      }
    });

    stderr.on('readable', () => {
      const chunk = stderr.read();
      if (chunk != null) {
        const output = chunk.toString();

        if (command === 'ffmpeg') {
          const progress = parseFfmpegProgress(output);
          if (progress) {
            // Log ffmpeg progress less frequently
            logger.debug('Merge', `Processing at ${progress.speed}`);
            if (progressCallback) progressCallback(progress);
          }
        } else if (output.includes('error') || output.includes('Error')) {
          logger.error(command, output.trim());
        }
      }
    });

    cmd.stderr.on('error', (data) => reject(data));
  });
}

export { runCommand, parseYtDlpProgress, parseFfmpegProgress };


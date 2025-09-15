import { spawn } from 'node:child_process';

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
  return null;
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

    stdout.on('end', () => {
      console.log(`Finished: ${command} ${args.join(' ')}`);
      success(result);
    });

    stdout.on('readable', () => {
      const chunk = stdout.read();
      if (chunk != null) {
        const output = chunk.toString();
        console.log(output + `\t [${result}]`);
        if (progressCallback && command === 'yt-dlp') {
          const progress = parseYtDlpProgress(output);
          if (progress) progressCallback(progress);
        }
      }
    });

    stderr.on('readable', () => {
      const chunk = stderr.read();
      if (chunk != null && progressCallback && command === 'ffmpeg') {
        const output = chunk.toString();
        const progress = parseFfmpegProgress(output);
        if (progress) progressCallback(progress);
      }
    });

    cmd.stderr.on('error', (data) => reject(data));
  });
}

export { runCommand, parseYtDlpProgress, parseFfmpegProgress };


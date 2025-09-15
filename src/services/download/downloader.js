import {
    deleteFile,
    fileExists,
    getVideoPaths,
    getFinalVideoPath,
    getTempPath,
    runCommand,
    sleep,
} from "../../lib/utils.js";

/**
 * @typedef {Object} ProgressUpdate
 * @property {number} percentage - Overall progress percent (0-100).
 * @property {string} stage - Current stage identifier, e.g. 'downloading_video' | 'decrypting' | 'merging' | 'completed'.
 * @property {string} [message] - Human-readable message for UI.
 */

const videoPaths = getVideoPaths();

// Tiny predicate/utility helpers for readability (no logic changes)
function hasWidevineKey(key) {
    return key != null && key !== '';
}

function normalizeWidevineKey(key) {
    if (!hasWidevineKey(key)) return null;
    return key.includes(":") ? key.split(":")[1] : key;
}

function buildEncryptedBasename(filename) {
    return `encrypted#${filename}`;
}

/**
 * Download an episode by ID (legacy name).
 * Prefer using {@link downloadEpisodeById}.
 * @param {any} information - Episode information object with filename, mpdUrl, and optional wideVineKeyResponse.
 * @param {(p: ProgressUpdate) => void} [progressCallback]
 */
async function downloadFromID(information, progressCallback = null) {
    return downloadEpisodeById(information, progressCallback);
}

/**
 * Download an episode by ID (or information object).
 * Orchestrates: download MPD, optional decryption, merge, finalize.
 * @param {any} information - Episode information object with filename, mpdUrl, and optional wideVineKeyResponse.
 * @param {(p: ProgressUpdate) => void} [progressCallback]
 * @returns {Promise<string|null>} Final combined file path or null.
 */
async function downloadEpisodeById(information, progressCallback = null) {
    if (information === null) {
        return null;
    }

    let filename = information.filename.toString();

    console.log(filename);

    const combinedFileName = getFinalVideoPath(filename);
    if (await fileExists(combinedFileName)) {
        console.log("File already downloaded");
        if (progressCallback) {
            progressCallback({
                percentage: 100,
                stage: 'completed',
                message: 'File already exists'
            });
        }
        return combinedFileName;
    }

    console.log(information);

    // Report downloading phase
    if (progressCallback) {
        progressCallback({
            percentage: 0,
            stage: 'downloading_video',
            message: 'Starting video download...'
        });
    }

    // Download video and audio with progress
    filename = await downloadMpdResources(information.mpdUrl.toString(), filename, progressCallback);

    console.log(filename);

    let key = information.wideVineKeyResponse !== null ? information.wideVineKeyResponse.toString() : null;

    // Report decryption phase
    if (progressCallback) {
        progressCallback({
            percentage: 50,
            stage: hasWidevineKey(key) ? 'decrypting' : 'merging',
            message: hasWidevineKey(key) ? 'Decrypting video...' : 'Merging audio and video...'
        });
    }

    // Decrypt and merge files with progress
    return await decryptSegments(filename, key, progressCallback);
}

/**
 * Download video/audio tracks using yt-dlp.
 * @param {string} mpdUrl
 * @param {string} filename
 * @param {(p: ProgressUpdate) => void} [progressCallback]
 * @returns {Promise<string>} The base filename used for subsequent steps.
 */
async function downloadMpdResources(mpdUrl, filename, progressCallback = null) {
    const filenameFormat = "encrypted#" + filename + ".%(ext)s";
    const args = [
        "--allow-u",
        "--downloader",
        "aria2c",
        "-f",
        "bv,ba",
        "-P",
        videoPaths.temp,
        "-o",
        filenameFormat,
        mpdUrl,
    ];
    return runCommand("yt-dlp", args, filename, progressCallback);
}

/**
 * Optionally decrypt downloaded segments and forward to mux.
 * @param {string} filename
 * @param {string|null} key - Widevine key or null if clear content.
 * @param {(p: ProgressUpdate) => void} [progressCallback]
 * @returns {Promise<string>} Final combined file path.
 */
async function decryptSegments(filename, key, progressCallback = null) {
    //console.log(videoPath);
    let encryptedFilename = buildEncryptedBasename(filename);

    const mp4File = getTempPath(encryptedFilename + ".mp4");
    const m4aFile = getTempPath(encryptedFilename + ".m4a");

    key = normalizeWidevineKey(key);
    const resultFileName = await muxAudioAndVideo(
        filename,
        mp4File,
        m4aFile,
        key,
        progressCallback
    );

    await sleep(100);

    if (await fileExists(resultFileName)) {
        await deleteFile(mp4File);
        await deleteFile(m4aFile);
    }

    return resultFileName;
}

/**
 * Mux audio and video into a final file, with optional decryption via ffmpeg.
 * @param {string} filename - Base filename (without extension) used for final path resolution.
 * @param {string} video - Path to video track.
 * @param {string} audio - Path to audio track.
 * @param {string|null} key - Widevine key or null.
 * @param {(p: ProgressUpdate) => void} [progressCallback]
 * @returns {Promise<string>} Final combined file path.
 */
async function muxAudioAndVideo(filename, video, audio, key, progressCallback = null) {
    const combinedFileName = getFinalVideoPath(filename);

    // Report merging phase
    if (progressCallback) {
        progressCallback({
            percentage: 75,
            stage: 'merging',
            message: 'Merging audio and video tracks...'
        });
    }

    let args = ["-i", video, "-i", audio, "-c", "copy", combinedFileName];
    if (key != null) {
        args = [
            "-decryption_key",
            key,
            "-i",
            video,
            "-decryption_key",
            key,
            "-i",
            audio,
            "-c",
            "copy",
            combinedFileName,
        ];
    }

    const result = await runCommand("ffmpeg", args, combinedFileName, progressCallback);

    // Report completion
    if (progressCallback) {
        progressCallback({
            percentage: 100,
            stage: 'completed',
            message: 'Download completed successfully'
        });
    }

    return result;
}

// Backwards-compatible exports (legacy names) and new clearer names
export {
    downloadFromID,
    downloadEpisodeById,
    // Internal steps (exported for future reuse or testing)
    downloadMpdResources as downloadMpd,
    decryptSegments as decryptFiles,
    muxAudioAndVideo as combineVideoAndAudio,
};

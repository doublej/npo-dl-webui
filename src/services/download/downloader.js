import {
    deleteFile,
    fileExists,
    getVideoPaths,
    getFinalVideoPath,
    getTempPath,
    runCommand,
    sleep,
} from "../../lib/utils.js";

const videoPaths = getVideoPaths();

async function downloadFromID(information, progressCallback = null) {
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

    // Download video and audio with progress
    filename = await downloadMpd(information.mpdUrl.toString(), filename, progressCallback);

    console.log(filename);

    let key = null;

    if (information.wideVineKeyResponse !== null) {
        key = information.wideVineKeyResponse.toString();
    }

    // Decrypt and merge files with progress
    return await decryptFiles(filename, key, progressCallback);
}

async function downloadMpd(mpdUrl, filename, progressCallback = null) {
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

async function decryptFiles(filename, key, progressCallback = null) {
    //console.log(videoPath);
    let encryptedFilename = "encrypted#" + filename;

    const mp4File = getTempPath(encryptedFilename + ".mp4");
    const m4aFile = getTempPath(encryptedFilename + ".m4a");

    if (key != null) {
        key = key.split(":")[1];
    }
    const resultFileName = await combineVideoAndAudio(
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

async function combineVideoAndAudio(filename, video, audio, key, progressCallback = null) {
    const combinedFileName = getFinalVideoPath(filename);
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
    return runCommand("ffmpeg", args, combinedFileName, progressCallback);
}

export { downloadFromID };

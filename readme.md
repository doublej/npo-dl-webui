# Downloading from npo start

this project makes it possible to download from npo start

## the following files should be downloaded and added to your path

- [ffmpeg](https://ffmpeg.org/download.html) version 6.0 and 7.0 are tested
- [yt-dlp](https://github.com/yt-dlp/yt-dlp) version 2023.03.04 and 2024.03.10
  are tested

other versions might work but are not tested

## Setting up the environment

### Chrome Browser

Install the latest version of chrome browser for your operating system.

### for windows users

```powershell
winget install Gyan.FFmpeg
winget install yt-dlp
```

### for debian/ubuntu users

```bash
sudo apt install ffmpeg
sudo apt install yt-dlp
```

### for macos

```bash
brew install ffmpeg
brew install yt-dlp
```

### installing dependencies

make sure too run the following commands in the root of the project

```bash
npm install
```

## the following environment variables are required

- GETWVKEYS_API_KEY: this is a api key from the website
  [getwvkeys](https://getwvkeys.cc) this is used for decrypting the video stream
- NPO_EMAIL: this is the email address used to login to the npo website
- NPO_PASSW: this is the password used to login to the npo website

## running the project

```bash
node cli.js download <url>
```

## Logging Configuration

The application uses a centralized logging system with configurable verbosity levels. Set the `LOG_LEVEL` environment variable to control log output:

- `ERROR` - Only show errors
- `WARN` - Show errors and warnings
- `INFO` - Show errors, warnings, and informational messages (default)
- `DEBUG` - Show all messages including debug output

Example:
```bash
LOG_LEVEL=DEBUG node src/server/index.js
```

Download progress is automatically throttled to reduce console noise - progress updates are shown at 5% intervals.

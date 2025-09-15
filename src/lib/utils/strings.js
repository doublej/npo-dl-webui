function sanitizeFilename(filename) {
  return filename.replace(/[\/\\?%*:|"<>]/g, '#');
}

export { sanitizeFilename };


/**
 * Client-side logging utility with configurable levels
 */

const LOG_LEVELS = {
  ERROR: 0,
  WARN: 1,
  INFO: 2,
  DEBUG: 3,
};

class ClientLogger {
  constructor() {
    // Get log level from localStorage or default to INFO
    const storedLevel = localStorage.getItem('logLevel');
    this.level = storedLevel && LOG_LEVELS[storedLevel.toUpperCase()] !== undefined
      ? LOG_LEVELS[storedLevel.toUpperCase()]
      : LOG_LEVELS.INFO;
  }

  _formatTimestamp() {
    const now = new Date();
    return now.toLocaleTimeString();
  }

  _log(level, prefix, ...args) {
    const levelValue = LOG_LEVELS[level];
    if (levelValue > this.level) return;

    const timestamp = this._formatTimestamp();
    const prefixStr = prefix ? `[${prefix}]` : '';
    const levelStr = `[${level}]`;

    const logArgs = [`%c${timestamp} ${levelStr} ${prefixStr}`, this._getStyle(level), ...args];

    if (levelValue === LOG_LEVELS.ERROR) {
      console.error(...logArgs);
    } else if (levelValue === LOG_LEVELS.WARN) {
      console.warn(...logArgs);
    } else {
      console.log(...logArgs);
    }
  }

  _getStyle(level) {
    const styles = {
      ERROR: 'color: #ff4444; font-weight: bold',
      WARN: 'color: #ffaa00; font-weight: bold',
      INFO: 'color: #0099ff',
      DEBUG: 'color: #999999',
    };
    return styles[level] || '';
  }

  error(prefix, ...args) {
    if (typeof prefix !== 'string' || !args.length) {
      this._log('ERROR', '', prefix, ...args);
    } else {
      this._log('ERROR', prefix, ...args);
    }
  }

  warn(prefix, ...args) {
    if (typeof prefix !== 'string' || !args.length) {
      this._log('WARN', '', prefix, ...args);
    } else {
      this._log('WARN', prefix, ...args);
    }
  }

  info(prefix, ...args) {
    if (typeof prefix !== 'string' || !args.length) {
      this._log('INFO', '', prefix, ...args);
    } else {
      this._log('INFO', prefix, ...args);
    }
  }

  debug(prefix, ...args) {
    if (typeof prefix !== 'string' || !args.length) {
      this._log('DEBUG', '', prefix, ...args);
    } else {
      this._log('DEBUG', prefix, ...args);
    }
  }

  setLevel(level) {
    const upperLevel = level.toUpperCase();
    if (LOG_LEVELS[upperLevel] !== undefined) {
      this.level = LOG_LEVELS[upperLevel];
      localStorage.setItem('logLevel', upperLevel);
    }
  }
}

// Export singleton instance
window.logger = new ClientLogger();
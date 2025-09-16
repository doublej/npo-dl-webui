/**
 * Centralized logging module with configurable levels and consistent formatting
 *
 * Set LOG_LEVEL environment variable to control logging verbosity:
 * - ERROR: Only errors
 * - WARN: Errors and warnings
 * - INFO: Errors, warnings, and informational messages (default)
 * - DEBUG: All messages including debug output
 *
 * Example: LOG_LEVEL=DEBUG node src/server/index.js
 */

const LOG_LEVELS = {
  ERROR: 0,
  WARN: 1,
  INFO: 2,
  DEBUG: 3,
};

const LOG_COLORS = {
  ERROR: '\x1b[31m', // Red
  WARN: '\x1b[33m',  // Yellow
  INFO: '\x1b[36m',  // Cyan
  DEBUG: '\x1b[90m', // Gray
  RESET: '\x1b[0m',
};

class Logger {
  constructor() {
    // Default to INFO level, can be overridden by LOG_LEVEL env var
    const envLevel = process.env.LOG_LEVEL?.toUpperCase();
    this.level = envLevel && LOG_LEVELS[envLevel] !== undefined
      ? LOG_LEVELS[envLevel]
      : LOG_LEVELS.INFO;

    this.useColors = process.env.NO_COLOR !== '1';
    this.indentLevel = 0;
  }

  _formatTimestamp() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  }

  _log(level, prefix, ...args) {
    const levelValue = LOG_LEVELS[level];
    if (levelValue > this.level) return;

    const timestamp = this._formatTimestamp();
    const levelStr = this.useColors
      ? `${LOG_COLORS[level]}[${level}]${LOG_COLORS.RESET}`
      : `[${level}]`;

    // Handle prefix formatting
    const prefixStr = prefix ? `[${prefix}]` : '';

    // Apply indentation
    const indent = '  '.repeat(this.indentLevel);

    // Format the message
    const message = args.map(arg => {
      if (typeof arg === 'object') {
        return JSON.stringify(arg, null, 2);
      }
      return String(arg);
    }).join(' ');

    // Output based on level
    const output = `[${timestamp}] ${levelStr} ${prefixStr} ${indent}${message}`.trim();

    if (levelValue === LOG_LEVELS.ERROR) {
      console.error(output);
    } else {
      console.log(output);
    }
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
    }
  }

  // Group logging for better organization
  group(title) {
    this.info('', '');
    this.info('', `${'='.repeat(20)} ${title} ${'='.repeat(20)}`);
    this.indentLevel++;
  }

  groupEnd(message = '') {
    this.indentLevel = Math.max(0, this.indentLevel - 1);
    if (message) {
      this.info('', `✓ ${message}`);
    }
    this.info('', '');
  }

  // Log a step in a process
  step(number, message) {
    this.info('Step', `${number}. ${message}`);
  }

  // Log success with checkmark
  success(prefix, message) {
    this.info(prefix, `✓ ${message}`);
  }

  // Log a simple divider
  divider() {
    console.log('');
  }
}

// Export singleton instance
const logger = new Logger();
export default logger;
export { LOG_LEVELS };
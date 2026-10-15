/**
 * logger.js — Pino-based logger with file and console transport.
 */

import pino from 'pino';
import path from 'path';
import fs from 'fs';
import config from '../config.js';

// Ensure logs directory exists
fs.mkdirSync(config.logsDir, { recursive: true });

const logFile = path.join(config.logsDir, 'bot.log');

const logger = pino(
  {
    level: config.logLevel,
    // Redact sensitive fields so they never appear in logs
    redact: {
      paths: ['creds', 'keys', 'qr', 'token', 'password', 'secret'],
      censor: '[REDACTED]',
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level(label) { return { level: label.toUpperCase() }; },
    },
  },
  pino.multistream([
    // Structured JSON to file
    { stream: pino.destination({ dest: logFile, sync: false }) },
    // Pretty to console when not in production
    process.env.NODE_ENV !== 'production'
      ? {
          stream: (await import('pino-pretty')).default({
            colorize: true,
            translateTime: 'SYS:HH:MM:ss',
            ignore: 'pid,hostname',
          }),
        }
      : { stream: process.stdout },
  ])
);

export default logger;

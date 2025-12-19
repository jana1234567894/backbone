/**
 * Logging Utility
 * Provides structured logging with different levels
 */

import config from '../config/env.js';

const LOG_LEVELS = {
    error: 0,
    warn: 1,
    info: 2,
    debug: 3,
};

const currentLevel = LOG_LEVELS[config.logLevel] || LOG_LEVELS.info;

const formatMessage = (level, message, meta = {}) => {
    const timestamp = new Date().toISOString();
    const metaStr = Object.keys(meta).length > 0 ? JSON.stringify(meta) : '';
    return `[${timestamp}] [${level.toUpperCase()}] ${message} ${metaStr}`;
};

export const logger = {
    error: (message, meta = {}) => {
        if (currentLevel >= LOG_LEVELS.error) {
            console.error(formatMessage('error', message, meta));
        }
    },

    warn: (message, meta = {}) => {
        if (currentLevel >= LOG_LEVELS.warn) {
            console.warn(formatMessage('warn', message, meta));
        }
    },

    info: (message, meta = {}) => {
        if (currentLevel >= LOG_LEVELS.info) {
            console.log(formatMessage('info', message, meta));
        }
    },

    debug: (message, meta = {}) => {
        if (currentLevel >= LOG_LEVELS.debug) {
            console.debug(formatMessage('debug', message, meta));
        }
    },
};

export default logger;

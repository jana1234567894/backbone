/**
 * Translation Service
 * Handles text translation using LibreTranslate, Google Translate, or DeepL
 */

import axios from 'axios';
import NodeCache from 'node-cache';
import config from '../config/env.js';
import logger from '../utils/logger.js';
import { saveTranslation, getTranslation } from '../db/transcripts.js';

// In-memory cache for translations (TTL: 1 hour)
const translationCache = new NodeCache({ stdTTL: 3600, checkperiod: 600 });

/**
 * Translate text using LibreTranslate
 */
async function translateWithLibreTranslate(text, sourceLang, targetLang) {
    try {
        const response = await axios.post(`${config.translation.libretranslateUrl}/translate`, {
            q: text,
            source: sourceLang === 'auto' ? 'auto' : sourceLang,
            target: targetLang,
            format: 'text'
        }, {
            headers: { 'Content-Type': 'application/json' },
            timeout: 5000,
        });

        return response.data.translatedText;
    } catch (error) {
        logger.error('LibreTranslate error', { error: error.message, text: text.substring(0, 50) });
        throw new Error('LibreTranslate translation failed');
    }
}

/**
 * Translate text using Google Translate (if API key provided)
 */
async function translateWithGoogle(text, sourceLang, targetLang) {
    if (!config.translation.googleApiKey) {
        throw new Error('Google Translate API key not configured');
    }

    try {
        const url = `https://translation.googleapis.com/language/translate/v2`;
        const response = await axios.post(url, {
            q: text,
            source: sourceLang === 'auto' ? undefined : sourceLang,
            target: targetLang,
            key: config.translation.googleApiKey,
        }, {
            timeout: 5000,
        });

        return response.data.data.translations[0].translatedText;
    } catch (error) {
        logger.error('Google Translate error', { error: error.message });
        throw new Error('Google Translate failed');
    }
}

/**
 * Main translation function with caching and fallback
 */
export async function translateText(text, sourceLang, targetLang, transcriptId = null) {
    // If source and target are the same, no translation needed
    if (sourceLang === targetLang) {
        return text;
    }

    // Generate cache key
    const cacheKey = `${text}_${sourceLang}_${targetLang}`;

    // Check in-memory cache first
    if (config.features.cacheTranslations) {
        const cached = translationCache.get(cacheKey);
        if (cached) {
            logger.debug('Translation cache hit (memory)', { sourceLang, targetLang });
            return cached;
        }

        // Check database cache if transcriptId provided
        if (transcriptId) {
            const dbCached = await getTranslation(transcriptId, targetLang);
            if (dbCached) {
                logger.debug('Translation cache hit (database)', { sourceLang, targetLang });
                translationCache.set(cacheKey, dbCached); // Store in memory too
                return dbCached;
            }
        }
    }

    // Perform translation
    let translatedText;
    const service = config.translation.service;

    try {
        if (service === 'google') {
            translatedText = await translateWithGoogle(text, sourceLang, targetLang);
        } else {
            // Default to LibreTranslate
            translatedText = await translateWithLibreTranslate(text, sourceLang, targetLang);
        }

        // Cache the translation
        if (config.features.cacheTranslations) {
            translationCache.set(cacheKey, translatedText);

            // Save to database if transcriptId provided
            if (transcriptId) {
                await saveTranslation(transcriptId, targetLang, translatedText, service);
            }
        }

        logger.debug('Translation successful', { service, sourceLang, targetLang, textLength: text.length });
        return translatedText;

    } catch (error) {
        logger.error('Translation failed', { service, error: error.message });

        // Fallback: Return original text if translation fails
        return text;
    }
}

/**
 * Translate text to multiple target languages at once
 */
export async function translateToMultipleLanguages(text, sourceLang, targetLanguages, transcriptId = null) {
    const translations = {};

    // Translate to each target language
    const promises = targetLanguages.map(async (targetLang) => {
        const translated = await translateText(text, sourceLang, targetLang, transcriptId);
        translations[targetLang] = translated;
    });

    await Promise.all(promises);

    return translations;
}

/**
 * Clear translation cache
 */
export function clearTranslationCache() {
    translationCache.flushAll();
    logger.info('Translation cache cleared');
}

/**
 * Get cache statistics
 */
export function getCacheStats() {
    return {
        keys: translationCache.keys().length,
        hits: translationCache.getStats().hits,
        misses: translationCache.getStats().misses,
    };
}

export default {
    translateText,
    translateToMultipleLanguages,
    clearTranslationCache,
    getCacheStats,
};

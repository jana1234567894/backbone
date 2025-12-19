/**
 * Environment Configuration Module
 * Loads and validates all required environment variables
 */

import dotenv from 'dotenv';
dotenv.config();

// Validate required environment variables
const requiredVars = [
    'LIVEKIT_API_KEY',
    'LIVEKIT_API_SECRET',
    'LIVEKIT_URL',
    'SUPABASE_URL',
    'SUPABASE_SERVICE_KEY'
];

const missingVars = requiredVars.filter(v => !process.env[v]);
if (missingVars.length > 0) {
    console.error(`❌ Missing required environment variables: ${missingVars.join(', ')}`);
}

// Optional transcription variables
const transcriptionEnabled = process.env.ENABLE_TRANSCRIPTION === 'true';
const translationEnabled = process.env.ENABLE_TRANSLATION === 'true';

if (transcriptionEnabled && !process.env.DEEPGRAM_API_KEY) {
    console.warn('⚠️ Transcription enabled but DEEPGRAM_API_KEY is missing');
}

if (translationEnabled && !process.env.TRANSLATION_SERVICE) {
    console.warn('⚠️ Translation enabled but TRANSLATION_SERVICE is missing');
}

export const config = {
    // Server
    port: parseInt(process.env.PORT || '8080'),
    nodeEnv: process.env.NODE_ENV || 'development',

    // LiveKit
    livekit: {
        url: process.env.LIVEKIT_URL,
        apiKey: process.env.LIVEKIT_API_KEY,
        apiSecret: process.env.LIVEKIT_API_SECRET,
    },

    // Supabase
    supabase: {
        url: process.env.SUPABASE_URL,
        serviceKey: process.env.SUPABASE_SERVICE_KEY,
    },

    // Deepgram
    deepgram: {
        apiKey: process.env.DEEPGRAM_API_KEY,
        model: process.env.DEEPGRAM_MODEL || 'nova-2',
        language: process.env.DEEPGRAM_LANGUAGE || 'en',
        diarize: process.env.DEEPGRAM_DIARIZE === 'true',
    },

    // Translation
    translation: {
        service: process.env.TRANSLATION_SERVICE || 'libretranslate',
        libretranslateUrl: process.env.LIBRETRANSLATE_URL || 'https://libretranslate.de',
        googleApiKey: process.env.GOOGLE_TRANSLATE_API_KEY,
        deeplApiKey: process.env.DEEPL_API_KEY,
    },

    // Feature Flags
    features: {
        transcription: transcriptionEnabled,
        translation: translationEnabled,
        cacheTranslations: process.env.CACHE_TRANSLATIONS !== 'false',
    },

    // Logging
    logLevel: process.env.LOG_LEVEL || 'info',
};

// Log configuration on startup
console.log('✅ Configuration loaded:');
console.log(`   - Environment: ${config.nodeEnv}`);
console.log(`   - Port: ${config.port}`);
console.log(`   - Transcription: ${config.features.transcription ? '✅ Enabled' : '❌ Disabled'}`);
console.log(`   - Translation: ${config.features.translation ? '✅ Enabled' : '❌ Disabled'}`);
console.log(`   - Translation Service: ${config.translation.service}`);

export default config;

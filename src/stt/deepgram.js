/**
 * Deepgram Speech-to-Text Service
 * Handles real-time audio transcription using Deepgram streaming API
 */

import { createClient, LiveTranscriptionEvents } from '@deepgram/sdk';
import config from '../config/env.js';
import logger from '../utils/logger.js';
import { saveTranscript } from '../db/transcripts.js';

let deepgramClient = null;

/**
 * Initialize Deepgram client
 */
export function initializeDeepgram() {
    if (!config.deepgram.apiKey) {
        logger.warn('Deepgram API key not configured, transcription disabled');
        return false;
    }

    try {
        deepgramClient = createClient(config.deepgram.apiKey);
        logger.info('✅ Deepgram client initialized');
        return true;
    } catch (error) {
        logger.error('Failed to initialize Deepgram', { error: error.message });
        return false;
    }
}

/**
 * Create a live transcription session
 * @param {Object} options - Configuration options
 * @param {Function} onTranscript - Callback for interim transcripts
 * @param {Function} onFinalTranscript - Callback for final transcripts
 * @returns {Object} - Connection object with send() and close() methods
 */
export async function createTranscriptionSession(options = {}, onTranscript, onFinalTranscript) {
    if (!deepgramClient) {
        const initialized = initializeDeepgram();
        if (!initialized) {
            throw new Error('Deepgram not initialized');
        }
    }

    try {
        // Create live transcription connection
        const connection = deepgramClient.listen.live({
            model: config.deepgram.model,
            language: options.language || config.deepgram.language,
            smart_format: true,
            punctuate: true,
            interim_results: true,
            utterance_end_ms: 1000,
            vad_events: true,
            encoding: 'linear16',
            sample_rate: 16000,
            channels: 1,
        });

        // Handle connection open
        connection.on(LiveTranscriptionEvents.Open, () => {
            logger.info('Deepgram connection opened', { meetingId: options.meetingId });
        });

        // Handle transcript results
        connection.on(LiveTranscriptionEvents.Transcript, (data) => {
            const transcript = data.channel?.alternatives?.[0];
            if (!transcript || !transcript.transcript) return;

            const isFinal = data.is_final || false;
            const confidence = transcript.confidence || 0;

            logger.debug('Transcript received', {
                meetingId: options.meetingId,
                isFinal,
                confidence,
                text: transcript.transcript.substring(0, 50)
            });

            if (isFinal && onFinalTranscript) {
                // Final transcript
                onFinalTranscript({
                    text: transcript.transcript,
                    confidence,
                    language: options.language || 'en',
                    isFinal: true,
                });
            } else if (!isFinal && onTranscript) {
                // Interim transcript
                onTranscript({
                    text: transcript.transcript,
                    confidence,
                    language: options.language || 'en',
                    isFinal: false,
                });
            }
        });

        // Handle errors
        connection.on(LiveTranscriptionEvents.Error, (error) => {
            logger.error('Deepgram error', {
                meetingId: options.meetingId,
                error: error.message
            });
        });

        // Handle connection close
        connection.on(LiveTranscriptionEvents.Close, () => {
            logger.info('Deepgram connection closed', { meetingId: options.meetingId });
        });

        // Return connection interface
        return {
            send: (audioData) => {
                try {
                    connection.send(audioData);
                } catch (error) {
                    logger.error('Error sending audio to Deepgram', { error: error.message });
                }
            },
            close: () => {
                try {
                    connection.finish();
                } catch (error) {
                    logger.error('Error closing Deepgram connection', { error: error.message });
                }
            },
        };

    } catch (error) {
        logger.error('Failed to create Deepgram session', { error: error.message });
        throw error;
    }
}

/**
 * Process and save final transcript
 */
export async function processFinalTranscript(meetingId, speakerId, speakerName, transcript) {
    try {
        // Save to database
        const saved = await saveTranscript(
            meetingId,
            speakerId,
            speakerName,
            transcript.text,
            transcript.language,
            transcript.confidence
        );

        if (saved) {
            logger.info('Transcript saved to database', {
                meetingId,
                speakerId,
                transcriptId: saved.id
            });
            return saved;
        }

        return null;
    } catch (error) {
        logger.error('Error processing final transcript', {
            meetingId,
            speakerId,
            error: error.message
        });
        return null;
    }
}

/**
 * Health check for Deepgram service
 */
export async function checkDeepgramHealth() {
    if (!deepgramClient) {
        return { healthy: false, message: 'Deepgram client not initialized' };
    }

    try {
        // Simple check - if client exists and has API key, assume healthy
        return {
            healthy: true,
            message: 'Deepgram service operational',
            model: config.deepgram.model
        };
    } catch (error) {
        return {
            healthy: false,
            message: error.message
        };
    }
}

export default {
    initializeDeepgram,
    createTranscriptionSession,
    processFinalTranscript,
    checkDeepgramHealth,
};

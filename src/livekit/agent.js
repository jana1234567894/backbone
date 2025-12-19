/**
 * LiveKit Agent
 * Connects to meeting rooms, subscribes to audio, and manages transcription
 */

import { Room, RoomEvent, Track } from 'livekit-server-sdk';
import config from '../config/env.js';
import logger from '../utils/logger.js';
import { createTranscriptionSession, processFinalTranscript } from '../stt/deepgram.js';
import { translateText } from '../translation/translator.js';
import { getMeetingLanguages } from '../db/userSettings.js';
import { sendTranslatedCaptions, broadcastCaption, sendSystemMessage } from './dataChannel.js';

// Active transcription sessions
const activeSessions = new Map();

/**
 * Start transcription for a meeting
 */
export async function startTranscription(meetingId, livekitRoomName, token) {
    if (!config.features.transcription) {
        logger.warn('Transcription feature disabled');
        return { success: false, message: 'Transcription disabled' };
    }

    if (activeSessions.has(meetingId)) {
        logger.warn('Transcription already active for meeting', { meetingId });
        return { success: false, message: 'Already transcribing' };
    }

    try {
        // Create room connection
        const room = new Room();

        // Connect to room
        await room.connect(config.livekit.url, token);

        logger.info('✅ Agent connected to room', { meetingId, roomName: livekitRoomName });

        // Send system message
        await sendSystemMessage(room, 'Live transcription started');

        // Store session
        const session = {
            room,
            meetingId,
            transcriptionSessions: new Map(),
            participantLanguages: new Map(),
        };

        activeSessions.set(meetingId, session);

        // Subscribe to existing participants
        room.participants.forEach(participant => {
            subscribeToParticipant(session, participant);
        });

        // Handle new participants
        room.on(RoomEvent.ParticipantConnected, (participant) => {
            logger.info('Participant joined', { meetingId, participantId: participant.identity });
            subscribeToParticipant(session, participant);
        });

        // Handle participants leaving
        room.on(RoomEvent.ParticipantDisconnected, (participant) => {
            logger.info('Participant left', { meetingId, participantId: participant.identity });
            unsubscribeFromParticipant(session, participant);
        });

        // Handle track subscribed
        room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
            if (track.kind === Track.Kind.Audio) {
                logger.info('Audio track subscribed', { meetingId, participantId: participant.identity });
                handleAudioTrack(session, track, participant);
            }
        });

        // Handle track unsubscribed
        room.on(RoomEvent.TrackUnsubscribed, (track, publication, participant) => {
            if (track.kind === Track.Kind.Audio) {
                logger.info('Audio track unsubscribed', { meetingId, participantId: participant.identity });
                stopTranscriptionForParticipant(session, participant.identity);
            }
        });

        // Handle disconnection
        room.on(RoomEvent.Disconnected, () => {
            logger.info('Agent disconnected from room', { meetingId });
            cleanupSession(meetingId);
        });

        return { success: true, message: 'Transcription started' };

    } catch (error) {
        logger.error('Error starting transcription', { meetingId, error: error.message });
        return { success: false, message: error.message };
    }
}

/**
 * Stop transcription for a meeting
 */
export async function stopTranscription(meetingId) {
    const session = activeSessions.get(meetingId);

    if (!session) {
        return { success: false, message: 'No active session' };
    }

    try {
        // Send system message
        await sendSystemMessage(session.room, 'Live transcription stopped');

        // Cleanup
        await cleanupSession(meetingId);

        return { success: true, message: 'Transcription stopped' };

    } catch (error) {
        logger.error('Error stopping transcription', { meetingId, error: error.message });
        return { success: false, message: error.message };
    }
}

/**
 * Subscribe to a participant's audio
 */
function subscribeToParticipant(session, participant) {
    participant.tracks.forEach((publication) => {
        if (publication.kind === Track.Kind.Audio && publication.track) {
            handleAudioTrack(session, publication.track, participant);
        }
    });
}

/**
 * Unsubscribe from a participant
 */
function unsubscribeFromParticipant(session, participant) {
    stopTranscriptionForParticipant(session, participant.identity);
}

/**
 * Handle audio track from participant
 */
async function handleAudioTrack(session, audioTrack, participant) {
    const participantId = participant.identity;

    try {
        // Create Deepgram transcription session
        const deepgramSession = await createTranscriptionSession(
            { meetingId: session.meetingId, language: 'en' },
            // Interim transcript callback
            async (transcript) => {
                await handleInterimTranscript(session, participantId, participant.name, transcript);
            },
            // Final transcript callback
            async (transcript) => {
                await handleFinalTranscript(session, participantId, participant.name, transcript);
            }
        );

        // Store transcription session
        session.transcriptionSessions.set(participantId, deepgramSession);

        // Process audio chunks
        audioTrack.on('data', (chunk) => {
            // Send audio to Deepgram
            deepgramSession.send(chunk);
        });

        logger.info('Audio processing started', { meetingId: session.meetingId, participantId });

    } catch (error) {
        logger.error('Error handling audio track', { participantId, error: error.message });
    }
}

/**
 * Handle interim transcript (don't translate, just broadcast)
 */
async function handleInterimTranscript(session, speakerId, speakerName, transcript) {
    try {
        // Broadcast interim caption (no translation for speed)
        await broadcastCaption(session.room, {
            meetingId: session.meetingId,
            speakerId,
            speakerName,
            originalText: transcript.text,
            originalLanguage: transcript.language,
            isFinal: false,
            confidence: transcript.confidence,
        });
    } catch (error) {
        logger.error('Error handling interim transcript', { error: error.message });
    }
}

/**
 * Handle final transcript (translate and send)
 */
async function handleFinalTranscript(session, speakerId, speakerName, transcript) {
    try {
        // Save transcript to database
        const saved = await processFinalTranscript(
            session.meetingId,
            speakerId,
            speakerName,
            transcript
        );

        if (!saved) {
            logger.warn('Failed to save transcript');
        }

        // Get participant languages
        const participantLangs = await getMeetingLanguages(session.meetingId);

        if (!config.features.translation || participantLangs.length === 0) {
            // No translation needed, broadcast original
            await broadcastCaption(session.room, {
                meetingId: session.meetingId,
                speakerId,
                speakerName,
                originalText: transcript.text,
                originalLanguage: transcript.language,
                isFinal: true,
                confidence: transcript.confidence,
            });
            return;
        }

        // Translate for each participant
        const captionsWithTranslations = [];

        for (const { userId, language } of participantLangs) {
            const translatedText = await translateText(
                transcript.text,
                transcript.language,
                language,
                saved?.id
            );

            // Map userId to participant identity (assuming they match)
            captionsWithTranslations.push({
                participantIdentity: userId,
                language,
                translatedText,
            });
        }

        // Send translated captions
        await sendTranslatedCaptions(session.room, {
            meetingId: session.meetingId,
            speakerId,
            speakerName,
            originalText: transcript.text,
            originalLanguage: transcript.language,
            isFinal: true,
            confidence: transcript.confidence,
        }, captionsWithTranslations);

    } catch (error) {
        logger.error('Error handling final transcript', { error: error.message });
    }
}

/**
 * Stop transcription for specific participant
 */
function stopTranscriptionForParticipant(session, participantId) {
    const deepgramSession = session.transcriptionSessions.get(participantId);

    if (deepgramSession) {
        deepgramSession.close();
        session.transcriptionSessions.delete(participantId);
        logger.info('Transcription stopped for participant', { participantId });
    }
}

/**
 * Cleanup session
 */
async function cleanupSession(meetingId) {
    const session = activeSessions.get(meetingId);

    if (!session) return;

    // Stop all transcription sessions
    for (const [participantId, deepgramSession] of session.transcriptionSessions) {
        deepgramSession.close();
    }

    // Disconnect from room
    if (session.room) {
        await session.room.disconnect();
    }

    activeSessions.delete(meetingId);
    logger.info('Session cleaned up', { meetingId });
}

/**
 * Get active sessions
 */
export function getActiveSessions() {
    return Array.from(activeSessions.keys());
}

/**
 * Check if meeting has active transcription
 */
export function isTranscribing(meetingId) {
    return activeSessions.has(meetingId);
}

export default {
    startTranscription,
    stopTranscription,
    getActiveSessions,
    isTranscribing,
};

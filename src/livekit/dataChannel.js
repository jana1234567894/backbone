/**
 * LiveKit DataChannel Module
 * Sends captions to participants via LiveKit DataChannel
 */

import { Room, RoomEvent, DataPacket_Kind } from 'livekit-server-sdk';
import { v4 as uuidv4 } from 'uuid';
import logger from '../utils/logger.js';

/**
 * Send caption to specific participant via DataChannel
 */
export async function sendCaptionToParticipant(room, participantIdentity, caption) {
    try {
        const message = {
            type: 'caption',
            messageId: uuidv4(),
            meetingId: caption.meetingId,
            speakerId: caption.speakerId,
            speakerName: caption.speakerName,
            originalText: caption.originalText,
            originalLanguage: caption.originalLanguage,
            translatedText: caption.translatedText,
            targetLanguage: caption.targetLanguage,
            isFinal: caption.isFinal,
            confidence: caption.confidence,
            timestamp: Date.now(),
        };

        const encoder = new TextEncoder();
        const data = encoder.encode(JSON.stringify(message));

        // Send to specific participant
        await room.localParticipant.publishData(
            data,
            DataPacket_Kind.RELIABLE,
            [participantIdentity]
        );

        logger.debug('Caption sent to participant', {
            participantIdentity,
            messageId: message.messageId,
            isFinal: caption.isFinal
        });

        return true;
    } catch (error) {
        logger.error('Error sending caption to participant', {
            participantIdentity,
            error: error.message
        });
        return false;
    }
}

/**
 * Broadcast caption to all participants in room
 */
export async function broadcastCaption(room, caption) {
    try {
        const message = {
            type: 'caption',
            messageId: uuidv4(),
            meetingId: caption.meetingId,
            speakerId: caption.speakerId,
            speakerName: caption.speakerName,
            originalText: caption.originalText,
            originalLanguage: caption.originalLanguage,
            translatedText: caption.translatedText || caption.originalText,
            targetLanguage: caption.targetLanguage || caption.originalLanguage,
            isFinal: caption.isFinal,
            confidence: caption.confidence,
            timestamp: Date.now(),
        };

        const encoder = new TextEncoder();
        const data = encoder.encode(JSON.stringify(message));

        // Broadcast to all participants
        await room.localParticipant.publishData(
            data,
            DataPacket_Kind.RELIABLE
        );

        logger.debug('Caption broadcasted to all', {
            messageId: message.messageId,
            participantCount: room.participants.size,
            isFinal: caption.isFinal
        });

        return true;
    } catch (error) {
        logger.error('Error broadcasting caption', {
            meetingId: caption.meetingId,
            error: error.message
        });
        return false;
    }
}

/**
 * Send caption with translations to multiple participants
 * Each participant receives caption in their preferred language
 */
export async function sendTranslatedCaptions(room, caption, participantLanguages) {
    try {
        const promises = participantLanguages.map(async ({ participantIdentity, language, translatedText }) => {
            const captionWithTranslation = {
                ...caption,
                targetLanguage: language,
                translatedText: translatedText || caption.originalText,
            };

            return sendCaptionToParticipant(room, participantIdentity, captionWithTranslation);
        });

        await Promise.all(promises);

        logger.info('Translated captions sent', {
            meetingId: caption.meetingId,
            participantCount: participantLanguages.length,
            languages: participantLanguages.map(p => p.language).join(', ')
        });

        return true;
    } catch (error) {
        logger.error('Error sending translated captions', {
            meetingId: caption.meetingId,
            error: error.message
        });
        return false;
    }
}

/**
 * Send system message to participants (e.g., "Transcription started")
 */
export async function sendSystemMessage(room, message, participantIdentities = null) {
    try {
        const systemMsg = {
            type: 'system',
            messageId: uuidv4(),
            message: message,
            timestamp: Date.now(),
        };

        const encoder = new TextEncoder();
        const data = encoder.encode(JSON.stringify(systemMsg));

        if (participantIdentities && participantIdentities.length > 0) {
            // Send to specific participants
            await room.localParticipant.publishData(
                data,
                DataPacket_Kind.RELIABLE,
                participantIdentities
            );
        } else {
            // Broadcast to all
            await room.localParticipant.publishData(
                data,
                DataPacket_Kind.RELIABLE
            );
        }

        logger.debug('System message sent', { message, participantCount: participantIdentities?.length || 'all' });

        return true;
    } catch (error) {
        logger.error('Error sending system message', { error: error.message });
        return false;
    }
}

export default {
    sendCaptionToParticipant,
    broadcastCaption,
    sendTranslatedCaptions,
    sendSystemMessage,
};

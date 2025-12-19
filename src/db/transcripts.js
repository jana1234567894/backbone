/**
 * Transcripts Database Module
 * Handles storing and retrieving meeting transcripts
 */

import { createClient } from '@supabase/supabase-js';
import config from '../config/env.js';
import logger from '../utils/logger.js';

const supabase = createClient(config.supabase.url, config.supabase.serviceKey);

/**
 * Save a final transcript to database
 */
export async function saveTranscript(meetingId, speakerId, speakerName, text, language, confidence) {
    try {
        const { data, error } = await supabase
            .from('meeting_transcripts')
            .insert({
                meeting_id: meetingId,
                speaker_id: speakerId,
                speaker_name: speakerName,
                original_text: text,
                detected_language: language,
                confidence: confidence,
                timestamp_ms: Date.now(),
            })
            .select()
            .single();

        if (error) throw error;

        logger.debug('Transcript saved', { meetingId, speakerId, textLength: text.length });
        return data;
    } catch (error) {
        logger.error('Error saving transcript', { meetingId, speakerId, error: error.message });
        return null;
    }
}

/**
 * Get all transcripts for a meeting
 */
export async function getMeetingTranscripts(meetingId) {
    try {
        const { data, error } = await supabase
            .from('meeting_transcripts')
            .select('*')
            .eq('meeting_id', meetingId)
            .order('timestamp_ms', { ascending: true });

        if (error) throw error;

        return data || [];
    } catch (error) {
        logger.error('Error getting meeting transcripts', { meetingId, error: error.message });
        return [];
    }
}

/**
 * Save translation for a transcript
 */
export async function saveTranslation(transcriptId, targetLanguage, translatedText, service = 'libretranslate') {
    try {
        const { data, error } = await supabase
            .from('meeting_translations')
            .insert({
                transcript_id: transcriptId,
                target_language: targetLanguage,
                translated_text: translatedText,
                translation_service: service,
            })
            .select()
            .single();

        if (error) {
            // Ignore duplicate key errors (translation already exists)
            if (error.code === '23505') {
                logger.debug('Translation already exists', { transcriptId, targetLanguage });
                return null;
            }
            throw error;
        }

        logger.debug('Translation saved', { transcriptId, targetLanguage });
        return data;
    } catch (error) {
        logger.error('Error saving translation', { transcriptId, targetLanguage, error: error.message });
        return null;
    }
}

/**
 * Get cached translation
 */
export async function getTranslation(transcriptId, targetLanguage) {
    try {
        const { data, error } = await supabase
            .from('meeting_translations')
            .select('translated_text')
            .eq('transcript_id', transcriptId)
            .eq('target_language', targetLanguage)
            .single();

        if (error) {
            if (error.code === 'PGRST116') {
                // No translation found
                return null;
            }
            throw error;
        }

        return data?.translated_text;
    } catch (error) {
        logger.error('Error getting translation', { transcriptId, targetLanguage, error: error.message });
        return null;
    }
}

/**
 * Delete all transcripts for a meeting (cleanup)
 */
export async function deleteMeetingTranscripts(meetingId) {
    try {
        const { error } = await supabase
            .from('meeting_transcripts')
            .delete()
            .eq('meeting_id', meetingId);

        if (error) throw error;

        logger.info('Meeting transcripts deleted', { meetingId });
        return true;
    } catch (error) {
        logger.error('Error deleting transcripts', { meetingId, error: error.message });
        return false;
    }
}

export default {
    saveTranscript,
    getMeetingTranscripts,
    saveTranslation,
    getTranslation,
    deleteMeetingTranscripts,
};

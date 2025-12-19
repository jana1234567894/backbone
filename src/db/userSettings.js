/**
 * User Settings Database Module
 * Handles user language preferences and caption settings
 */

import { createClient } from '@supabase/supabase-js';
import config from '../config/env.js';
import logger from '../utils/logger.js';

const supabase = createClient(config.supabase.url, config.supabase.serviceKey);

/**
 * Get user's language preference
 */
export async function getUserLanguage(userId) {
    try {
        const { data, error } = await supabase
            .from('user_settings')
            .select('preferred_language')
            .eq('user_id', userId)
            .single();

        if (error) {
            if (error.code === 'PGRST116') {
                // No settings found, return default
                return 'en';
            }
            throw error;
        }

        return data?.preferred_language || 'en';
    } catch (error) {
        logger.error('Error getting user language', { userId, error: error.message });
        return 'en'; // Fallback to English
    }
}

/**
 * Update user's language preference
 */
export async function updateUserLanguage(userId, language) {
    try {
        const { error } = await supabase
            .from('user_settings')
            .upsert({
                user_id: userId,
                preferred_language: language,
                updated_at: new Date().toISOString(),
            }, {
                onConflict: 'user_id'
            });

        if (error) throw error;

        logger.info('User language updated', { userId, language });
        return true;
    } catch (error) {
        logger.error('Error updating user language', { userId, language, error: error.message });
        return false;
    }
}

/**
 * Get all users in a meeting with their language preferences
 */
export async function getMeetingLanguages(meetingId) {
    try {
        // Get all participants in the meeting
        const { data: participants, error: partError } = await supabase
            .from('meeting_participants')
            .select('user_id')
            .eq('meeting_id', meetingId);

        if (partError) throw partError;

        if (!participants || participants.length === 0) {
            return [];
        }

        // Get language preferences for all participants
        const userIds = participants.map(p => p.user_id);
        const { data: settings, error: settingsError } = await supabase
            .from('user_settings')
            .select('user_id, preferred_language')
            .in('user_id', userIds);

        if (settingsError) throw settingsError;

        // Map user IDs to languages, default to 'en' if no preference set
        const languageMap = new Map();
        participants.forEach(p => {
            const userSetting = settings?.find(s => s.user_id === p.user_id);
            languageMap.set(p.user_id, userSetting?.preferred_language || 'en');
        });

        return Array.from(languageMap.entries()).map(([userId, language]) => ({
            userId,
            language
        }));
    } catch (error) {
        logger.error('Error getting meeting languages', { meetingId, error: error.message });
        return [];
    }
}

/**
 * Check if user has captions enabled
 */
export async function getCaptionsEnabled(userId) {
    try {
        const { data, error } = await supabase
            .from('user_settings')
            .select('enable_captions')
            .eq('user_id', userId)
            .single();

        if (error && error.code !== 'PGRST116') {
            throw error;
        }

        return data?.enable_captions !== false; // Default to true
    } catch (error) {
        logger.error('Error checking captions enabled', { userId, error: error.message });
        return true; // Default to enabled
    }
}

export default {
    getUserLanguage,
    updateUserLanguage,
    getMeetingLanguages,
    getCaptionsEnabled,
};

-- ============================================
-- Live Transcription & Translation Schema
-- Run this in Supabase SQL Editor
-- ============================================

-- 1. User Settings (Language Preferences)
CREATE TABLE IF NOT EXISTS user_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    preferred_language VARCHAR(10) DEFAULT 'en',
    enable_captions BOOLEAN DEFAULT true,
    enable_translation BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id)
);

-- Index for fast user lookup
CREATE INDEX IF NOT EXISTS idx_user_settings_user_id ON user_settings(user_id);

-- 2. Meeting Transcripts (Final transcripts only)
CREATE TABLE IF NOT EXISTS meeting_transcripts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    meeting_id VARCHAR(50) NOT NULL,
    speaker_id VARCHAR(100) NOT NULL,
    speaker_name VARCHAR(255),
    original_text TEXT NOT NULL,
    detected_language VARCHAR(10),
    confidence DECIMAL(3,2),
    timestamp_ms BIGINT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_transcripts_meeting ON meeting_transcripts(meeting_id);
CREATE INDEX IF NOT EXISTS idx_transcripts_timestamp ON meeting_transcripts(meeting_id, timestamp_ms);
CREATE INDEX IF NOT EXISTS idx_transcripts_speaker ON meeting_transcripts(speaker_id);

-- 3. Meeting Translations (Cached translations)
CREATE TABLE IF NOT EXISTS meeting_translations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transcript_id UUID REFERENCES meeting_transcripts(id) ON DELETE CASCADE,
    target_language VARCHAR(10) NOT NULL,
    translated_text TEXT NOT NULL,
    translation_service VARCHAR(50),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(transcript_id, target_language)
);

-- Index for fast translation lookup
CREATE INDEX IF NOT EXISTS idx_translations_transcript ON meeting_translations(transcript_id);
CREATE INDEX IF NOT EXISTS idx_translations_language ON meeting_translations(target_language);

-- 4. Row Level Security (RLS) Policies

-- Enable RLS on all tables
ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE meeting_transcripts ENABLE ROW LEVEL SECURITY;
ALTER TABLE meeting_translations ENABLE ROW LEVEL SECURITY;

-- User settings: Users can read/update their own settings
CREATE POLICY IF NOT EXISTS "Users can view own settings"
    ON user_settings FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY IF NOT EXISTS "Users can update own settings"
    ON user_settings FOR UPDATE
    USING (auth.uid() = user_id);

CREATE POLICY IF NOT EXISTS "Users can insert own settings"
    ON user_settings FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- Transcripts: Anyone in the meeting can view
CREATE POLICY IF NOT EXISTS "Users can view meeting transcripts"
    ON meeting_transcripts FOR SELECT
    USING (true);  -- TODO: Add meeting participant check

CREATE POLICY IF NOT EXISTS "Service role can insert transcripts"
    ON meeting_transcripts FOR INSERT
    WITH CHECK (true);  -- Backend uses service role

-- Translations: Anyone can view
CREATE POLICY IF NOT EXISTS "Users can view translations"
    ON meeting_translations FOR SELECT
    USING (true);

CREATE POLICY IF NOT EXISTS "Service role can insert translations"
    ON meeting_translations FOR INSERT
    WITH CHECK (true);  -- Backend uses service role

-- 5. Functions for easy access

-- Function to get user's preferred language
CREATE OR REPLACE FUNCTION get_user_language(p_user_id UUID)
RETURNS VARCHAR(10) AS $$
BEGIN
    RETURN (
        SELECT preferred_language 
        FROM user_settings 
        WHERE user_id = p_user_id
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get all users' languages in a meeting
CREATE OR REPLACE FUNCTION get_meeting_languages(p_meeting_id VARCHAR(50))
RETURNS TABLE(user_id UUID, language VARCHAR(10)) AS $$
BEGIN
    RETURN QUERY
    SELECT mp.user_id, COALESCE(us.preferred_language, 'en') as language
    FROM meeting_participants mp
    LEFT JOIN user_settings us ON us.user_id = mp.user_id
    WHERE mp.meeting_id = p_meeting_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. Triggers for updated_at

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_user_settings_updated_at
    BEFORE UPDATE ON user_settings
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- 7. Insert default settings for existing users

INSERT INTO user_settings (user_id, preferred_language, enable_captions, enable_translation)
SELECT id, 'en', true, true
FROM auth.users
WHERE id NOT IN (SELECT user_id FROM user_settings)
ON CONFLICT (user_id) DO NOTHING;

-- 8. Comments for documentation

COMMENT ON TABLE user_settings IS 'User language preferences for captions and translations';
COMMENT ON TABLE meeting_transcripts IS 'Final transcripts from meetings (no interim data)';
COMMENT ON TABLE meeting_translations IS 'Cached translations for transcripts';

COMMENT ON COLUMN meeting_transcripts.confidence IS 'STT confidence score (0.00 - 1.00)';
COMMENT ON COLUMN meeting_transcripts.timestamp_ms IS 'Unix timestamp in milliseconds';
COMMENT ON COLUMN meeting_translations.translation_service IS 'Service used: libretranslate, google, deepl';

-- Success message
SELECT 'Transcription schema migration completed successfully!' as status;

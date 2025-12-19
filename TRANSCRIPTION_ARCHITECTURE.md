# Backend-Only Live Transcription & Translation Architecture

## 🏗️ Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         FRONTEND                                 │
│  - Captures audio via LiveKit                                   │
│  - Receives captions via LiveKit DataChannel                    │
│  - Renders captions ONLY                                        │
│  - NO API keys, NO STT, NO translation logic                   │
└──────────────────────┬──────────────────────────────────────────┘
                       │ LiveKit Audio + Data
                       ▼
┌─────────────────────────────────────────────────────────────────┐
│                       LIVEKIT CLOUD                              │
│  - Audio/Video Routing                                          │
│  - Room Management                                              │
└──────────────────────┬──────────────────────────────────────────┘
                       │ Audio Streams + Webhooks
                       ▼
┌─────────────────────────────────────────────────────────────────┐
│                    BACKEND (Railway)                             │
│                                                                  │
│  ┌────────────────────────────────────────────────────────┐    │
│  │ LiveKit Agent (Audio Subscriber)                       │    │
│  │  - Subscribes to all participant audio tracks          │    │
│  │  - Converts to PCM/Linear16                            │    │
│  │  - Streams 20-50ms chunks                              │    │
│  └───────────┬────────────────────────────────────────────┘    │
│              │                                                   │
│              ▼                                                   │
│  ┌────────────────────────────────────────────────────────┐    │
│  │ Deepgram STT Module                                    │    │
│  │  - Streaming WebSocket connection                      │    │
│  │  - Receives interim & final transcripts                │    │
│  │  - Language detection                                  │    │
│  │  - Speaker diarization                                 │    │
│  └───────────┬────────────────────────────────────────────┘    │
│              │                                                   │
│              ▼                                                   │
│  ┌────────────────────────────────────────────────────────┐    │
│  │ Translation Module                                     │    │
│  │  - Fetches user language preferences from Supabase     │    │
│  │  - Translates to all required languages               │    │
│  │  - Caches translations (avoid duplicate API calls)    │    │
│  │  - LibreTranslate/Google Translate/DeepL              │    │
│  └───────────┬────────────────────────────────────────────┘    │
│              │                                                   │
│              ▼                                                   │
│  ┌────────────────────────────────────────────────────────┐    │
│  │ Caption Broadcaster                                    │    │
│  │  - Sends captions via LiveKit DataChannel              │    │
│  │  - Per-user language targeting                        │    │
│  │  - Real-time, low-latency                             │    │
│  └───────────┬────────────────────────────────────────────┘    │
│              │                                                   │
│              ▼                                                   │
│  ┌────────────────────────────────────────────────────────┐    │
│  │ Database Persistence (Supabase)                        │    │
│  │  - Store FINAL transcripts only                        │    │
│  │  - Store translations                                  │    │
│  │  - NO interim data, NO raw audio                      │    │
│  └────────────────────────────────────────────────────────┘    │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## 📁 Backend Folder Structure

```
polgotmeet_backend/
├── src/
│   ├── server.js                    # Main Express server (existing)
│   ├── config/
│   │   └── env.js                   # Environment variables loader
│   ├── livekit/
│   │   ├── agent.js                 # LiveKit audio subscription agent
│   │   ├── dataChannel.js           # Caption broadcasting
│   │   └── roomManager.js           # Room lifecycle management
│   ├── stt/
│   │   ├── deepgram.js              # Deepgram STT service
│   │   └── audioProcessor.js        # PCM conversion & buffering
│   ├── translation/
│   │   ├── translator.js            # Translation service
│   │   ├── cache.js                 # Translation cache
│   │   └── languageDetector.js      # Language detection
│   ├── db/
│   │   ├── transcripts.js           # Transcript CRUD
│   │   ├── userSettings.js          # User language preferences
│   │   └── migrations.js            # Schema migrations
│   ├── websocket/
│   │   └── captionEmitter.js        # WebSocket fallback (optional)
│   └── utils/
│       ├── logger.js                # Logging utility
│       └── errorHandler.js          # Error handling
├── package.json
├── .env
└── README.md
```

## 🔄 Data Flow

### 1. Audio Capture → Transcription
```
LiveKit Participant Audio
         ↓
Backend subscribes to track
         ↓
Convert to PCM Linear16 (16kHz, 16-bit)
         ↓
Stream 20-50ms chunks to Deepgram WebSocket
         ↓
Receive: { transcript, isFinal, language, confidence }
```

### 2. Transcription → Translation
```
Final Transcript Received
         ↓
Query Supabase: Which users need which languages?
         ↓
For each target language:
    - Check cache first
    - If miss: Call translation API
    - Store in cache
         ↓
Return all translations
```

### 3. Translation → Delivery
```
Translations Ready
         ↓
For each user in meeting:
    - Get their preferred language
    - Find matching translation
    - Send via LiveKit DataChannel
         ↓
User's frontend receives & renders
```

## 🗄️ Supabase Database Schema

### 1. user_settings (User Language Preferences)
```sql
CREATE TABLE user_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    preferred_language VARCHAR(10) DEFAULT 'en',
    enable_captions BOOLEAN DEFAULT true,
    enable_translation BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id)
);

CREATE INDEX idx_user_settings_user_id ON user_settings(user_id);
```

### 2. meeting_transcripts (Final Transcripts)
```sql
CREATE TABLE meeting_transcripts (
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

CREATE INDEX idx_transcripts_meeting ON meeting_transcripts(meeting_id);
CREATE INDEX idx_transcripts_timestamp ON meeting_transcripts(meeting_id, timestamp_ms);
```

### 3. meeting_translations (Cached Translations)
```sql
CREATE TABLE meeting_translations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transcript_id UUID REFERENCES meeting_transcripts(id) ON DELETE CASCADE,
    target_language VARCHAR(10) NOT NULL,
    translated_text TEXT NOT NULL,
    translation_service VARCHAR(50),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(transcript_id, target_language)
);

CREATE INDEX idx_translations_transcript ON meeting_translations(transcript_id);
```

## 📡 LiveKit DataChannel Payload

### Caption Message Format
```typescript
interface CaptionMessage {
    type: 'caption';
    messageId: string;              // Unique message ID
    meetingId: string;
    speakerId: string;              // LiveKit participant identity
    speakerName: string;
    originalText: string;           // Original language text
    originalLanguage: string;       // Detected language code (e.g., 'en')
    translatedText: string;         // Translated to user's language
    targetLanguage: string;         // User's preferred language
    isFinal: boolean;               // true = final, false = interim
    confidence: number;             // 0.0 - 1.0
    timestamp: number;              // Unix timestamp ms
}
```

### Example Payload
```json
{
    "type": "caption",
    "messageId": "550e8400-e29b-41d4-a716-446655440000",
    "meetingId": "ABC-123-XYZ",
    "speakerId": "user_123",
    "speakerName": "John Doe",
    "originalText": "Hello everyone",
    "originalLanguage": "en",
    "translatedText": "வணக்கம் அனைவருக்கும்",
    "targetLanguage": "ta",
    "isFinal": true,
    "confidence": 0.95,
    "timestamp": 1703001234567
}
```

## ⚙️ Configuration (Environment Variables)

```bash
# Existing
LIVEKIT_URL=wss://your-livekit.livekit.cloud
LIVEKIT_API_KEY=your-api-key
LIVEKIT_API_SECRET=your-api-secret
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your-service-key

# New for Transcription & Translation
DEEPGRAM_API_KEY=your-deepgram-key
TRANSLATION_SERVICE=libretranslate  # or 'google' or 'deepl'
LIBRETRANSLATE_URL=https://libretranslate.de
GOOGLE_TRANSLATE_API_KEY=your-google-key  # if using Google
DEEPL_API_KEY=your-deepl-key  # if using DeepL

# Optional
ENABLE_TRANSCRIPTION=true
ENABLE_TRANSLATION=true
CACHE_TRANSLATIONS=true
LOG_LEVEL=info
```

## 🔐 Security Considerations

1. **API Key Protection**
   - All keys in Railway environment variables
   - Never exposed to frontend
   - Server-side only access

2. **Data Privacy**
   - Audio never stored (only streamed)
   - Interim transcripts not persisted
   - Only final transcripts saved
   - GDPR compliant (can delete user data)

3. **Access Control**
   - Verify user is in meeting before sending captions
   - Validate LiveKit participant identity
   - Rate limiting on API endpoints

## 🚀 Performance Optimizations

1. **Translation Caching**
   - In-memory cache (LRU)
   - Database cache for cross-session
   - Avoid duplicate translations

2. **Audio Processing**
   - Efficient PCM conversion
   - Buffering to reduce API calls
   - Non-blocking async operations

3. **Deepgram Optimization**
   - Keep WebSocket connections alive
   - Graceful reconnection on disconnect
   - Batch interim results

4. **Cost Optimization**
   - Only translate for users who need it
   - Cache aggressively
   - Use interim transcripts wisely (don't translate)

## 🔄 Reconnection Strategy

### Deepgram WebSocket
```javascript
const reconnectionPolicy = {
    maxRetries: 5,
    backoff: 'exponential',  // 1s, 2s, 4s, 8s, 16s
    onDisconnect: () => {
        // 1. Log error
        // 2. Notify users "Transcription temporarily unavailable"
        // 3. Attempt reconnection
        // 4. Resume from last known state
    }
};
```

### LiveKit Agent
```javascript
const agentPolicy = {
    reconnect: true,
    heartbeat: 30000,  // 30s heartbeat
    onConnectionLost: async () => {
        // 1. Clean up resources
        // 2. Reconnect to room
        // 3. Resubscribe to audio tracks
    }
};
```

## 📊 Error Handling

### Graceful Degradation
1. **STT Fails**: Continue meeting without captions
2. **Translation Fails**: Show original text fallback
3. **Network Issues**: Queue messages, retry delivery
4. **Database Down**: Continue live captions, skip persistence

### Error Types
```typescript
enum TranscriptionError {
    DEEPGRAM_CONNECTION_FAILED = 'deepgram_conn_fail',
    AUDIO_PROCESSING_ERROR = 'audio_proc_error',
    TRANSLATION_FAILED = 'translation_fail',
    DATABASE_ERROR = 'db_error',
    LIVEKIT_SUBSCRIPTION_FAILED = 'lk_sub_fail'
}
```

## 💰 Cost Estimation (Free Tier Friendly)

### Deepgram Costs
- $0.0059 per minute of audio
- Free tier: $200 credit
- ~33,898 minutes free (~565 hours)

### Translation Costs
- LibreTranslate: **FREE** (self-hosted or public API)
- Google Translate: $20 per 1M characters
- DeepL: 500,000 chars/month free

### Railway Resources
- 500 hours/month free execution time
- Sufficient for small to medium traffic
- Scales as needed

## 🎯 Implementation Phases

### Phase 1: Core STT (Week 1)
- [ ] LiveKit agent setup
- [ ] Deepgram integration
- [ ] Audio processing pipeline
- [ ] Basic caption delivery

### Phase 2: Translation (Week 2)
- [ ] Translation service
- [ ] User language preferences
- [ ] Multi-language support
- [ ] Caching layer

### Phase 3: Persistence (Week 3)
- [ ] Database schema
- [ ] Save final transcripts
- [ ] Save translations
- [ ] Transcript export feature

### Phase 4: Optimization (Week 4)
- [ ] Performance tuning
- [ ] Error handling refinement
- [ ] Monitoring & logging
- [ ] Cost optimization

## 📝 Design Decisions & Rationale

### 1. Backend-Only Approach
**Why**: Security, cost control, consistency, easier maintenance

### 2. LiveKit DataChannel vs WebSocket
**Choice**: LiveKit DataChannel  
**Why**: Already connected, lower latency, no extra infrastructure

### 3. Deepgram vs Others
**Why**: Best accuracy, streaming support, competitive pricing, good Node.js SDK

### 4. LibreTranslate vs Paid APIs
**Default**: LibreTranslate (free)  
**Fallback**: Google/DeepL for premium users  
**Why**: Cost-effective for startups

### 5. Cache Translations
**Why**: Same phrases used repeatedly, reduces API costs by 70-90%

### 6. Only Store Final Transcripts
**Why**: Interim data is noisy, wastes storage, rarely useful post-meeting

## 🔍 Monitoring & Observability

### Metrics to Track
1. **Transcription Quality**
   - Accuracy rate (confidence scores)
   - Language detection success
   - Latency (audio → caption delivery)

2. **Translation Performance**
   - Cache hit rate
   - Translation latency
   - API error rate

3. **System Health**
   - Deepgram connection uptime
   - LiveKit subscription success
   - Database query performance

### Logging Strategy
```javascript
logger.info('Caption delivered', {
    meetingId,
    speakerId,
    language,
    latency: Date.now() - transcriptTimestamp,
    cached: wasCached
});
```

---

**This architecture ensures:**
- ✅ All logic in backend
- ✅ Frontend only renders
- ✅ Production-grade patterns
- ✅ Cost-optimized
- ✅ Scalable
- ✅ Secure
- ✅ Railway-friendly

Next: Implementation of each module!

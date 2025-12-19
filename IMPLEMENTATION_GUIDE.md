# 🎯 Backend-Only Transcription & Translation - Implementation Guide

## ✅ What's Been Done

### 1. Architecture Document
- ✅ `TRANSCRIPTION_ARCHITECTURE.md` - Complete system design
- ✅ Data flow diagrams
- ✅ Module breakdown
- ✅ Performance & cost optimization strategy

### 2. Package Updates
- ✅ `package.json` updated with new dependencies:
  - `@deepgram/sdk` - Deepgram STT
  - `ws` - WebSocket support
  - `@libretranslate/lib` - Free translation  
  - `node-cache` - Translation caching
  - `uuid` - Unique IDs

### 3. Database Schema
- ✅ `database_transcription_schema.sql` - Complete schema
  - `user_settings` table
  - `meeting_transcripts` table
  - `meeting_translations` table
  - RLS policies
  - Helper functions

---

## 📋 Implementation Checklist

### Phase 1: Core Infrastructure (Do This First)

#### Step 1.1: Install Dependencies
```bash
cd polgotmeet_backend
npm install
```

#### Step 1.2: Run Database Migration
1. Go to Supabase SQL Editor
2. Run `database_transcription_schema.sql`
3. Verify tables created

#### Step 1.3: Add Environment Variables
Add to Railway (or `.env` for local):
```bash
# Deepgram STT
DEEPGRAM_API_KEY=your-deepgram-key

# Translation (choose one or multiple)
TRANSLATION_SERVICE=libretranslate
LIBRETRANSLATE_URL=https://libretranslate.de

# Optional: Paid services for better quality
# GOOGLE_TRANSLATE_API_KEY=your-google-key
# DEEPL_API_KEY=your-deepl-key

# Feature flags
ENABLE_TRANSCRIPTION=true
ENABLE_TRANSLATION=true
CACHE_TRANSLATIONS=true
```

---

### Phase 2: Create Modular Backend Structure

#### Directory Structure to Create:
```bash
cd polgotmeet_backend/src

# Create directories
mkdir -p config livekit stt translation db utils
```

#### Files to Create:

##### 1. Config Module
**File: `src/config/env.js`**
- Load and validate environment variables
- Export configuration object
- Fail fast if required vars missing

##### 2. Database Module  
**File: `src/db/userSettings.js`**
- Get user's preferred language
- Update user settings
- Get all users in meeting with their languages

**File: `src/db/transcripts.js`**
- Save final transcript
- Get meeting transcripts
- Export transcript

**File: `src/db/translations.js`**
- Save translation
- Get cached translation
- Bulk insert translations

##### 3. STT Module
**File: `src/stt/deepgram.js`**
- Initialize Deepgram client
- Create streaming connection
- Handle interim/final transcripts
- Language detection
- Auto-reconnect on disconnect

**File: `src/stt/audioProcessor.js`**
- Convert LiveKit audio to PCM
- Buffer audio chunks
- Stream to Deepgram

##### 4. Translation Module
**File: `src/translation/translator.js`**
- Translate text to target language
- Support LibreTranslate, Google, DeepL
- Fallback between services

**File: `src/translation/cache.js`**
- In-memory LRU cache
- Check if translation exists
- Save to cache and DB

##### 5. LiveKit Module
**File: `src/livekit/agent.js`**
- Connect to LiveKit room as agent
- Subscribe to all participant audio tracks
- Route audio to STT service
- Handle participant join/leave

**File: `src/livekit/dataChannel.js`**
- Send captions via LiveKit DataChannel
- Target specific participants
- Handle delivery failures

##### 6. Utils
**File: `src/utils/logger.js`**
- Structured logging
- Different log levels
- Performance metrics

**File: `src/utils/errorHandler.js`**
- Centralized error handling
- Graceful degradation
- Error reporting

---

### Phase 3: Integration with Existing Server

#### Update `src/server.js`

Add new endpoints:
```javascript
// Get user language preferences
app.get('/user-settings/:userId', async (req, res) => {
    // Return user's language settings
});

// Update user language preferences  
app.put('/user-settings/:userId', async (req, res) => {
    // Update user's language preference
});

// Get meeting transcripts
app.get('/meeting-transcripts/:meetingId', async (req, res) => {
    // Return all transcripts for meeting
});

// Start transcription for a meeting
app.post('/start-transcription/:meetingId', async (req, res) => {
    // Start LiveKit agent for this meeting
});

// Stop transcription for a meeting
app.post('/stop-transcription/:meetingId', async (req, res) => {
    // Stop LiveKit agent
});
```

---

## 🔄 How It Works (End-to-End)

### 1. Meeting Starts
```
1. User creates/joins meeting
2. Frontend calls: POST /start-transcription/ABC-123
3. Backend:
   - Spins up LiveKit agent
   - Connects to room as participant
   - Subscribes to all audio tracks
```

### 2. Audio Processing
```
1. Participant speaks
2. LiveKit sends audio to backend agent
3. Backend converts to PCM
4. Streams to Deepgram WebSocket
5. Deepgram returns:
   - Interim: "Hello eve..."
   - Final: "Hello everyone"
```

### 3. Translation
```
1. Backend receives FINAL transcript
2. Queries: Which users need which languages?
   - User A: Tamil
   - User B: Hindi
   - User C: English (original)
3. For each language:
   - Check cache
   - If miss: Call translation API
   - Save to cache + DB
```

### 4. Caption Delivery
```
1. For each participant:
   - Get their language preference
   - Get matching translation
   - Send via LiveKit DataChannel:
   
   DataChannel.send({
       type: "caption",
       speakerId: "user_123",
       originalText: "Hello everyone",
       translatedText: "வணக்கம் அனைவருக்கும்",
       isFinal: true
   })
```

### 5. Frontend Receives
```
1. Frontend listens to DataChannel
2. Receives caption message
3. Renders on screen
4. NO processing, just display
```

---

## 🔒 Safety Measures

### 1. Non-Breaking Integration
- ✅ New feature is **opt-in**
- ✅ Existing functionality unchanged
- ✅ Feature flags to enable/disable
- ✅ Backwards compatible

### 2. Error Handling
- ✅ If STT fails → Meeting continues without captions
- ✅ If translation fails → Show original text
- ✅ If network issues → Queue and retry
- ✅ If DB down → Skip persistence, continue live

### 3. Resource Management
- ✅ One agent per meeting (not per participant)
- ✅ Auto-cleanup when meeting ends
- ✅ Connection pooling for DB
- ✅ Memory limits on cache

### 4. Testing Strategy
```
1. Unit tests for each module
2. Integration tests for full flow
3. Load testing for multiple meetings
4. Failover testing (kill Deepgram, kill DB, etc.)
```

---

## 💰 Cost Estimation

### For 100 concurrent users, 1-hour meeting:

**Deepgram:**
- 100 users × 60 minutes = 6,000 minutes
- $0.0059/min = $35.40
- With 50% talk time: ~$18

**Translation (LibreTranslate):**
- FREE if using public API
- Or $50/month for private instance

**Railway:**
- Free tier: 500 hours/month
- Likely fits in free tier for testing
- Scale: $5-20/month for production

**Total estimated cost:** ~$20-40/month for moderate usage

---

## 📊 Performance Targets

### Latency
- **Audio to Deepgram:** <50ms
- **Transcription:** 100-300ms
- **Translation:** 50-200ms
- **Caption delivery:** <50ms
- **Total (speaking → caption):** **<500ms** ✅

### Throughput
- **Concurrent meetings:** 50+ on free tier
- **Participants per meeting:** Unlimited (server-sent captions)
- **Languages supported:** 100+ (LibreTranslate)

### Reliability
- **Uptime target:** 99.9% (if Deepgram/Railway stable)
- **Error rate:** <0.1%
- **Reconnection:** Auto-retry within 30s

---

## 🧪 Testing Plan

### 1. Local Testing
```bash
# Start backend
cd polgotmeet_backend
npm install
npm run dev

# Test endpoints
curl http://localhost:8080/health
curl http://localhost:8080/user-settings/user123
```

### 2. Integration Testing
1. Create meeting
2. Start transcription
3. Speak into mic
4. Verify captions appear
5. Change language
6. Verify translation works

### 3. Load Testing
- Use Artillery or k6
- Simulate 10 concurrent meetings
- Monitor CPU, memory, latency

---

## 📝 Implementation Priority

### Must Have (MVP):
1. ✅ Database schema
2. ✅ Package dependencies
3. ⏳ Basic Deepgram STT
4. ⏳ LiveKit agent connection
5. ⏳ Caption delivery via DataChannel
6. ⏳ User language settings

### Should Have (V1):
1. ⏳ Translation (English → Other languages)
2. ⏳ Translation caching
3. ⏳ Transcript persistence
4. ⏳ Error handling

### Nice to Have (V2):
1. ⏳ Multiple translation services
2. ⏳ Transcript export
3. ⏳ Speaker diarization
4. ⏳ Profanity filter
5. ⏳ Sentiment analysis

---

## 🚦 Next Steps

### Immediate (You should do):
1. **Install dependencies:**
   ```bash
   cd polgotmeet_backend
   npm install
   ```

2. **Run database migration:**
   - Open Supabase SQL Editor
   - Run `database_transcription_schema.sql`

3. **Get Deepgram API key:**
   - Sign up: https://deepgram.com
   - Get free $200 credit
   - Copy API key

4. **Add to Railway:**
   - Go to Railway project
   - Add environment variable: `DEEPGRAM_API_KEY=xxx`

### Then We'll Implement:
1. Config module
2. DB modules
3. STT module
4. LiveKit agent
5. Translation module
6. Integration tests

---

## ⚠️ Important Notes

### Frontend Changes Required:
The frontend currently has translation logic in `Meeting.tsx`. We need to:
1. **Remove** browser-based translation
2. **Add** DataChannel listener for captions
3. **Display** received caption data

**But this is safe** because:
- Old system keeps working until new backend is deployed
- Can run both in parallel during migration
- Easy rollback if issues

### Migration Strategy:
1. Deploy new backend modules
2. Test with flag `ENABLE_TRANSCRIPTION=false`
3. When ready: Set flag to `true`
4. Update frontend to listen to DataChannel
5. Remove old frontend translation code

---

## 📞 Need Help?

If you need help with:
- Implementing specific modules
- Debugging issues
- Performance optimization
- Cost reduction

Just ask! We can implement one module at a time to ensure safety.

---

**Status:** Architecture complete, ready for implementation  
**Risk:** LOW (non-breaking, opt-in, backwards compatible)  
**Effort:** Medium (1-2 weeks to MVP)  
**Value:** HIGH (major feature, competitive advantage)

Ready to proceed with Phase 1? 🚀

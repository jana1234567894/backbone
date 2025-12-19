# Environment Variables Configuration for Railway

## 🔐 Complete Environment Variables Setup

### Required Variables (Already Set)
These should already be in your Railway project:

```bash
# LiveKit Configuration
LIVEKIT_URL=wss://your-livekit.livekit.cloud
LIVEKIT_API_KEY=your-livekit-api-key
LIVEKIT_API_SECRET=your-livekit-secret

# Supabase Configuration
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your-service-role-key

# Server Configuration
PORT=8080  # Railway sets this automatically
NODE_ENV=production
```

---

## 🆕 New Variables for Transcription & Translation

### 1. Deepgram (Speech-to-Text)
```bash
DEEPGRAM_API_KEY=5d961a2d7f0e92a14ffef0751effe85cd31495f1
```

**To set on Railway:**
1. Go to your Railway project
2. Click on your backend service
3. Go to "Variables" tab
4. Click "+ New Variable"
5. Name: `DEEPGRAM_API_KEY`
6. Value: `5d961a2d7f0e92a14ffef0751effe85cd31495f1`
7. Click "Add"

---

### 2. Translation Service Configuration
```bash
# Translation Service Selection
TRANSLATION_SERVICE=libretranslate

# LibreTranslate (FREE - Recommended for testing)
LIBRETRANSLATE_URL=https://libretranslate.de

# OR use these if you want paid services (optional):
# GOOGLE_TRANSLATE_API_KEY=your-google-key
# DEEPL_API_KEY=your-deepl-key
```

**Set these on Railway:**
1. `TRANSLATION_SERVICE` = `libretranslate`
2. `LIBRETRANSLATE_URL` = `https://libretranslate.de`

---

### 3. Feature Flags (Optional but Recommended)
```bash
# Feature Toggles
ENABLE_TRANSCRIPTION=true
ENABLE_TRANSLATION=true
CACHE_TRANSLATIONS=true

# Logging
LOG_LEVEL=info
```

**Set on Railway:**
1. `ENABLE_TRANSCRIPTION` = `false` (set to `true` when ready to test)
2. `ENABLE_TRANSLATION` = `false` (set to `true` when ready to test)
3. `CACHE_TRANSLATIONS` = `true`
4. `LOG_LEVEL` = `info`

---

## 📋 Complete Railway Setup Checklist

### Step 1: Add Core Variables
- [ ] `DEEPGRAM_API_KEY` = `5d961a2d7f0e92a14ffef0751effe85cd31495f1`

### Step 2: Add Translation Config
- [ ] `TRANSLATION_SERVICE` = `libretranslate`
- [ ] `LIBRETRANSLATE_URL` = `https://libretranslate.de`

### Step 3: Add Feature Flags (Start with disabled)
- [ ] `ENABLE_TRANSCRIPTION` = `false`
- [ ] `ENABLE_TRANSLATION` = `false`
- [ ] `CACHE_TRANSLATIONS` = `true`
- [ ] `LOG_LEVEL` = `info`

### Step 4: Verify Existing Variables
- [ ] `LIVEKIT_URL` is set
- [ ] `LIVEKIT_API_KEY` is set
- [ ] `LIVEKIT_API_SECRET` is set
- [ ] `SUPABASE_URL` is set
- [ ] `SUPABASE_SERVICE_KEY` is set

---

## 🎯 Quick Copy-Paste for Railway

```plaintext
DEEPGRAM_API_KEY=5d961a2d7f0e92a14ffef0751effe85cd31495f1
TRANSLATION_SERVICE=libretranslate
LIBRETRANSLATE_URL=https://libretranslate.de
ENABLE_TRANSCRIPTION=false
ENABLE_TRANSLATION=false
CACHE_TRANSLATIONS=true
LOG_LEVEL=info
```

**Add each line as a separate variable in Railway.**

---

## 🔄 Deployment Strategy

### Phase 1: Setup (Do Now)
1. ✅ Add all environment variables to Railway
2. ✅ Keep `ENABLE_TRANSCRIPTION=false`
3. ✅ Keep `ENABLE_TRANSLATION=false`
4. Railway redeploys → **Nothing changes** (features disabled)

### Phase 2: Database Setup (Do Next)
1. Run `database_transcription_schema.sql` in Supabase
2. Verify tables created
3. Test database access

### Phase 3: Implementation (Later)
1. We implement the actual modules
2. Deploy code to GitHub
3. Railway auto-deploys

### Phase 4: Enable Features (When Ready)
1. Set `ENABLE_TRANSCRIPTION=true`
2. Set `ENABLE_TRANSLATION=true`
3. Test with real meeting
4. Monitor logs

---

## 🔐 Security Best Practices

### After Setting on Railway:

1. **Regenerate Deepgram Key** (Recommended)
   - Go to: https://console.deepgram.com
   - Navigate to API Keys
   - Create new key
   - Update on Railway
   - Delete old key

2. **Never Commit Keys to Git**
   - ✅ Keys only in Railway
   - ✅ Use `.env.example` with placeholders
   - ❌ Never in `.env` (gitignored anyway)
   - ❌ Never in code files

3. **Use Environment Variables Only**
   ```javascript
   // ✅ Good
   const apiKey = process.env.DEEPGRAM_API_KEY;
   
   // ❌ Bad
   const apiKey = "5d961a2d7f0e92a14ffef0751effe85cd31495f1";
   ```

---

## 📊 Variable Reference Table

| Variable | Value | Required | Purpose |
|----------|-------|----------|---------|
| `DEEPGRAM_API_KEY` | Your key | ✅ Yes | Speech-to-text |
| `TRANSLATION_SERVICE` | `libretranslate` | ✅ Yes | Which translation API |
| `LIBRETRANSLATE_URL` | `https://libretranslate.de` | ✅ Yes | Free translation endpoint |
| `ENABLE_TRANSCRIPTION` | `false` → `true` | ⚠️ Optional | Feature toggle |
| `ENABLE_TRANSLATION` | `false` → `true` | ⚠️ Optional | Feature toggle |
| `CACHE_TRANSLATIONS` | `true` | ⚠️ Optional | Enable caching |
| `LOG_LEVEL` | `info` | ⚠️ Optional | Logging verbosity |

---

## 🧪 Testing After Setup

### 1. Verify Variables Set
```bash
# After Railway redeploys, check logs for:
✅ All required environment variables are present.
✅ Deepgram configured
✅ Translation service configured
```

### 2. Health Check
```bash
curl https://your-railway-url.up.railway.app/health

# Should return:
{
  "ok": true,
  "service": "PolyGlotMeet Backend",
  "features": {
    "transcription": false,
    "translation": false
  }
}
```

### 3. When Features Enabled
After setting `ENABLE_TRANSCRIPTION=true`:
```bash
# Backend should log:
🎙️ Transcription service initialized
🌍 Translation service initialized
✅ Ready to process meetings
```

---

## 💡 Pro Tips

### Cost Monitoring
```bash
# Monitor Deepgram usage
🔍 Check: https://console.deepgram.com/billing

# You have $200 free credit
# ~34,000 minutes of audio
# About 565 hours
```

### Translation Costs
```bash
# LibreTranslate (Public API)
✅ FREE
⚠️ Rate limited
💡 Consider self-hosting for production

# Alternative: Google Translate
💰 $20 per 1M characters
💡 Better quality, costs more
```

### Performance
```bash
# With caching enabled:
- First translation: ~200ms
- Cached translation: ~5ms
- Cache hit rate: ~70-90%
```

---

## 🚨 Important Notes

### Don't Enable Features Yet!
Keep `ENABLE_TRANSCRIPTION=false` until:
1. ✅ Database migration completed
2. ✅ Implementation code deployed
3. ✅ Testing completed

### Deployment Won't Break Anything
Even with new dependencies:
- ✅ Existing code unchanged
- ✅ No new routes added yet
- ✅ Features disabled by flags
- ✅ Backwards compatible

---

## 📞 Next Steps After Setting Variables

1. **Set all variables on Railway** ✓
2. **Railway will redeploy** ✓
3. **Run database migration** (Next step)
4. **Implement modules** (When ready)
5. **Enable features** (After testing)

---

## 🎉 Quick Start Command

After variables are set, to test locally:

```bash
cd polgotmeet_backend

# Create .env for local testing
cat > .env << EOF
DEEPGRAM_API_KEY=5d961a2d7f0e92a14ffef0751effe85cd31495f1
TRANSLATION_SERVICE=libretranslate
LIBRETRANSLATE_URL=https://libretranslate.de
ENABLE_TRANSCRIPTION=false
ENABLE_TRANSLATION=false
CACHE_TRANSLATIONS=true
LOG_LEVEL=info
EOF

# Install dependencies
npm install

# Run locally
npm run dev
```

---

**Set these variables on Railway, and you're ready for the next phase!** 🚀

# 🔐 Railway Environment Variables - Quick Setup

## Variables to Add on Railway

### 1️⃣ Deepgram (Speech-to-Text)
```
Name:  DEEPGRAM_API_KEY
Value: 5d961a2d7f0e92a14ffef0751effe85cd31495f1
```

### 2️⃣ Translation Service
```
Name:  TRANSLATION_SERVICE
Value: libretranslate
```

```
Name:  LIBRETRANSLATE_URL
Value: https://libretranslate.de
```

### 3️⃣ Feature Flags (Start Disabled)
```
Name:  ENABLE_TRANSCRIPTION
Value: false
```

```
Name:  ENABLE_TRANSLATION
Value: false
```

```
Name:  CACHE_TRANSLATIONS
Value: true
```

```
Name:  LOG_LEVEL
Value: info
```

---

## 📋 Railway Setup Steps

1. Open Railway dashboard
2. Select your backend project
3. Click "Variables" tab
4. For each variable above:
   - Click "+ New Variable"
   - Enter Name
   - Enter Value
   - Click "Add"
5. Railway will auto-redeploy

---

## ⚠️ Important

- Keep `ENABLE_TRANSCRIPTION=false` for now
- Keep `ENABLE_TRANSLATION=false` for now
- We'll enable them after testing
- Existing features won't be affected

---

## ✅ After Adding Variables

Railway will redeploy automatically.  
Your app continues working normally!

Next: Run database migration in Supabase

---

**Total: 7 new variables to add**

import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import crypto from 'crypto';
import { AccessToken, RoomServiceClient, WebhookReceiver } from 'livekit-server-sdk';
import { createClient } from '@supabase/supabase-js';

// Import transcription modules
import config from './config/env.js';
import { initializeDeepgram, checkDeepgramHealth } from './stt/deepgram.js';
import { startTranscription, stopTranscription, getActiveSessions } from './livekit/agent.js';
import { getUserLanguage, updateUserLanguage } from './db/userSettings.js';
import { getMeetingTranscripts } from './db/transcripts.js';
import logger from './utils/logger.js';

dotenv.config();

// ============================================
// CRITICAL: Error Handlers (Must be first)
// ============================================
process.on('uncaughtException', (error) => {
    console.error('🔥 UNCAUGHT EXCEPTION:', error);
    console.error('Stack:', error.stack);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('🔥 UNHANDLED REJECTION at:', promise);
    console.error('Reason:', reason);
    process.exit(1);
});

console.log('🚀 Starting PolyGlotMeet Backend...');
console.log('📍 Node version:', process.version);
console.log('📍 Working directory:', process.cwd());

const app = express();

// ============================================
// 1. Environment Validation (Fail Fast)
// ============================================
const requiredEnvVars = ['LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET', 'LIVEKIT_URL', 'SUPABASE_URL', 'SUPABASE_SERVICE_KEY'];
const missingVars = requiredEnvVars.filter(v => !process.env[v]);

if (missingVars.length > 0) {
    console.error(`❌ CRITICAL ERROR: Missing environment variables: ${missingVars.join(', ')}`);
    console.error('See README.md for setup instructions.');
    // In production, we might want to hard crash so Railway restarts us with correct vars
    // process.exit(1); 
} else {
    console.log('✅ All required environment variables are present.');
}

// ============================================
// 2. Initialize Clients
// ============================================
let supabase;
let roomService;
let webhookReceiver;

try {
    // Initialize Supabase Client (Service Role)
    if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY) {
        supabase = createClient(
            process.env.SUPABASE_URL,
            process.env.SUPABASE_SERVICE_KEY
        );
        console.log('✅ Supabase Client initialized');
    }

    // Initialize LiveKit Room Service
    if (process.env.LIVEKIT_URL && process.env.LIVEKIT_API_KEY && process.env.LIVEKIT_API_SECRET) {
        roomService = new RoomServiceClient(
            process.env.LIVEKIT_URL,
            process.env.LIVEKIT_API_KEY,
            process.env.LIVEKIT_API_SECRET
        );
        console.log('✅ LiveKit RoomService initialized');
    }

    // Initialize Webhook Receiver
    if (process.env.LIVEKIT_API_KEY && process.env.LIVEKIT_API_SECRET) {
        webhookReceiver = new WebhookReceiver(
            process.env.LIVEKIT_API_KEY,
            process.env.LIVEKIT_API_SECRET
        );
        console.log('✅ LiveKit WebhookReceiver initialized');
    }
} catch (error) {
    console.error("❌ Failed to initialize clients:", error);
}

// CORS Configuration - Permissive for testing (tighten in production)
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
}));

app.use(express.json());

// Railway automatically sets PORT
const PORT = process.env.PORT || 8080;
console.log(`🔌 PORT from Railway: ${process.env.PORT || 'NOT SET (using default 8080)'}`);
console.log(`🔌 Final PORT value: ${PORT}`);

// Logging Middleware
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
});

// ============================================
// LIVEKIT WEBHOOK HANDLER
// ============================================
app.post('/livekit-webhook', async (req, res) => {
    try {
        if (!webhookReceiver) {
            console.warn('Webhook received but receiver not initialized');
            return res.status(500).send('Receiver not initialized');
        }

        const event = await webhookReceiver.receive(req.body, req.get('Authorization'));

        if (event.event === 'room_finished') {
            const roomName = event.room.name;
            console.log(`🏠 Room Finished: ${roomName}. Updating DB...`);

            // Close meeting in DB
            const { error } = await supabase
                .from('meetings')
                .update({
                    is_active: false,
                    ended_at: new Date().toISOString()
                })
                .eq('meeting_code', roomName);

            if (error) console.error('Error closing meeting in DB:', error);
            else console.log(`✅ Meeting ${roomName} marked ended.`);
        }
    } catch (error) {
        console.error('Webhook Error:', error);
    }
    res.status(200).send();
});

// ============================================
// HELPER FUNCTION: Create LiveKit Token
// ============================================
const createLiveKitToken = async (roomName, userId, isHost) => {
    const at = new AccessToken(
        process.env.LIVEKIT_API_KEY,
        process.env.LIVEKIT_API_SECRET,
        {
            identity: userId,
            name: userId,
            ttl: 7200, // 2 hours
        }
    );

    at.addGrant({
        roomJoin: true,
        room: roomName,
        canPublish: true,
        canSubscribe: true,
        canPublishData: true,
        roomAdmin: isHost,
    });

    return await at.toJwt();
};

// ============================================
// ROUTES
// ============================================

// Health Check Endpoint (Required for Railway)
app.get('/health', (req, res) => {
    console.log('🏥 Health check received from:', req.ip);
    res.status(200).json({
        ok: true,
        timestamp: new Date().toISOString(),
        service: 'PolyGlotMeet Backend',
        uptime: process.uptime()
    });
});

// Root Endpoint
app.get('/', (req, res) => {
    res.json({
        message: 'PolyGlotMeet Backend API',
        version: '1.0.0',
        timestamp: new Date().toISOString(),
        endpoints: {
            health: 'GET /health',
            createMeeting: 'POST /create-meeting',
            joinMeeting: 'POST /join-meeting',
            endMeeting: 'POST /end-meeting'
        }
    });
});

// POST /create-meeting
app.post('/create-meeting', async (req, res) => {
    // DEBUGGING LOGS
    console.log('🎯 ===== CREATE MEETING CALLED =====');
    console.log('📥 Request body:', JSON.stringify(req.body, null, 2));
    console.log('📥 Headers:', {
        'content-type': req.headers['content-type'],
        'origin': req.headers['origin']
    });

    try {
        const { userId } = req.body;
        console.log('👤 Extracted userId:', userId);

        if (!userId) {
            console.error('❌ userId is missing!');
            return res.status(400).json({ error: "userId required" });
        }

        // 1. Generate IDs
        // Generate UPPERCASE meeting code (ABC-DEF-GHI format)
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        const part1 = Array.from({ length: 3 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
        const part2 = Array.from({ length: 3 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
        const part3 = Array.from({ length: 3 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
        const meetingId = `${part1}-${part2}-${part3}`.toUpperCase();

        // Generate 6-digit numeric password
        const password = Math.floor(100000 + Math.random() * 900000).toString();

        console.log('🎲 Generated meetingId:', meetingId);
        console.log('🔐 Generated password:', password);

        // Canonical Room Name (Single Source of Truth)
        const roomName = `room_${meetingId}_${crypto.randomBytes(4).toString('hex')}`;
        console.log('🏠 Room name:', roomName);

        // 2. Store in Supabase
        console.log('💾 Attempting to store in Supabase...');
        const { error } = await supabase
            .from('meetings')
            .insert({
                meeting_code: meetingId,
                password: password,
                livekit_room: roomName,
                host_id: userId,
                is_active: true
            });

        if (error) {
            console.error('❌ Supabase error:', error);
            throw error;
        }
        console.log('✅ Supabase insert successful');

        // 3. Generate Host Token
        console.log('🔑 Generating LiveKit token...');
        const token = await createLiveKitToken(roomName, userId, true);
        console.log('✅ Token generated successfully');

        const responseData = {
            meetingId,
            password,
            roomName,
            token
        };

        console.log('📤 Sending response:', {
            meetingId,
            password,
            roomName,
            tokenLength: token?.length || 0
        });

        res.json(responseData);
        console.log('✅ ===== CREATE MEETING SUCCESS =====');

    } catch (err) {
        console.error('💥 ===== CREATE MEETING ERROR =====');
        console.error('❌ Error message:', err.message);
        console.error('❌ Error stack:', err.stack);
        console.error('❌ Full error:', err);

        res.status(500).json({
            error: err.message,
            details: 'Check Railway logs for full error'
        });
    }
});


// POST /join-meeting
app.post('/join-meeting', async (req, res) => {
    try {
        const { meetingId, password, userId } = req.body;
        if (!meetingId || !userId) return res.status(400).json({ error: "Missing fields" });

        // 1. Fetch Meeting from Supabase
        const { data: meeting, error } = await supabase
            .from('meetings')
            .select('*')
            .eq('meeting_code', meetingId)
            .eq('is_active', true)
            .single();

        if (error || !meeting) {
            return res.status(404).json({ error: "Meeting not found or inactive" });
        }

        // 2. Validate Password (unless user is host)
        if (meeting.password !== password && meeting.host_id !== userId) {
            return res.status(403).json({ error: "Invalid password" });
        }

        // 3. Generate Token for the SAME room
        const isHost = meeting.host_id === userId;
        const token = await createLiveKitToken(meeting.livekit_room, userId, isHost);

        res.json({
            token,
            isHost
        });

    } catch (err) {
        console.error("Join Meeting Error:", err);
        res.status(500).json({ error: err.message });
    }
});

// POST /end-meeting
app.post('/end-meeting', async (req, res) => {
    try {
        const { meetingId, userId } = req.body;

        // 1. Verify Host Authority
        const { data: meeting } = await supabase
            .from('meetings')
            .select('*')
            .eq('meeting_code', meetingId)
            .single();

        if (!meeting || meeting.host_id !== userId) {
            return res.status(403).json({ error: "Not authorized" });
        }

        // 2. Kill LiveKit Room
        try {
            await roomService.deleteRoom(meeting.livekit_room);
        } catch (e) {
            console.warn("Room already closed or not found in LiveKit");
        }

        // 3. Delete from Supabase
        await supabase
            .from('meetings')
            .delete()
            .eq('meeting_code', meetingId);

        res.json({ success: true });

    } catch (err) {
        console.error("End Meeting Error:", err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================
// ENHANCED ENDPOINTS
// ============================================

// POST /create-meeting-with-details
app.post('/create-meeting-with-details', async (req, res) => {
    console.log('🎯 ===== CREATE MEETING WITH DETAILS =====');

    try {
        const { userId, meetingName, description } = req.body;

        if (!userId) {
            return res.status(400).json({ error: "userId required" });
        }

        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        const part1 = Array.from({ length: 3 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
        const part2 = Array.from({ length: 3 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
        const part3 = Array.from({ length: 3 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
        const meetingId = `${part1}-${part2}-${part3}`.toUpperCase();
        const password = Math.floor(100000 + Math.random() * 900000).toString();
        const roomName = `room_${meetingId}_${crypto.randomBytes(4).toString('hex')}`;

        const { error } = await supabase
            .from('meetings')
            .insert({
                meeting_code: meetingId,
                meeting_name: meetingName || 'Untitled Meeting',
                description: description || null,
                password: password,
                livekit_room: roomName,
                host_id: userId,
                is_active: true,
                started_at: new Date().toISOString()
            });

        if (error) throw error;

        const token = await createLiveKitToken(roomName, userId, true);

        res.json({
            meetingId,
            password,
            roomName,
            token,
            meetingName: meetingName || 'Untitled Meeting'
        });

    } catch (err) {
        console.error('Create meeting error:', err);
        res.status(500).json({ error: err.message });
    }
});

// POST /join-meeting-track
app.post('/join-meeting-track', async (req, res) => {
    try {
        const { meetingId, password, userId, userName } = req.body;

        const { data: meeting, error } = await supabase
            .from('meetings')
            .select('*')
            .eq('meeting_code', meetingId)
            .eq('is_active', true)
            .single();

        if (error || !meeting) {
            return res.status(404).json({ error: "Meeting not found" });
        }

        const isHost = meeting.host_id === userId;
        if (meeting.password !== password && !isHost) {
            return res.status(403).json({ error: "Invalid password" });
        }

        const { data: participant } = await supabase
            .from('meeting_participants')
            .insert({
                meeting_id: meetingId,
                user_id: userId,
                user_name: userName || 'Guest',
                is_host: isHost,
                joined_at: new Date().toISOString()
            })
            .select()
            .single();

        const token = await createLiveKitToken(meeting.livekit_room, userId, isHost);

        res.json({
            token,
            isHost,
            participantId: participant.id
        });

    } catch (err) {
        console.error("Join meeting error:", err);
        res.status(500).json({ error: err.message });
    }
});

// POST /save-transcript
app.post('/save-transcript', async (req, res) => {
    try {
        const { meetingId, participantId, speakerName, originalText, translatedText, languageCode, timestampSeconds } = req.body;

        await supabase
            .from('meeting_transcripts')
            .insert({
                meeting_id: meetingId,
                participant_id: participantId,
                speaker_name: speakerName,
                original_text: originalText,
                translated_text: translatedText,
                language_code: languageCode,
                timestamp_seconds: timestampSeconds
            });

        res.json({ success: true });
    } catch (err) {
        console.error("Save transcript error:", err);
        res.status(500).json({ error: err.message });
    }
});

// GET /meeting-history/:userId
app.get('/meeting-history/:userId', async (req, res) => {
    try {
        const { userId } = req.params;

        const { data: meetings } = await supabase
            .from('meetings')
            .select('*')
            .eq('host_id', userId)
            .order('created_at', { ascending: false });

        res.json({ meetings });
    } catch (err) {
        console.error("Meeting history error:", err);
        res.status(500).json({ error: err.message });
    }
});

// GET /meeting-details/:meetingId
app.get('/meeting-details/:meetingId', async (req, res) => {
    try {
        const { meetingId } = req.params;

        const { data: meeting } = await supabase
            .from('meetings')
            .select('*')
            .eq('meeting_code', meetingId)
            .single();

        const { data: participants } = await supabase
            .from('meeting_participants')
            .select('*')
            .eq('meeting_id', meetingId);

        const { data: transcripts } = await supabase
            .from('meeting_transcripts')
            .select('*')
            .eq('meeting_id', meetingId)
            .order('timestamp_seconds', { ascending: true });

        res.json({
            meeting,
            participants,
            transcripts
        });
    } catch (err) {
        console.error("Meeting details error:", err);
        res.status(500).json({ error: err.message });
    }
});

// 404 Handler
app.use((req, res) => {
    res.status(404).json({ error: 'Endpoint not found' });
});

// Error Handler
// ============================================
// END MEETING FOR ALL
// ============================================
app.post('/end-meeting', async (req, res) => {
    try {
        const { meetingId, userId, durationMinutes } = req.body;
        console.log(`[POST] /end-meeting - Meeting: ${meetingId} by User: ${userId}, Duration: ${durationMinutes} min`);

        if (!meetingId || !userId) {
            return res.status(400).json({ error: 'Missing meetingId or userId' });
        }

        // 1. Check if user is host
        const { data: meeting, error: fetchError } = await supabase
            .from('meetings')
            .select('host_id, meeting_code, livekit_room')
            .or(`meeting_code.eq.${meetingId},id.eq.${meetingId}`)
            .single();

        if (fetchError || !meeting) {
            console.error('Error fetching meeting:', fetchError);
            return res.status(404).json({ error: 'Meeting not found' });
        }

        if (meeting.host_id !== userId) {
            return res.status(403).json({ error: 'Only the host can end the meeting for everyone' });
        }

        // 2. End room in LiveKit (disconnects everyone)
        if (roomService) {
            try {
                // Use the livekit_room name from database
                await roomService.deleteRoom(meeting.livekit_room);
                console.log(`✅ LiveKit room ${meeting.livekit_room} deleted`);
            } catch (lkError) {
                console.warn('LiveKit delete room warning (room might be empty/closed):', lkError.message);
            }
        }

        // 3. Update Supabase with duration
        const updateData = {
            is_active: false,
            ended_at: new Date().toISOString()
        };

        if (durationMinutes !== undefined && durationMinutes !== null) {
            updateData.duration_minutes = durationMinutes;
        }

        const { error: updateError } = await supabase
            .from('meetings')
            .update(updateData)
            .eq('meeting_code', meeting.meeting_code);

        if (updateError) {
            throw updateError;
        }

        console.log(`✅ Meeting ${meetingId} ended. Duration: ${durationMinutes} minutes`);

        return res.json({
            success: true,
            message: 'Meeting ended for all',
            durationMinutes
        });

    } catch (error) {
        console.error('Error ending meeting:', error);
        return res.status(500).json({ error: 'Internal server error', details: error.message });
    }
});

// ============================================
// END MEETING DUE TO INACTIVITY
// ============================================
app.post('/end-meeting-inactivity', async (req, res) => {
    try {
        const { meetingId, userId, durationMinutes, reason } = req.body;
        console.log(`[POST] /end-meeting-inactivity - Meeting: ${meetingId}, Reason: ${reason}, Duration: ${durationMinutes} min`);

        if (!meetingId || !userId) {
            return res.status(400).json({ error: 'Missing meetingId or userId' });
        }

        // 1. Get meeting details
        const { data: meeting, error: fetchError } = await supabase
            .from('meetings')
            .select('host_id, meeting_code, livekit_room')
            .or(`meeting_code.eq.${meetingId},id.eq.${meetingId}`)
            .single();

        if (fetchError || !meeting) {
            console.error('Error fetching meeting:', fetchError);
            return res.status(404).json({ error: 'Meeting not found' });
        }

        // Only host can trigger inactivity end
        if (meeting.host_id !== userId) {
            return res.status(403).json({ error: 'Not authorized' });
        }

        // 2. Delete LiveKit room
        if (roomService) {
            try {
                await roomService.deleteRoom(meeting.livekit_room);
                console.log(`✅ LiveKit room ${meeting.livekit_room} deleted due to inactivity`);
            } catch (lkError) {
                console.warn('LiveKit delete room warning:', lkError.message);
            }
        }

        // 3. Update database
        const { error: updateError } = await supabase
            .from('meetings')
            .update({
                is_active: false,
                ended_at: new Date().toISOString(),
                duration_minutes: durationMinutes || 0,
                end_reason: reason || 'inactivity'
            })
            .eq('meeting_code', meeting.meeting_code);

        if (updateError) {
            throw updateError;
        }

        console.log(`✅ Meeting ${meetingId} auto-ended due to ${reason}. Duration: ${durationMinutes} minutes`);

        return res.json({
            success: true,
            message: 'Meeting ended due to inactivity',
            reason,
            durationMinutes
        });

    } catch (error) {
        console.error('Error ending meeting due to inactivity:', error);
        return res.status(500).json({ error: 'Internal server error', details: error.message });
    }
});

// ============================================
// TRANSCRIPTION & TRANSLATION ENDPOINTS
// ============================================

// Initialize Deepgram on startup
if (config.features.transcription) {
    const deepgramReady = initializeDeepgram();
    if (deepgramReady) {
        console.log('✅ Deepgram initialized');
    } else {
        console.warn('⚠️ Deepgram not ready - transcription disabled');
    }
}

// Start transcription for a meeting
app.post('/start-transcription/:meetingId', async (req, res) => {
    try {
        const { meetingId } = req.params;
        const { userId } = req.body;

        if (!config.features.transcription) {
            return res.status(400).json({ error: 'Transcription feature disabled' });
        }

        // Get meeting details
        const { data: meeting, error: fetchError } = await supabase
            .from('meetings')
            .select('livekit_room, host_id')
            .or(`meeting_code.eq.${meetingId},id.eq.${meetingId}`)
            .single();

        if (fetchError || !meeting) {
            return res.status(404).json({ error: 'Meeting not found' });
        }

        // Generate bot token
        const botToken = new AccessToken(
            process.env.LIVEKIT_API_KEY,
            process.env.LIVEKIT_API_SECRET,
            {
                identity: `bot_${meetingId}`,
                name: 'Transcription Bot',
            }
        );

        botToken.addGrant({
            room: meeting.livekit_room,
            roomJoin: true,
            canPublish: true,
            canPublishData: true,
        });

        const token = botToken.toJwt();

        // Start transcription
        const result = await startTranscription(meetingId, meeting.livekit_room, token);

        if (result.success) {
            logger.info('Transcription started', { meetingId, userId });
            return res.json(result);
        } else {
            return res.status(500).json(result);
        }

    } catch (error) {
        logger.error('Error starting transcription', { error: error.message });
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// Stop transcription for a meeting
app.post('/stop-transcription/:meetingId', async (req, res) => {
    try {
        const { meetingId } = req.params;

        const result = await stopTranscription(meetingId);

        if (result.success) {
            logger.info('Transcription stopped', { meetingId });
            return res.json(result);
        } else {
            return res.status(404).json(result);
        }

    } catch (error) {
        logger.error('Error stopping transcription', { error: error.message });
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// Get meeting transcripts
app.get('/meeting-transcripts/:meetingId', async (req, res) => {
    try {
        const { meetingId } = req.params;

        const transcripts = await getMeetingTranscripts(meetingId);

        return res.json({
            meetingId,
            count: transcripts.length,
            transcripts
        });

    } catch (error) {
        logger.error('Error getting transcripts', { error: error.message });
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// Get user language preference
app.get('/user-settings/:userId', async (req, res) => {
    try {
        const { userId } = req.params;

        const language = await getUserLanguage(userId);

        return res.json({
            userId,
            preferredLanguage: language
        });

    } catch (error) {
        logger.error('Error getting user settings', { error: error.message });
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// Update user language preference
app.put('/user-settings/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const { language } = req.body;

        if (!language) {
            return res.status(400).json({ error: 'Language required' });
        }

        const success = await updateUserLanguage(userId, language);

        if (success) {
            return res.json({ success: true, language });
        } else {
            return res.status(500).json({ error: 'Failed to update language' });
        }

    } catch (error) {
        logger.error('Error updating user settings', { error: error.message });
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// Get active transcription sessions
app.get('/transcription-sessions', async (req, res) => {
    try {
        const sessions = getActiveSessions();

        return res.json({
            count: sessions.length,
            sessions
        });

    } catch (error) {
        logger.error('Error getting sessions', { error: error.message });
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// Update health check to include transcription status
app.get('/health', async (req, res) => {
    try {
        const health = {
            ok: true,
            service: 'PolyGlotMeet Backend',
            uptime: process.uptime(),
            timestamp: new Date().toISOString(),
            features: {
                transcription: config.features.transcription,
                translation: config.features.translation,
            }
        };

        if (config.features.transcription) {
            const deepgramHealth = await checkDeepgramHealth();
            health.deepgram = deepgramHealth;
        }

        res.json(health);
    } catch (error) {
        res.status(500).json({ ok: false, error: error.message });
    }
});


app.use((err, req, res, next) => {
    console.error('Server Error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

// Start Server - MUST bind to 0.0.0.0 for Railway
const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Backend Authority Server running on port ${PORT}`);
    console.log(`✅ Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`✅ LiveKit URL: ${process.env.LIVEKIT_URL || 'NOT SET'}`);
    console.log(`✅ Supabase URL: ${process.env.SUPABASE_URL || 'NOT SET'}`);
});

// Keep server alive and handle graceful shutdown
server.keepAliveTimeout = 120000; // 120 seconds
server.headersTimeout = 120000;

process.on('SIGTERM', () => {
    console.log('🛑 SIGTERM received, closing server gracefully...');
    server.close(() => {
        console.log('✅ Server closed gracefully');
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    console.log('🛑 SIGINT received, closing server gracefully...');
    server.close(() => {
        console.log('✅ Server closed gracefully');
        process.exit(0);
    });
});

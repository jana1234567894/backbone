import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import crypto from 'crypto';
import { AccessToken, RoomServiceClient } from 'livekit-server-sdk';
import { createClient } from '@supabase/supabase-js';

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

// 404 Handler
app.use((req, res) => {
    res.status(404).json({ error: 'Endpoint not found' });
});

// Error Handler
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

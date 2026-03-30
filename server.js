require('dotenv').config(); 
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcryptjs'); 

const app = express();
const server = http.createServer(app);
const io = new Server(server, { 
    cors: { origin: "*", methods: ["GET", "POST"] } 
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 VAULT SERVER ACTIVE ON PORT ${PORT}`);
});

app.use(express.json({ limit: '50mb' }));
app.use(cors());
app.use(express.static(path.join(__dirname)));

// --- MONGODB ---
const MONGO_URI = "mongodb+srv://olakojotobi89_db_user:VaultPass2026@cluster0.fuesl9b.mongodb.net/vaultDB?retryWrites=true&w=majority";
mongoose.connect(MONGO_URI).then(() => console.log("🚀 DATABASE CONNECTED")).catch(err => console.log(err));

// --- SCHEMAS ---
const User = mongoose.model('User', new mongoose.Schema({
    username: { type: String, unique: true, required: true, index: true },
    password: { type: String, required: true },
    profilePic: String, // Added for Edit Profile
    bio: { type: String, default: "Welcome to my vault." },
    followers: [{ type: String }], // Simplified for easier follow checks
    following: [{ type: String }]
}));

const Message = mongoose.model('Message', new mongoose.Schema({
    sender: { type: String, required: true, index: true },
    receiver: { type: String, required: true, index: true },
    content: { type: String, required: true },
    type: { type: String, default: 'text' }, // 'text', 'voice', 'image'
    duration: String, // For Voice Notes
    timestamp: { type: Date, default: Date.now },
    seen: { type: Boolean, default: false }
}));

// --- API ROUTES ---

// UPDATE PROFILE
app.post('/api/update-profile', async (req, res) => {
    try {
        const { username, bio, profilePic } = req.body;
        await User.findOneAndUpdate({ username }, { bio, profilePic });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE MESSAGE (Active)
app.post('/api/delete-message', async (req, res) => {
    try {
        const { messageId, username } = req.body;
        const msg = await Message.findById(messageId);
        if (msg.sender === username) {
            await Message.findByIdAndDelete(messageId);
            res.json({ success: true });
        } else {
            res.status(403).json({ error: "Unauthorized" });
        }
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET PROFILE (Required for profile.html)
app.get('/api/profile/:username', async (req, res) => {
    try {
        const user = await User.findOne({ username: req.params.username });
        if (!user) return res.status(404).json({ error: "User not found" });
        res.json(user);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// (Existing signup/login/search/posts routes stay here...)
app.post('/api/signup', async (req, res) => { try { const hashedPassword = await bcrypt.hash(req.body.password, 10); await User.create({ ...req.body, password: hashedPassword }); res.json({ success: true }); } catch (err) { res.status(400).json({ error: err.message }); }});
app.post('/api/login', async (req, res) => { try { const user = await User.findOne({ username: req.body.username }); if (user && await bcrypt.compare(req.body.password, user.password)) { res.json({ message: "Access Granted", username: user.username }); } else { res.status(401).json({ error: "Invalid" }); } } catch (err) { res.status(500).json({ error: err.message }); }});

// --- SOCKET LOGIC (CALLING & VOICE) ---
io.on('connection', (socket) => {
    socket.on('join_private', (username) => socket.join(username));
    
    // Send Message (Text/Voice)
    socket.on('send_message', async (data) => {
        try {
            const newMessage = await Message.create(data);
            io.to(data.receiver).emit('receive_message', newMessage);
            io.to(data.sender).emit('receive_message', newMessage);
        } catch (err) { console.error(err); }
    });

    // RTC CALLING HANDSHAKE
    socket.on('call_user', (data) => {
        // data contains: { userToCall, signalData, from, type: 'video'/'audio' }
        io.to(data.userToCall).emit('incoming_call', {
            signal: data.signalData,
            from: data.from,
            type: data.type
        });
    });

    socket.on('answer_call', (data) => {
        io.to(data.to).emit('call_accepted', data.signal);
    });

    socket.on('end_call', (data) => {
        io.to(data.to).emit('call_ended');
    });

    // DELETE MESSAGE SOCKET (To remove it from UI instantly)
    socket.on('message_deleted', (data) => {
        io.to(data.receiver).emit('remove_message_from_ui', data.messageId);
    });
});
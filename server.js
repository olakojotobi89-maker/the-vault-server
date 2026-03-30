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
    profilePic: String,
    bio: { type: String, default: "Welcome to my vault." },
    followers: [{ type: String }],
    following: [{ type: String }],
    blockedUsers: [{ type: String }] // Added to track blocked users
}));

const Message = mongoose.model('Message', new mongoose.Schema({
    sender: { type: String, required: true, index: true },
    receiver: { type: String, required: true, index: true },
    content: { type: String, required: true },
    type: { type: String, default: 'text' }, // 'text', 'voice', 'image'
    duration: String,
    timestamp: { type: Date, default: Date.now }, // No "expires" field = Stored Forever
    seen: { type: Boolean, default: false }
}));

// --- API ROUTES ---

// BLOCK/UNBLOCK LOGIC
app.post('/api/block-user', async (req, res) => {
    try {
        const { myUsername, targetUsername } = req.body;
        const user = await User.findOne({ username: myUsername });
        
        let isNowBlocked = false;
        if (user.blockedUsers.includes(targetUsername)) {
            await User.findOneAndUpdate({ username: myUsername }, { $pull: { blockedUsers: targetUsername } });
        } else {
            await User.findOneAndUpdate({ username: myUsername }, { $addToSet: { blockedUsers: targetUsername } });
            isNowBlocked = true;
        }
        res.json({ success: true, isBlocked: isNowBlocked });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE MESSAGE (Permanent Deletion)
app.post('/api/delete-message', async (req, res) => {
    try {
        const { messageId, username } = req.body;
        await Message.findOneAndDelete({ _id: messageId, sender: username });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET CHAT HISTORY (Infinite Scroll Ready)
app.get('/api/chat/:user1/:user2', async (req, res) => {
    try {
        const { user1, user2 } = req.params;
        const messages = await Message.find({
            $or: [{ sender: user1, receiver: user2 }, { sender: user2, receiver: user1 }]
        }).sort({ timestamp: 1 });
        res.json(messages);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/profile/:username', async (req, res) => {
    try {
        const user = await User.findOne({ username: req.params.username });
        res.json(user);
    } catch (err) { res.status(500).json({ error: "Profile error" }); }
});

// SIGNUP & LOGIN
app.post('/api/signup', async (req, res) => {
    try {
        const hashedPassword = await bcrypt.hash(req.body.password, 10);
        await User.create({ ...req.body, password: hashedPassword });
        res.json({ success: true });
    } catch (err) { res.status(400).json({ error: "User exists" }); }
});

app.post('/api/login', async (req, res) => {
    try {
        const user = await User.findOne({ username: req.body.username });
        if (user && await bcrypt.compare(req.body.password, user.password)) {
            res.json({ message: "Access Granted", username: user.username });
        } else { res.status(401).json({ error: "Invalid" }); }
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- SOCKET LOGIC ---
io.on('connection', (socket) => {
    socket.on('join_private', (username) => socket.join(username));
    
    socket.on('send_message', async (data) => {
        try {
            // Check if receiver has blocked sender before delivering
            const receiverDoc = await User.findOne({ username: data.receiver });
            if (receiverDoc && receiverDoc.blockedUsers.includes(data.sender)) {
                return; // Silent fail for blocked senders
            }

            const newMessage = await Message.create(data);
            io.to(data.receiver).emit('receive_message', newMessage);
            io.to(data.sender).emit('receive_message', newMessage);
        } catch (err) { console.error(err); }
    });

    socket.on('call_user', (data) => io.to(data.userToCall).emit('incoming_call', data));
    socket.on('answer_call', (data) => io.to(data.to).emit('call_accepted', data.signal));
});
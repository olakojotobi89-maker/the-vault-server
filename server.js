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

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(cors());

// --- RENDER ROUTING ---
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/home.html', (req, res) => res.sendFile(path.join(__dirname, 'home.html')));
app.get('/notification.html', (req, res) => res.sendFile(path.join(__dirname, 'notification.html')));
app.get('/search.html', (req, res) => res.sendFile(path.join(__dirname, 'search.html')));
app.get('/chat.html', (req, res) => res.sendFile(path.join(__dirname, 'chat.html')));
app.get('/direct.html', (req, res) => res.sendFile(path.join(__dirname, 'direct.html')));
app.use(express.static(path.join(__dirname)));

const MONGO_URI = "mongodb+srv://olakojotobi89_db_user:VaultPass2026@cluster0.fuesl9b.mongodb.net/vaultDB?retryWrites=true&w=majority";
mongoose.connect(MONGO_URI).then(() => console.log("🚀 DATABASE CONNECTED")).catch(err => console.log(err));

// --- SCHEMAS ---
const User = mongoose.model('User', new mongoose.Schema({
    username: { type: String, unique: true, required: true, index: true },
    password: { type: String, required: true },
    profilePic: { type: String, default: "" }, 
    bio: { type: String, default: "Welcome to my vault." },
    followers: [{ type: String }],
    following: [{ type: String }],
    blockedUsers: [{ type: String }],
    settings: {
        darkMode: { type: Boolean, default: true },
        privateAccount: { type: Boolean, default: false },
        notifications: { type: Boolean, default: true }
    }
}));

const Message = mongoose.model('Message', new mongoose.Schema({
    sender: { type: String, required: true, index: true },
    receiver: { type: String, required: true, index: true },
    content: { type: String, required: true },
    type: { type: String, default: 'text' }, 
    timestamp: { type: Date, default: Date.now },
    seen: { type: Boolean, default: false }
}));

const Notification = mongoose.model('Notification', new mongoose.Schema({
    toUser: { type: String, required: true, index: true },
    fromUser: { type: String, required: true },
    type: { type: String, required: true }, 
    timestamp: { type: Date, default: Date.now },
    read: { type: Boolean, default: false }
}));

// --- NEW CHAT LOGIC ROUTES ---

// 1. Get TOTAL unread count for Home Page Badge
app.get('/api/unread-messages-count/:username', async (req, res) => {
    try {
        const count = await Message.countDocuments({ receiver: req.params.username, seen: false });
        res.json({ count });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 2. Get Chat List with individual unread counts
app.get('/api/chat-list/:username', async (req, res) => {
    try {
        const username = req.params.username;
        const messages = await Message.find({
            $or: [{ sender: username }, { receiver: username }]
        }).sort({ timestamp: -1 });

        const partners = new Set();
        messages.forEach(msg => {
            if (msg.sender !== username) partners.add(msg.sender);
            if (msg.receiver !== username) partners.add(msg.receiver);
        });

        const users = await User.find({ username: { $in: Array.from(partners) } }).select('username profilePic');
        
        const chatList = await Promise.all(users.map(async (u) => {
            const unreadCount = await Message.countDocuments({
                sender: u.username, receiver: username, seen: false
            });
            return { ...u._doc, unreadCount };
        }));

        res.json(chatList);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 3. Get Messages + Mark as Seen automatically
app.get('/api/messages/:me/:target', async (req, res) => {
    try {
        await Message.updateMany(
            { sender: req.params.target, receiver: req.params.me, seen: false },
            { $set: { seen: true } }
        );
        const msgs = await Message.find({
            $or: [
                { sender: req.params.me, receiver: req.params.target },
                { sender: req.params.target, receiver: req.params.me }
            ]
        }).sort({ timestamp: 1 });
        res.json(msgs);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- EXISTING ROUTES ---
app.get('/api/notifications/:username', async (req, res) => {
    try {
        const unreadOnly = req.query.unread === 'true';
        let filter = { toUser: req.params.username };
        if (unreadOnly) filter.read = false;
        const notifications = await Notification.find(filter).sort({ timestamp: -1 });
        res.json(notifications);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/notifications/read/:username', async (req, res) => {
    try {
        await Notification.updateMany({ toUser: req.params.username, read: false }, { $set: { read: true } });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/login', async (req, res) => {
    try {
        const user = await User.findOne({ username: req.body.username });
        if (user && await bcrypt.compare(req.body.password, user.password)) {
            res.json({ message: "Access Granted", username: user.username, settings: user.settings });
        } else { res.status(401).json({ error: "Invalid credentials" }); }
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- SOCKET LOGIC ---
io.on('connection', (socket) => {
    socket.on('join_private', (username) => socket.join(username));
    socket.on('send_message', async (data) => {
        try {
            const receiverDoc = await User.findOne({ username: data.receiver });
            if (receiverDoc && receiverDoc.blockedUsers.includes(data.sender)) return;
            const newMessage = await Message.create(data);
            io.to(data.receiver).emit('receive_message', newMessage);
            io.to(data.sender).emit('receive_message', newMessage);
            // Notify home badge
            io.to(data.receiver).emit('update_badge'); 
        } catch (err) { console.error(err); }
    });
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 VAULT SERVER ACTIVE ON PORT ${PORT}`);
});
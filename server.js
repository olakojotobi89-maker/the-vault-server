require('dotenv').config(); 
const express = require('express');
const compression = require('compression'); 
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcryptjs'); 

const app = express();

// PERFORMANCE: Gzip compression reduces data transfer by 70%
app.use(compression()); 

const server = http.createServer(app);
const io = new Server(server, { 
    cors: { origin: "*", methods: ["GET", "POST"] },
    transports: ['websocket', 'polling'] 
});

const PORT = process.env.PORT || 3000;

// SPEED: Optimized limits
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));
app.use(cors());

// CACHE: Tell browser to cache assets for 1 year
app.use(express.static(path.join(__dirname), {
    maxAge: '1y',
    setHeaders: (res, path) => {
        if (path.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
    }
}));

const MONGO_URI = "mongodb+srv://olakojotobi89_db_user:VaultPass2026@cluster0.fuesl9b.mongodb.net/vaultDB?retryWrites=true&w=majority";

mongoose.connect(MONGO_URI, {
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 5000,
}).then(() => console.log("🚀 VAULT ENGINE: ONLINE")).catch(err => console.error("DB Error:", err));

// --- SCHEMAS (With High-Speed Indexing) ---
const User = mongoose.model('User', new mongoose.Schema({
    username: { type: String, unique: true, required: true, index: true },
    password: { type: String, required: true },
    profilePic: { type: String, default: "" }, 
    bio: { type: String, default: "Welcome to my vault." },
    followers: [{ type: String, index: true }],
    following: [{ type: String, index: true }],
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
    timestamp: { type: Date, default: Date.now, index: -1 },
    seen: { type: Boolean, default: false }
}));

// --- API ROUTES ---

app.post('/api/login', async (req, res) => {
    try {
        const user = await User.findOne({ username: req.body.username }).lean();
        if (user && await bcrypt.compare(req.body.password, user.password)) {
            res.json({ message: "Access Granted", username: user.username, settings: user.settings });
        } else { res.status(401).json({ error: "Invalid credentials" }); }
    } catch (err) { res.status(500).json({ error: "Auth Error" }); }
});

app.get('/api/messages/:me/:target', async (req, res) => {
    try {
        const msgs = await Message.find({
            $or: [
                { sender: req.params.me, receiver: req.params.target },
                { sender: req.params.target, receiver: req.params.me }
            ]
        }).sort({ timestamp: 1 }).limit(50).lean();
        res.json(msgs);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Explicit routes for your HTML pages
const pages = ['home', 'notification', 'search', 'chat', 'direct', 'profile', 'post-details', 'signup'];
pages.forEach(page => {
    app.get(`/${page}.html`, (req, res) => res.sendFile(path.join(__dirname, `${page}.html`)));
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// --- SOCKET LOGIC ---
io.on('connection', (socket) => {
    socket.on('join_private', (username) => socket.join(username));
    socket.on('send_message', async (data) => {
        try {
            const newMessage = await Message.create(data);
            io.to(data.receiver).emit('receive_message', newMessage);
            io.to(data.sender).emit('receive_message', newMessage);
        } catch (err) { console.error(err); }
    });
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 TURBO VAULT ACTIVE ON PORT ${PORT}`);
});
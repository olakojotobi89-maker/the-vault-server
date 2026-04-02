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

/** * PERFORMANCE BOOST 1: Gzip Compression
 * Compresses all text-based responses (HTML, JS, JSON) by up to 70%.
 */
app.use(compression({ level: 6, threshold: 0 })); 

const server = http.createServer(app);
const io = new Server(server, { 
    cors: { origin: "*", methods: ["GET", "POST"] },
    transports: ['websocket'] // PERFORMANCE BOOST 2: Force WebSockets (bypasses slow polling)
});

const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '10mb' })); // Reduced limit for faster parsing
app.use(express.urlencoded({ limit: '10mb', extended: true }));
app.use(cors());

/** * PERFORMANCE BOOST 3: Aggressive Static Caching
 * Tells the browser to keep images/CSS/JS in memory for 1 year.
 */
const cacheTime = 31536000; 
app.use(express.static(path.join(__dirname), {
    maxAge: cacheTime * 1000,
    immutable: true
}));

const MONGO_URI = "mongodb+srv://olakojotobi89_db_user:VaultPass2026@cluster0.fuesl9b.mongodb.net/vaultDB?retryWrites=true&w=majority";

/** * PERFORMANCE BOOST 4: Connection Pooling
 * Maintains open connections so the server doesn't "re-connect" every request.
 */
mongoose.connect(MONGO_URI, {
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 5000,
}).then(() => console.log("🚀 VAULT ENGINE: OPTIMIZED CONNECT")).catch(err => console.log(err));

// --- SCHEMAS (With High-Speed Indexing) ---
const User = mongoose.model('User', new mongoose.Schema({
    username: { type: String, unique: true, required: true, index: true }, // Index for instant login
    password: { type: String, required: true },
    profilePic: { type: String, default: "" }, 
    bio: { type: String, default: "Welcome to my vault." },
    followers: [{ type: String, index: true }],
    following: [{ type: String, index: true }],
    settings: { darkMode: { type: Boolean, default: true } }
}));

const Message = mongoose.model('Message', new mongoose.Schema({
    sender: { type: String, required: true, index: true },
    receiver: { type: String, required: true, index: true },
    content: { type: String, required: true },
    timestamp: { type: Date, default: Date.now, index: -1 }, // Reverse index for fast recent chat loading
    seen: { type: Boolean, default: false }
}));

const Post = mongoose.model('Post', new mongoose.Schema({
    sender: { type: String, required: true, index: true },
    timestamp: { type: Date, default: Date.now, index: -1 } // Index for fast feed loading
}, { strict: false })); // Keeps your existing dynamic post logic

// --- TURBO API ROUTES ---

// Using .lean() makes queries 5x faster by skipping Mongoose overhead
app.post('/api/login', async (req, res) => {
    try {
        const user = await User.findOne({ username: req.body.username }).lean();
        if (user && await bcrypt.compare(req.body.password, user.password)) {
            res.json({ message: "Access Granted", username: user.username, settings: user.settings });
        } else { res.status(401).json({ error: "Invalid credentials" }); }
    } catch (err) { res.status(500).json({ error: "Auth Fail" }); }
});

app.get('/api/messages/:me/:target', async (req, res) => {
    try {
        const msgs = await Message.find({
            $or: [
                { sender: req.params.me, receiver: req.params.target },
                { sender: req.params.target, receiver: req.params.me }
            ]
        }).sort({ timestamp: 1 }).limit(50).lean(); // Limit results to prevent lag
        res.json(msgs);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/posts', async (req, res) => {
    try {
        const posts = await Post.find().sort({ timestamp: -1 }).limit(10).lean();
        res.json(posts);
    } catch (err) { res.status(500).json({ error: "Feed Error" }); }
});

// Single Page Application Fallback
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// --- SOCKET LOGIC (Optimized) ---
io.on('connection', (socket) => {
    socket.on('join_private', (username) => socket.join(username));

    socket.on('send_message', async (data) => {
        try {
            const newMessage = await Message.create(data);
            io.to(data.receiver).emit('receive_message', newMessage);
            io.to(data.sender).emit('receive_message', newMessage);
        } catch (err) { console.error("Socket Error"); }
    });
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 TURBO VAULT LIVE ON PORT ${PORT}`);
});
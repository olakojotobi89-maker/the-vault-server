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
app.use(compression()); 

const server = http.createServer(app);
const io = new Server(server, { 
    cors: { origin: "*", methods: ["GET", "POST"] },
    transports: ['websocket', 'polling'] 
});

const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(cors());
app.use(express.static(path.join(__dirname)));

const MONGO_URI = "mongodb+srv://olakojotobi89_db_user:VaultPass2026@cluster0.fuesl9b.mongodb.net/vaultDB?retryWrites=true&w=majority";
mongoose.connect(MONGO_URI)
    .then(() => console.log("🚀 VAULT ENGINE: FULL POWER ACTIVE"))
    .catch(err => console.error("DB Connection Error:", err));

// --- SCHEMAS ---
const User = mongoose.model('User', new mongoose.Schema({
    username: { type: String, unique: true, required: true, index: true },
    password: { type: String, required: true },
    profilePic: { type: String, default: "" }, 
    bio: { type: String, default: "Welcome to my vault." },
    followers: [{ type: String, index: true }],
    following: [{ type: String, index: true }],
    blockedUsers: [{ type: String }],
    settings: {
        darkMode: { type: Boolean, default: true },
        privateAccount: { type: Boolean, default: false },
        notifications: { type: Boolean, default: true }
    }
}));

const Group = mongoose.model('Group', new mongoose.Schema({
    name: { type: String, required: true },
    description: { type: String, default: "A private Vault group." },
    groupPic: { type: String, default: "" },
    admin: { type: String, required: true }, 
    members: [{ type: String, index: true }], 
    isLocked: { type: Boolean, default: false }, 
    timestamp: { type: Date, default: Date.now }
}));

const Post = mongoose.model('Post', new mongoose.Schema({
    sender: { type: String, required: true, index: true },
    senderPfp: { type: String, default: "" },
    caption: String,
    media: String, 
    type: { type: String, default: 'image' }, 
    likedBy: [{ type: String }],
    likes: { type: Number, default: 0 },
    comments: [{ user: String, text: String, date: { type: Date, default: Date.now } }],
    timestamp: { type: Date, default: Date.now, index: -1 }
}));

const Message = mongoose.model('Message', new mongoose.Schema({
    sender: { type: String, required: true, index: true },
    receiver: { type: String, required: true, index: true },
    content: { type: String, required: true },
    type: { type: String, default: 'text' }, 
    timestamp: { type: Date, default: Date.now, index: -1 },
    seen: { type: Boolean, default: false, index: true }
}));

const GroupMessage = mongoose.model('GroupMessage', new mongoose.Schema({
    groupId: { type: mongoose.Schema.Types.ObjectId, ref: 'Group', index: true },
    sender: { type: String, required: true },
    content: { type: String, required: true },
    type: { type: String, default: 'text' },
    timestamp: { type: Date, default: Date.now }
}));

const Notification = mongoose.model('Notification', new mongoose.Schema({
    toUser: { type: String, required: true, index: true },
    fromUser: { type: String, required: true },
    type: { type: String, required: true }, 
    timestamp: { type: Date, default: Date.now, index: -1 },
    read: { type: Boolean, default: false }
}));

// --- API ROUTES ---

app.post('/api/signup', async (req, res) => {
    try {
        const hashedPassword = await bcrypt.hash(req.body.password, 10);
        await User.create({ username: req.body.username, password: hashedPassword });
        res.json({ success: true });
    } catch (err) { res.status(400).json({ error: "Username taken" }); }
});

app.post('/api/login', async (req, res) => {
    try {
        const user = await User.findOne({ username: req.body.username }).lean();
        if (user && await bcrypt.compare(req.body.password, user.password)) {
            res.json({ message: "Access Granted", username: user.username, settings: user.settings });
        } else { res.status(401).json({ error: "Invalid credentials" }); }
    } catch (err) { res.status(500).json({ error: "Server error" }); }
});

app.get('/api/posts', async (req, res) => {
    try {
        const posts = await Post.find().sort({ timestamp: -1 }).limit(20).lean();
        res.json(posts);
    } catch (err) { res.status(500).json({ error: "Error fetching posts" }); }
});

app.post('/api/posts', async (req, res) => {
    try {
        const user = await User.findOne({ username: req.body.sender }).select('profilePic').lean();
        const post = await Post.create({ ...req.body, senderPfp: user ? user.profilePic : "" });
        res.json(post);
    } catch (err) { res.status(500).json({ error: "Post creation failed" }); }
});

app.get('/api/profile/:username', async (req, res) => {
    try {
        const user = await User.findOne({ username: req.params.username }).select('-password').lean();
        if (!user) return res.status(404).json({ error: "User not found" });
        res.json(user);
    } catch (err) { res.status(500).json({ error: "Profile error" }); }
});

app.get('/api/notifications/:username', async (req, res) => {
    try {
        const notifs = await Notification.find({ toUser: req.params.username }).sort({ timestamp: -1 }).limit(20).lean();
        res.json(notifs);
    } catch (err) { res.status(500).json({ error: "Notif error" }); }
});

app.get('/api/chat-list/:username', async (req, res) => {
    try {
        const username = req.params.username;
        const messages = await Message.find({ $or: [{ sender: username }, { receiver: username }] }).sort({ timestamp: -1 }).lean();
        const partners = [...new Set(messages.map(m => m.sender === username ? m.receiver : m.sender))];
        const users = await User.find({ username: { $in: partners } }).select('username profilePic').lean();
        res.json(users.map(u => ({ ...u, type: 'private' })));
    } catch (err) { res.status(500).json({ error: "Chat list error" }); }
});

// HTML Routing - Robust catch-all
app.get('/:page.html', (req, res) => {
    res.sendFile(path.join(__dirname, req.params.page + '.html'), (err) => {
        if (err) res.status(404).sendFile(path.join(__dirname, 'index.html'));
    });
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// --- SOCKET LOGIC ---
io.on('connection', (socket) => {
    socket.on('join_private', (u) => socket.join(u));
    socket.on('join_group', (id) => socket.join(id));

    socket.on('send_message', async (data) => {
        try {
            const msg = await Message.create(data);
            io.to(data.receiver).emit('receive_message', msg);
            io.to(data.sender).emit('receive_message', msg);
        } catch (e) { console.error(e); }
    });
});

server.listen(PORT, '0.0.0.0', () => console.log(`🚀 TURBO VAULT: PORT ${PORT}`));
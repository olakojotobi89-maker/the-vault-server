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

// INCREASE LIMIT: Crucial for permanent Base64 Profile Pictures and Posts
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(cors());
app.use(express.static(path.join(__dirname)));

// --- MONGODB ---
const MONGO_URI = "mongodb+srv://olakojotobi89_db_user:VaultPass2026@cluster0.fuesl9b.mongodb.net/vaultDB?retryWrites=true&w=majority";
mongoose.connect(MONGO_URI).then(() => console.log("🚀 DATABASE CONNECTED")).catch(err => console.log(err));

// --- SCHEMAS ---
const User = mongoose.model('User', new mongoose.Schema({
    username: { type: String, unique: true, required: true, index: true },
    password: { type: String, required: true },
    profilePic: { type: String, default: "" }, // Permanent Base64 string
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

const Post = mongoose.model('Post', new mongoose.Schema({
    sender: { type: String, required: true, index: true },
    caption: String,
    media: String, // Permanent Base64 string
    type: { type: String, default: 'image' }, 
    likes: { type: Number, default: 0 },
    comments: [{ user: String, text: String, date: { type: Date, default: Date.now } }],
    timestamp: { type: Date, default: Date.now }
}));

const Message = mongoose.model('Message', new mongoose.Schema({
    sender: { type: String, required: true, index: true },
    receiver: { type: String, required: true, index: true },
    content: { type: String, required: true },
    type: { type: String, default: 'text' }, 
    timestamp: { type: Date, default: Date.now },
    seen: { type: Boolean, default: false }
}));

// --- API ROUTES ---

// POSTS API
app.get('/api/posts', async (req, res) => {
    try {
        const targetUser = req.query.user;
        let query = {};
        if (targetUser) query = { sender: targetUser };
        const posts = await Post.find(query).sort({ timestamp: -1 }).limit(50);
        res.json(posts);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/posts', async (req, res) => {
    try {
        const newPost = await Post.create(req.body);
        res.json({ success: true, post: newPost });
    } catch (err) { res.status(500).json({ error: "Post failed. Image might be too large." }); }
});

// PROFILE & SETTINGS API
app.post('/api/update-profile', async (req, res) => {
    try {
        const { username, bio, profilePic } = req.body;
        // Updates the user document with the new Bio and permanent Profile Pic
        await User.findOneAndUpdate({ username }, { bio, profilePic }, { new: true });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/update-settings', async (req, res) => {
    try {
        const { username, settings } = req.body;
        await User.findOneAndUpdate({ username }, { settings });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/profile/:username', async (req, res) => {
    try {
        const user = await User.findOne({ username: req.params.username });
        if (!user) return res.status(404).json({ error: "Citizen not found" });
        res.json(user);
    } catch (err) { res.status(500).json({ error: "Profile retrieval error" }); }
});

// SEARCH API (Fixed for empty queries)
app.get('/api/search/:query', async (req, res) => {
    try {
        const searchQuery = req.params.query;
        if (!searchQuery || searchQuery === "undefined") return res.json([]);
        
        const users = await User.find({ 
            username: { $regex: searchQuery, $options: 'i' } 
        }).limit(10).select('username profilePic');
        res.json(users);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// AUTHENTICATION
app.post('/api/signup', async (req, res) => {
    try {
        const hashedPassword = await bcrypt.hash(req.body.password, 10);
        await User.create({ ...req.body, password: hashedPassword });
        res.json({ success: true });
    } catch (err) { res.status(400).json({ error: "User already exists" }); }
});

app.post('/api/login', async (req, res) => {
    try {
        const user = await User.findOne({ username: req.body.username });
        if (user && await bcrypt.compare(req.body.password, user.password)) {
            res.json({ message: "Access Granted", username: user.username, settings: user.settings });
        } else { res.status(401).json({ error: "Invalid Credentials" }); }
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
        } catch (err) { console.error(err); }
    });

    socket.on('send_like', (data) => {
        io.to(data.owner).emit('receive_like', { sender: data.sender, owner: data.owner });
    });
});
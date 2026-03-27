const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
const nodemailer = require('nodemailer');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { 
    cors: { origin: "*", methods: ["GET", "POST"] } 
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// --- MONGODB CONNECTION ---
const MONGO_URI = process.env.MONGO_URI || "mongodb+srv://olakojotobi89_db_user:VaultPass2026@cluster0.fuesl9b.mongodb.net/vaultDB?retryWrites=true&w=majority";

mongoose.connect(MONGO_URI)
    .then(() => console.log("☁️ Connected to MongoDB Cloud!"))
    .catch(err => console.error("❌ MongoDB Connection Error:", err));

// --- DATABASE SCHEMAS ---

const User = mongoose.model('User', new mongoose.Schema({
    username: { type: String, unique: true, required: true },
    password: { type: String, required: true },
    email: String,
    phone: String,
    bio: { type: String, default: "Welcome to my vault." },
    followers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    following: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }]
}));

const Post = mongoose.model('Post', new mongoose.Schema({
    sender: String,
    caption: String,
    media: String, // Base64 string or URL
    type: String,  // 'image' or 'video'
    timestamp: { type: Date, default: Date.now }
}));

const Message = mongoose.model('Message', new mongoose.Schema({
    sender: String,
    content: String,
    timestamp: { type: Date, default: Date.now }
}));

// --- API ROUTES ---

// NEW: Search for Users
app.get('/api/search/:query', async (req, res) => {
    try {
        const query = req.params.query;
        // Finds users starting with the query (case-insensitive)
        const users = await User.find({ 
            username: { $regex: '^' + query, $options: 'i' } 
        }).select('username').limit(5);
        res.json(users);
    } catch (err) {
        res.status(500).json({ error: "Search failed" });
    }
});

// NEW: Save a New Post to Database
app.post('/api/posts', async (req, res) => {
    try {
        const { sender, caption, media, type } = req.body;
        const newPost = new Post({ sender, caption, media, type });
        await newPost.save();
        res.json({ success: true, post: newPost });
    } catch (err) {
        res.status(500).json({ error: "Could not save post" });
    }
});

// NEW: Get All Posts for Feed
app.get('/api/posts', async (req, res) => {
    try {
        const posts = await Post.find().sort({ timestamp: -1 }).limit(20);
        res.json(posts);
    } catch (err) {
        res.status(500).json({ error: "Could not fetch feed" });
    }
});

app.get('/api/profile/:username', async (req, res) => {
    try {
        const user = await User.findOne({ username: req.params.username });
        if (!user) return res.status(404).json({ error: "User not found" });

        const userPosts = await Post.find({ sender: req.params.username }).sort({ timestamp: -1 });

        res.json({
            username: user.username,
            bio: user.bio,
            followersCount: user.followers.length,
            followingCount: user.following.length,
            posts: userPosts,
            followersList: user.followers // For checking follow status
        });
    } catch (err) {
        res.status(500).json({ error: "Server error fetching profile" });
    }
});

app.post('/api/follow', async (req, res) => {
    const { myUsername, targetUsername } = req.body;
    if (myUsername === targetUsername) return res.status(400).json({ error: "You cannot follow yourself" });

    try {
        const me = await User.findOne({ username: myUsername });
        const target = await User.findOne({ username: targetUsername });

        if (!me || !target) return res.status(404).json({ error: "User not found" });

        const isFollowing = me.following.includes(target._id);

        if (isFollowing) {
            me.following.pull(target._id);
            target.followers.pull(me._id);
        } else {
            me.following.push(target._id);
            target.followers.push(me._id);
        }

        await me.save();
        await target.save();

        res.json({ 
            success: true, 
            isFollowingNow: !isFollowing,
            followerCount: target.followers.length 
        });
    } catch (err) {
        res.status(500).json({ error: "Follow action failed" });
    }
});

app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const user = await User.findOne({ username, password });
        if (!user) return res.status(401).json({ error: "Invalid username or password" });
        res.json({ message: "Access Granted", username: user.username });
    } catch (err) { res.status(500).json({ error: "Database error." }); }
});

app.post('/api/signup', async (req, res) => {
    try {
        const { username, password, email, phone } = req.body;
        const newUser = new User({ username, password, email, phone });
        await newUser.save();
        res.json({ message: "Success! Account created." });
    } catch (err) {
        if (err.code === 11000) return res.status(400).json({ error: "Username already taken!" });
        res.status(500).json({ error: "Error creating account." });
    }
});

// Real-time Chat
io.on('connection', (socket) => {
    socket.on('send_message', async (data) => {
        try {
            await Message.create({ sender: data.sender, content: data.content });
            io.emit('receive_message', data);
        } catch (err) { console.error("Socket Error:", err); }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🚀 VAULT SERVER IS ACTIVE ON PORT ${PORT}`);
});
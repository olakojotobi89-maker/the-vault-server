const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { 
    cors: { origin: "*", methods: ["GET", "POST"] } 
});

// Increase limit to handle Base64 images/videos
app.use(express.json({ limit: '50mb' }));
app.use(cors());
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
    media: String, 
    type: String,  
    timestamp: { type: Date, default: Date.now },
    // NEW: Added comments array to the Schema
    comments: [{
        user: String,
        text: String,
        timestamp: { type: Date, default: Date.now }
    }]
}));

const Message = mongoose.model('Message', new mongoose.Schema({
    sender: String,
    content: String,
    timestamp: { type: Date, default: Date.now }
}));

// --- API ROUTES ---

// NEW: Add Comment Route
app.post('/api/posts/:postId/comment', async (req, res) => {
    try {
        const { user, text } = req.body;
        const post = await Post.findById(req.params.postId);
        
        if (!post) return res.status(404).json({ error: "Post not found" });

        post.comments.push({ user, text });
        await post.save();
        
        res.json({ success: true, comments: post.comments });
    } catch (err) {
        res.status(500).json({ error: "Could not add comment" });
    }
});

// Delete Post Route
app.delete('/api/posts/:postId', async (req, res) => {
    try {
        const { username } = req.body; 
        const post = await Post.findById(req.params.postId);

        if (!post) return res.status(404).json({ error: "Post not found" });

        if (post.sender !== username) {
            return res.status(403).json({ error: "Unauthorized" });
        }

        await Post.findByIdAndDelete(req.params.postId);
        res.json({ success: true, message: "Post deleted" });
    } catch (err) {
        res.status(500).json({ error: "Delete failed" });
    }
});

// Search for Users
app.get('/api/search/:query', async (req, res) => {
    try {
        const query = req.params.query;
        const users = await User.find({ 
            username: { $regex: '^' + query, $options: 'i' } 
        }).select('username').limit(5);
        res.json(users);
    } catch (err) {
        res.status(500).json({ error: "Search failed" });
    }
});

// Save Post
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

// Get Feed
app.get('/api/posts', async (req, res) => {
    try {
        const posts = await Post.find().sort({ timestamp: -1 }).limit(20);
        res.json(posts);
    } catch (err) {
        res.status(500).json({ error: "Could not fetch feed" });
    }
});

// Profile Logic
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
            posts: userPosts
        });
    } catch (err) {
        res.status(500).json({ error: "Server error" });
    }
});

// Follow Logic
app.post('/api/follow', async (req, res) => {
    const { myUsername, targetUsername } = req.body;
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
        res.json({ success: true, isFollowingNow: !isFollowing, followerCount: target.followers.length });
    } catch (err) { res.status(500).json({ error: "Follow failed" }); }
});

// Login/Signup
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    const user = await User.findOne({ username, password });
    if (!user) return res.status(401).json({ error: "Access Denied" });
    res.json({ message: "Access Granted", username: user.username });
});

app.post('/api/signup', async (req, res) => {
    try {
        const { username, password, email, phone } = req.body;
        const newUser = new User({ username, password, email, phone });
        await newUser.save();
        res.json({ message: "Success" });
    } catch (err) { res.status(500).json({ error: "Signup failed" }); }
});

// Socket Logic
io.on('connection', (socket) => {
    socket.on('send_message', async (data) => {
        await Message.create({ sender: data.sender, content: data.content });
        io.emit('receive_message', data);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 VAULT SERVER ACTIVE ON PORT ${PORT}`);
});
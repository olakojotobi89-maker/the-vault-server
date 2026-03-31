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

// --- BODY PARSER LIMITS ---
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(cors());

// --- RENDER ROUTING (Fixes "Cannot GET" errors) ---
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/home.html', (req, res) => res.sendFile(path.join(__dirname, 'home.html')));
app.get('/notification.html', (req, res) => res.sendFile(path.join(__dirname, 'notification.html')));
app.get('/search.html', (req, res) => res.sendFile(path.join(__dirname, 'search.html')));
app.use(express.static(path.join(__dirname)));

// --- MONGODB ---
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

const Post = mongoose.model('Post', new mongoose.Schema({
    sender: { type: String, required: true, index: true },
    caption: String,
    media: String, 
    type: { type: String, default: 'image' }, 
    likedBy: [{ type: String }],
    likes: { type: Number, default: 0 },
    comments: [{ 
        user: String, 
        text: String, 
        date: { type: Date, default: Date.now } 
    }],
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

// New Notification Schema to keep history forever
const Notification = mongoose.model('Notification', new mongoose.Schema({
    toUser: { type: String, required: true, index: true },
    fromUser: { type: String, required: true },
    type: { type: String, required: true }, // 'like', 'comment', 'follow'
    timestamp: { type: Date, default: Date.now }
}));

// --- API ROUTES ---

// INSTAGRAM STYLE SEARCH: Finds users by name and returns profile pics
app.get('/api/users/search', async (req, res) => {
    const query = req.query.q;
    if (!query) return res.json([]);
    try {
        const users = await User.find({ 
            username: { $regex: query, $options: 'i' } 
        }).select('username profilePic');
        res.json(users);
    } catch (err) { res.status(500).json({ error: "Search failed" }); }
});

// GET NOTIFICATIONS: Pulls all activity for a specific user
app.get('/api/notifications/:username', async (req, res) => {
    try {
        const notifications = await Notification.find({ toUser: req.params.username }).sort({ timestamp: -1 });
        res.json(notifications);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/follow-status/:me/:target', async (req, res) => {
    try {
        const user = await User.findOne({ username: req.params.me });
        const isFollowing = user.following.includes(req.params.target);
        res.json({ isFollowing });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/follow', async (req, res) => {
    const { follower, target } = req.body; 
    if (follower === target) return res.status(400).json({ error: "Cannot follow yourself" });
    try {
        const targetUser = await User.findOne({ username: target });
        const isFollowing = targetUser.followers.includes(follower);

        if (isFollowing) {
            await User.findOneAndUpdate({ username: target }, { $pull: { followers: follower } });
            await User.findOneAndUpdate({ username: follower }, { $pull: { following: target } });
            res.json({ success: true, action: "unfollowed", isFollowing: false });
        } else {
            await User.findOneAndUpdate({ username: target }, { $push: { followers: follower } });
            await User.findOneAndUpdate({ username: follower }, { $push: { following: target } });
            // Save notification for follow
            await Notification.create({ toUser: target, fromUser: follower, type: 'follow' });
            res.json({ success: true, action: "followed", isFollowing: true });
        }
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/posts', async (req, res) => {
    try {
        const posts = await Post.find().sort({ timestamp: -1 });
        res.json(posts);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/posts', async (req, res) => {
    try {
        const newPost = await Post.create(req.body);
        res.json({ success: true, post: newPost });
    } catch (err) { res.status(500).json({ error: "Post failed" }); }
});

// LIKE ROUTE: Updated to save notification
app.post('/api/posts/:id/like', async (req, res) => {
    try {
        const post = await Post.findById(req.params.id);
        const { username } = req.body;
        if (!post.likedBy.includes(username)) {
            post.likedBy.push(username);
            post.likes += 1;
            await post.save();
            // Only notify if liking someone else's post
            if (post.sender !== username) {
                await Notification.create({ toUser: post.sender, fromUser: username, type: 'like' });
            }
        }
        res.json({ success: true, likes: post.likes });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/profile/:username', async (req, res) => {
    try {
        const user = await User.findOne({ username: req.params.username }).select('-password');
        res.json(user);
    } catch (err) { res.status(500).json({ error: "User not found" }); }
});

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
        } catch (err) { console.error(err); }
    });

    socket.on('send_like', (data) => {
        io.to(data.owner).emit('receive_like', { sender: data.sender, owner: data.owner });
    });
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 VAULT SERVER ACTIVE ON PORT ${PORT}`);
});
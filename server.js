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
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/home', (req, res) => {
    res.sendFile(path.join(__dirname, 'home.html'));
});

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

// --- API ROUTES ---

// NEW: GET CHAT HISTORY (This fixes the "disappearing on refresh" problem)
app.get('/api/messages/:user1/:user2', async (req, res) => {
    try {
        const { user1, user2 } = req.params;
        const history = await Message.find({
            $or: [
                { sender: user1, receiver: user2 },
                { sender: user2, receiver: user1 }
            ]
        }).sort({ timestamp: 1 }); 
        res.json(history);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/posts/:id', async (req, res) => {
    try {
        const post = await Post.findById(req.params.id);
        if (!post) return res.status(404).json({ error: "Post not found" });
        if (post.sender !== req.body.username) return res.status(403).json({ error: "Unauthorized" });
        await Post.findByIdAndDelete(req.params.id);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/follow', async (req, res) => {
    const { follower, target } = req.body; 
    try {
        const targetUser = await User.findOne({ username: target });
        if (targetUser.followers.includes(follower)) {
            await User.findOneAndUpdate({ username: target }, { $pull: { followers: follower } });
            await User.findOneAndUpdate({ username: follower }, { $pull: { following: target } });
            res.json({ success: true, action: "unfollowed" });
        } else {
            await User.findOneAndUpdate({ username: target }, { $push: { followers: follower } });
            await User.findOneAndUpdate({ username: follower }, { $push: { following: target } });
            res.json({ success: true, action: "followed" });
        }
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/update-settings', async (req, res) => {
    try {
        const { username, settings } = req.body;
        await User.findOneAndUpdate({ username }, { settings: settings });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: "Failed update" }); }
});

app.get('/api/posts', async (req, res) => {
    try {
        const posts = await Post.find().sort({ timestamp: -1 }).limit(50);
        res.json(posts);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/posts', async (req, res) => {
    try {
        const newPost = await Post.create(req.body);
        res.json({ success: true, post: newPost });
    } catch (err) { res.status(500).json({ error: "Post failed." }); }
});

app.post('/api/posts/:id/like', async (req, res) => {
    try {
        const post = await Post.findById(req.params.id);
        const hasLiked = post.likedBy.includes(req.body.username);
        if (hasLiked) {
            post.likedBy = post.likedBy.filter(u => u !== req.body.username);
            post.likes = Math.max(0, post.likes - 1);
        } else {
            post.likedBy.push(req.body.username);
            post.likes += 1;
        }
        await post.save();
        res.json({ likes: post.likes, likedBy: post.likedBy });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/search/:query', async (req, res) => {
    try {
        const users = await User.find({ 
            username: { $regex: req.params.query, $options: 'i' } 
        }).limit(10).select('username profilePic');
        res.json(users);
    } catch (err) { res.status(500).json({ error: err.message }); }
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
        } else { res.status(401).json({ error: "Invalid" }); }
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- SOCKET LOGIC ---
io.on('connection', (socket) => {
    // When a user opens the chat, they MUST join their own room to receive messages
    socket.on('join_private', (username) => {
        socket.join(username);
        console.log(`👤 ${username} joined their private vault room.`);
    });
    
    socket.on('send_message', async (data) => {
        try {
            const receiverDoc = await User.findOne({ username: data.receiver });
            if (receiverDoc && receiverDoc.blockedUsers.includes(data.sender)) return;

            // 1. Save to Database first (So it stays forever)
            const newMessage = await Message.create(data);

            // 2. Send to Receiver AND Sender (For multi-device sync)
            io.to(data.receiver).emit('receive_message', newMessage);
            io.to(data.sender).emit('receive_message', newMessage);
            
        } catch (err) { console.error("Chat Error:", err); }
    });

    socket.on('send_like', (data) => {
        io.to(data.owner).emit('receive_like', { sender: data.sender, owner: data.owner });
    });
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 VAULT SERVER ACTIVE ON PORT ${PORT}`);
});
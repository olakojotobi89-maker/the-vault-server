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

// Increase limit to handle Base64 images/videos/audio
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
    comments: [{
        user: String,
        text: String,
        timestamp: { type: Date, default: Date.now }
    }]
}));

const Message = mongoose.model('Message', new mongoose.Schema({
    sender: { type: String, required: true },
    receiver: { type: String, required: true },
    content: { type: String, required: true },
    type: { type: String, default: 'text' }, // 'text', 'image', 'voice'
    timestamp: { type: Date, default: Date.now }
}));

// --- API ROUTES ---

// 1. CHAT HISTORY
app.get('/api/chat/:user1/:user2', async (req, res) => {
    try {
        const { user1, user2 } = req.params;
        const messages = await Message.find({
            $or: [
                { sender: user1, receiver: user2 },
                { sender: user2, receiver: user1 }
            ]
        }).sort({ timestamp: 1 });
        res.json(messages);
    } catch (err) {
        res.status(500).json({ error: "Could not fetch chat history" });
    }
});

// 2. DELETE MESSAGE
app.delete('/api/chat/:messageId', async (req, res) => {
    try {
        const { username } = req.body;
        const msg = await Message.findById(req.params.messageId);
        if (!msg) return res.status(404).json({ error: "Message not found" });
        if (msg.sender !== username) return res.status(403).json({ error: "Unauthorized" });

        await Message.findByIdAndDelete(req.params.messageId);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: "Delete failed" });
    }
});

// 3. POSTS & FEED
app.post('/api/posts', async (req, res) => {
    try {
        const { sender, caption, media, type } = req.body;
        const newPost = new Post({ sender, caption, media, type });
        await newPost.save();
        res.json({ success: true, post: newPost });
    } catch (err) { res.status(500).json({ error: "Save failed" }); }
});

app.get('/api/posts', async (req, res) => {
    try {
        const posts = await Post.find().sort({ timestamp: -1 }).limit(20);
        res.json(posts);
    } catch (err) { res.status(500).json({ error: "Fetch failed" }); }
});

app.delete('/api/posts/:postId', async (req, res) => {
    try {
        const { username } = req.body; 
        const post = await Post.findById(req.params.postId);
        if (post && post.sender === username) {
            await Post.findByIdAndDelete(req.params.postId);
            res.json({ success: true });
        } else {
            res.status(403).json({ error: "Unauthorized" });
        }
    } catch (err) { res.status(500).json({ error: "Delete failed" }); }
});

// 4. USER & PROFILE (UPDATED FOR FRIENDS LIST)
app.get('/api/profile/:username', async (req, res) => {
    try {
        // Populating 'username' for the friends list modal
        const user = await User.findOne({ username: req.params.username })
                               .populate('followers following', 'username');

        if (!user) return res.status(404).json({ error: "User not found" });
        
        const userPosts = await Post.find({ sender: req.params.username }).sort({ timestamp: -1 });
        
        res.json({
            username: user.username,
            bio: user.bio,
            followersCount: user.followers.length,
            followingCount: user.following.length,
            followers: user.followers, // Send the actual objects for the modal
            following: user.following, // Send the actual objects for the modal
            posts: userPosts
        });
    } catch (err) { res.status(500).json({ error: "Server error" }); }
});

app.post('/api/follow', async (req, res) => {
    const { myUsername, targetUsername } = req.body;
    try {
        const me = await User.findOne({ username: myUsername });
        const target = await User.findOne({ username: targetUsername });

        if (me && target) {
            // Check if already following using ID comparison
            const isFollowing = me.following.some(id => id.equals(target._id));

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
        }
    } catch (err) { res.status(500).json({ error: "Follow failed" }); }
});

app.get('/api/search/:query', async (req, res) => {
    const users = await User.find({ username: { $regex: '^' + req.params.query, $options: 'i' } }).select('username').limit(5);
    res.json(users);
});

// 5. AUTH
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    const user = await User.findOne({ username, password });
    if (!user) return res.status(401).json({ error: "Access Denied" });
    res.json({ message: "Access Granted", username: user.username });
});

app.post('/api/signup', async (req, res) => {
    try {
        const { username, password, email, phone } = req.body;
        await new User({ username, password, email, phone }).save();
        res.json({ message: "Success" });
    } catch (err) { res.status(500).json({ error: "Signup failed" }); }
});

// --- SOCKET LOGIC ---
io.on('connection', (socket) => {
    socket.on('join_private', (username) => {
        socket.join(username);
        console.log(`📡 ${username} joined private room.`);
    });

    socket.on('send_message', async (data) => {
        try {
            const { sender, receiver, content, type } = data;
            const newMessage = await Message.create({ sender, receiver, content, type });
            
            const messageData = { 
                ...data, 
                _id: newMessage._id, 
                timestamp: newMessage.timestamp 
            };

            io.to(receiver).emit('receive_message', messageData);
            io.to(sender).emit('receive_message', messageData);
        } catch (err) {
            console.error("Socket Message Error:", err);
        }
    });

    socket.on('send_like', (data) => {
        io.emit('receive_like', data);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 VAULT SERVER ACTIVE ON PORT ${PORT}`);
});
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

app.use(express.static(path.join(__dirname)));

// --- RENDER ROUTING ---
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/login.html', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/home.html', (req, res) => res.sendFile(path.join(__dirname, 'home.html')));
app.get('/notification.html', (req, res) => res.sendFile(path.join(__dirname, 'notification.html')));
app.get('/search.html', (req, res) => res.sendFile(path.join(__dirname, 'search.html')));
app.get('/chat.html', (req, res) => res.sendFile(path.join(__dirname, 'chat.html')));
app.get('/direct.html', (req, res) => res.sendFile(path.join(__dirname, 'direct.html')));
app.get('/profile.html', (req, res) => res.sendFile(path.join(__dirname, 'profile.html')));
// ADDED FOR COMMENTS
app.get('/post-details.html', (req, res) => res.sendFile(path.join(__dirname, 'post-details.html')));

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
    senderPfp: { type: String, default: "" },
    caption: String,
    media: String, 
    type: { type: String, default: 'image' }, 
    likedBy: [{ type: String }],
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

const Notification = mongoose.model('Notification', new mongoose.Schema({
    toUser: { type: String, required: true, index: true },
    fromUser: { type: String, required: true },
    type: { type: String, required: true }, 
    timestamp: { type: Date, default: Date.now },
    read: { type: Boolean, default: false }
}));

// --- API ROUTES ---

// FIXED: COMMENT API WITH NOTIFICATIONS
app.post('/api/posts/:id/comment', async (req, res) => {
    try {
        const post = await Post.findById(req.params.id);
        if (!post) return res.status(404).json({ error: "Post not found" });
        
        post.comments.push({ user: req.body.username, text: req.body.text });
        await post.save();

        // Send notification to post owner if someone else comments
        if (post.sender !== req.body.username) {
            const notif = await Notification.create({ 
                toUser: post.sender, 
                fromUser: req.body.username, 
                type: 'comment' 
            });
            io.to(post.sender).emit('receive_notification', notif);
        }

        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/follow', async (req, res) => {
    const { me, target } = req.body;
    if (!me || !target || me === target) return res.status(400).json({ error: "Invalid usernames" });
    
    try {
        const myUser = await User.findOne({ username: me });
        if (!myUser) return res.status(404).json({ error: "User not found" });

        const isFollowing = myUser.following.includes(target);

        if (!isFollowing) {
            await Promise.all([
                User.updateOne({ username: me }, { $addToSet: { following: target } }),
                User.updateOne({ username: target }, { $addToSet: { followers: me } }),
                Notification.create({ toUser: target, fromUser: me, type: 'follow' })
            ]);

            io.to(target).emit('receive_notification', { fromUser: me, type: 'follow' });
            res.json({ success: true, following: true });
        } else {
            await Promise.all([
                User.updateOne({ username: me }, { $pull: { following: target } }),
                User.updateOne({ username: target }, { $pull: { followers: me } })
            ]);
            res.json({ success: true, following: false });
        }
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/posts/:id/like', async (req, res) => {
    try {
        const post = await Post.findById(req.params.id);
        if (!post.likedBy.includes(req.body.username)) {
            post.likedBy.push(req.body.username);
            post.likes += 1;
            await post.save();

            const notif = await Notification.create({ 
                toUser: post.sender, 
                fromUser: req.body.username, 
                type: 'like' 
            });

            io.to(post.sender).emit('receive_notification', notif);
            res.json({ success: true });
        } else { res.json({ message: "Already liked" }); }
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/follow-status/:me/:target', async (req, res) => {
    try {
        const user = await User.findOne({ username: req.params.me });
        const isFollowing = user ? user.following.includes(req.params.target) : false;
        res.json({ isFollowing });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/users/search', async (req, res) => {
    const query = req.query.q;
    if (!query) return res.json([]);
    try {
        const users = await User.find({ 
            username: { $regex: query, $options: 'i' } 
        }).select('username profilePic bio');
        res.json(users);
    } catch (err) { res.status(500).json({ error: "Search failed" }); }
});

app.get('/api/profile/:username', async (req, res) => {
    try {
        const user = await User.findOne({ username: req.params.username }).select('-password');
        if (!user) return res.status(404).json({ error: "User not found" });
        res.json(user);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/update-settings', async (req, res) => {
    try {
        const { username, settings } = req.body;
        await User.findOneAndUpdate({ username }, { $set: settings });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/posts', async (req, res) => {
    try {
        const posts = await Post.find().sort({ timestamp: -1 }).limit(50);
        res.json(posts);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/posts', async (req, res) => {
    try {
        const user = await User.findOne({ username: req.body.sender });
        const postData = { ...req.body, senderPfp: user ? user.profilePic : "" };
        const post = await Post.create(postData);
        res.json(post);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/posts/:id', async (req, res) => {
    try {
        const post = await Post.findById(req.params.id);
        if (post && post.sender === req.body.username) {
            await Post.findByIdAndDelete(req.params.id);
            res.json({ success: true });
        } else { res.status(403).json({ error: "Unauthorized" }); }
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/unread-messages-count/:username', async (req, res) => {
    try {
        const count = await Message.countDocuments({ receiver: req.params.username, seen: false });
        res.json({ count });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

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
            return { 
                username: u.username, 
                profilePic: u.profilePic, 
                unreadCount 
            };
        }));
        res.json(chatList);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

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

app.post('/api/signup', async (req, res) => {
    try {
        const hashedPassword = await bcrypt.hash(req.body.password, 10);
        await User.create({ 
            username: req.body.username, 
            password: hashedPassword,
            followers: [],
            following: []
        });
        res.json({ success: true });
    } catch (err) { res.status(400).json({ error: "Username already taken" }); }
});

app.post('/api/login', async (req, res) => {
    try {
        const user = await User.findOne({ username: req.body.username });
        if (user && await bcrypt.compare(req.body.password, user.password)) {
            res.json({ message: "Access Granted", username: user.username, settings: user.settings });
        } else { res.status(401).json({ error: "Invalid credentials" }); }
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/notifications/:username', async (req, res) => {
    try {
        const notifications = await Notification.find({ toUser: req.params.username }).sort({ timestamp: -1 });
        res.json(notifications);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- SOCKET LOGIC ---
io.on('connection', (socket) => {
    socket.on('join_private', (username) => {
        socket.join(username);
    });

    socket.on('send_message', async (data) => {
        try {
            const newMessage = await Message.create(data);
            io.to(data.receiver).emit('receive_message', newMessage);
            io.to(data.sender).emit('receive_message', newMessage);
            io.to(data.receiver).emit('update_badge'); 
        } catch (err) { console.error(err); }
    });

    socket.on('send_like', (data) => {
        io.to(data.owner).emit('receive_like', { sender: data.sender, owner: data.owner });
    });
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 VAULT SERVER ACTIVE ON PORT ${PORT}`);
});
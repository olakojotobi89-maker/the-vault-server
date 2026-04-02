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
mongoose.connect(MONGO_URI).then(() => console.log("🚀 VAULT FULL ENGINE ACTIVE")).catch(err => console.log(err));

// --- SCHEMAS (Restored & Indexed) ---
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

// --- RESTORED API ROUTES ---

// Auth
app.post('/api/signup', async (req, res) => {
    try {
        const hashedPassword = await bcrypt.hash(req.body.password, 10);
        await User.create({ username: req.body.username, password: hashedPassword });
        res.json({ success: true });
    } catch (err) { res.status(400).json({ error: "Taken" }); }
});

app.post('/api/login', async (req, res) => {
    try {
        const user = await User.findOne({ username: req.body.username }).lean();
        if (user && await bcrypt.compare(req.body.password, user.password)) {
            res.json({ message: "Access Granted", username: user.username, settings: user.settings });
        } else { res.status(401).json({ error: "Invalid" }); }
    } catch (err) { res.status(500).json({ error: "Err" }); }
});

// Posts & Social
app.get('/api/posts', async (req, res) => {
    try {
        const posts = await Post.find().sort({ timestamp: -1 }).limit(20).lean();
        res.json(posts);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/posts', async (req, res) => {
    try {
        const user = await User.findOne({ username: req.body.sender }).select('profilePic').lean();
        const post = await Post.create({ ...req.body, senderPfp: user ? user.profilePic : "" });
        res.json(post);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/posts/:id/like', async (req, res) => {
    try {
        const post = await Post.findById(req.params.id);
        if (!post.likedBy.includes(req.body.username)) {
            post.likedBy.push(req.body.username);
            post.likes += 1;
            await post.save();
            const notif = await Notification.create({ toUser: post.sender, fromUser: req.body.username, type: 'like' });
            io.to(post.sender).emit('receive_notification', notif);
            res.json({ success: true });
        } else { res.json({ message: "Liked" }); }
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/follow', async (req, res) => {
    const { me, target } = req.body;
    try {
        const myUser = await User.findOne({ username: me });
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

// Profile & Search
app.get('/api/profile/:username', async (req, res) => {
    try {
        const user = await User.findOne({ username: req.params.username }).select('-password').lean();
        res.json(user);
    } catch (err) { res.status(404).json({ error: "Not found" }); }
});

app.get('/api/users/search', async (req, res) => {
    try {
        const users = await User.find({ username: { $regex: req.query.q, $options: 'i' } }).select('username profilePic bio').limit(10).lean();
        res.json(users);
    } catch (err) { res.status(500).json({ error: "Err" }); }
});

// Notifications
app.get('/api/notifications/:username', async (req, res) => {
    try {
        const notifs = await Notification.find({ toUser: req.params.username }).sort({ timestamp: -1 }).limit(20).lean();
        res.json(notifs);
    } catch (err) { res.status(500).json({ error: "Err" }); }
});

// Messages & Chat List
app.get('/api/messages/:me/:target', async (req, res) => {
    try {
        const msgs = await Message.find({
            $or: [{ sender: req.params.me, receiver: req.params.target }, { sender: req.params.target, receiver: req.params.me }]
        }).sort({ timestamp: 1 }).lean();
        res.json(msgs);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/chat-list/:username', async (req, res) => {
    try {
        const username = req.params.username;
        const messages = await Message.find({ $or: [{ sender: username }, { receiver: username }] }).sort({ timestamp: -1 }).lean();
        const partners = [...new Set(messages.map(m => m.sender === username ? m.receiver : m.sender))];
        const users = await User.find({ username: { $in: partners } }).select('username profilePic').lean();
        res.json(users.map(u => ({ ...u, type: 'private' })));
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Groups
app.get('/api/groups/my-groups/:username', async (req, res) => {
    try {
        const groups = await Group.find({ members: req.params.username }).lean();
        res.json(groups);
    } catch (err) { res.status(500).json({ error: "Err" }); }
});

// HTML Routing
app.get('*', (req, res) => {
    const file = req.path === '/' ? 'index.html' : req.path.substring(1);
    res.sendFile(path.join(__dirname, file.endsWith('.html') ? file : file + '.html'), (err) => {
        if (err) res.sendFile(path.join(__dirname, 'index.html'));
    });
});

// --- SOCKET LOGIC ---
io.on('connection', (socket) => {
    socket.on('join_private', (u) => socket.join(u));
    socket.on('join_group', (id) => socket.join(id));

    socket.on('send_message', async (data) => {
        const msg = await Message.create(data);
        io.to(data.receiver).emit('receive_message', msg);
        io.to(data.sender).emit('receive_message', msg);
    });

    socket.on('send_group_message', async (data) => {
        const gMsg = await GroupMessage.create(data);
        io.to(data.groupId).emit('receive_group_message', gMsg);
    });
});

server.listen(PORT, '0.0.0.0', () => console.log(`🚀 FULL POWER VAULT ON PORT ${PORT}`));
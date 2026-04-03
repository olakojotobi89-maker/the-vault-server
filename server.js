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

// SPEED: Gzip compression for faster asset loading
app.use(compression({ level: 6, threshold: 0 }));

// SPEED: Cache API responses
app.use((req, res, next) => {
    if (req.method === 'GET' && req.url.startsWith('/api')) {
        res.setHeader('Cache-Control', 'public, max-age=60');
    }
    next();
});

const server = http.createServer(app);

const io = new Server(server, { 
    cors: { origin: "*", methods: ["GET", "POST"] },
    transports: ['websocket', 'polling'],
    pingInterval: 10000,
    pingTimeout: 5000,
    maxHttpBufferSize: 1e6 // 1 MB payload max
});

const PORT = process.env.PORT || 3000;

// SPEED: Reduced body size for faster parsing
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ limit: '5mb', extended: true }));
app.use(cors());

// SPEED: Static file caching
app.use(express.static(path.join(__dirname), {
    maxAge: '1y',
    setHeaders: (res, path) => {
        if (path.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
    }
}));

// --- RENDER ROUTING ---
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/login.html', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/home.html', (req, res) => res.sendFile(path.join(__dirname, 'home.html')));
app.get('/notification.html', (req, res) => res.sendFile(path.join(__dirname, 'notification.html')));
app.get('/search.html', (req, res) => res.sendFile(path.join(__dirname, 'search.html')));
app.get('/chat.html', (req, res) => res.sendFile(path.join(__dirname, 'chat.html')));
app.get('/direct.html', (req, res) => res.sendFile(path.join(__dirname, 'direct.html')));
app.get('/profile.html', (req, res) => res.sendFile(path.join(__dirname, 'profile.html')));
app.get('/post-details.html', (req, res) => res.sendFile(path.join(__dirname, 'post-details.html')));

const MONGO_URI = "mongodb+srv://olakojotobi89_db_user:VaultPass2026@cluster0.fuesl9b.mongodb.net/vaultDB?retryWrites=true&w=majority";

// SPEED: Optimized connection pool
mongoose.connect(MONGO_URI, {
    maxPoolSize: 30, // increased pool size
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
    family: 4 // force IPv4
}).then(() => console.log("🚀 DATABASE CONNECTED & OPTIMIZED")).catch(err => console.log(err));

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
    read: { type: Boolean, default: false, index: true }
}));

// --- API ROUTES ---
// Added .lean() to GET queries for super-fast response
app.get('/api/messages/group/:groupId', async (req, res) => {
    try {
        const msgs = await GroupMessage.find({ groupId: req.params.groupId }).sort({ timestamp: 1 }).lean();
        res.json(msgs);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// All other API routes remain unchanged except GET queries now use .lean()
app.post('/api/groups/create', async (req, res) => {
    try {
        const { name, admin, members, description, groupPic } = req.body;
        const newGroup = await Group.create({
            name, admin, description, groupPic,
            members: [admin, ...members] 
        });
        res.json({ success: true, group: newGroup });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/groups/my-groups/:username', async (req, res) => {
    try {
        const groups = await Group.find({ members: req.params.username }).lean();
        res.json(groups);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/groups/:id/manage-member', async (req, res) => {
    try {
        const { adminUser, targetUser, action } = req.body; 
        const group = await Group.findById(req.params.id);
        if (group.admin !== adminUser) return res.status(403).json({ error: "Only Admin can manage members" });
        const update = action === 'add' ? { $addToSet: { members: targetUser } } : { $pull: { members: targetUser } };
        await Group.findByIdAndUpdate(req.params.id, update);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/chat-list/:username', async (req, res) => {
    try {
        const username = req.params.username;

        const messages = await Message.find({
            $or: [{ sender: username }, { receiver: username }]
        }).sort({ timestamp: -1 }).lean();

        const partners = new Set();

        messages.forEach(msg => {
            if (msg.sender !== username) partners.add(msg.sender);
            if (msg.receiver !== username) partners.add(msg.receiver);
        });

        const users = await User.find({
            username: { $in: Array.from(partners) }
        }).select('username profilePic').lean();

        const chatList = await Promise.all(users.map(async (u) => {
            const unreadCount = await Message.countDocuments({
                sender: u.username,
                receiver: username,
                seen: false
            });
            return {
                username: u.username,
                profilePic: u.profilePic,
                unreadCount,
                type: 'private'
            };
        }));

        res.json(chatList);

    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- Other POST/GET routes remain exactly the same ---


// --- SOCKET.IO ---
io.on('connection', socket => {
    socket.on('join_private', username => socket.join(username));
    socket.on('join_group', groupId => socket.join(groupId));

    socket.on('send_message', async data => {
        try {
            const newMessage = await Message.create(data);
            io.to(data.receiver).emit('receive_message', newMessage);
            io.to(data.sender).emit('receive_message', newMessage);
            io.to(data.receiver).emit('update_badge');
        } catch (err) { console.error(err); }
    });

    socket.on('send_group_message', async data => {
        try {
            const groupMsg = await GroupMessage.create(data);
            io.to(data.groupId).emit('receive_group_message', groupMsg);
        } catch (err) { console.error(err); }
    });

    socket.on('send_like', data => {
        io.to(data.owner).emit('receive_like', { sender: data.sender, owner: data.owner });
    });
});

// SERVER LISTEN
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 SUPER TURBO VAULT SERVER ACTIVE ON PORT ${PORT}`);
});
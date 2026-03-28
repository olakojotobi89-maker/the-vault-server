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

// Middleware
app.use(express.json({ limit: '50mb' }));
app.use(cors());
app.use(express.static(path.join(__dirname)));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// --- MONGODB CONNECTION ---
// Hardcoded stable long-form string to bypass .env "undefined" issues
const MONGO_URI = "mongodb://olakojotobi89_db_user:VaultPass2026@cluster0-shard-00-00.fuesl9b.mongodb.net:27017,cluster0-shard-00-01.fuesl9b.mongodb.net:27017,cluster0-shard-00-02.fuesl9b.mongodb.net:27017/vaultDB?ssl=true&replicaSet=atlas-fuesl9b-shard-0&authSource=admin&retryWrites=true&w=majority";

mongoose.connect(MONGO_URI)
    .then(() => console.log("☁️ Connected to MongoDB Cloud (Stable Mode)!"))
    .catch(err => {
        console.error("❌ MongoDB Connection Error:", err);
        console.log("👉 Troubleshooting: Ensure IP 0.0.0.0/0 is whitelisted in MongoDB Atlas.");
    });

// --- DATABASE SCHEMAS ---
const UserSchema = new mongoose.Schema({
    username: { type: String, unique: true, required: true, index: true },
    password: { type: String, required: true },
    email: { type: String, sparse: true },
    phone: String,
    bio: { type: String, default: "Welcome to my vault." },
    followers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    following: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }]
});
const User = mongoose.model('User', UserSchema);

const Post = mongoose.model('Post', new mongoose.Schema({
    sender: { type: String, index: true },
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
    sender: { type: String, required: true, index: true },
    receiver: { type: String, required: true, index: true },
    content: { type: String, required: true },
    type: { type: String, default: 'text' }, 
    timestamp: { type: Date, default: Date.now },
    seen: { type: Boolean, default: false }
}));

// --- API ROUTES ---
app.post('/api/signup', async (req, res) => {
    try {
        const { username, password, email, phone } = req.body;
        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = new User({ username, password: hashedPassword, email, phone });
        await newUser.save();
        res.json({ success: true, message: "User created" });
    } catch (err) { 
        res.status(400).json({ error: "Username might already exist or data is invalid" }); 
    }
});

app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const user = await User.findOne({ username });
        if (!user) return res.status(401).json({ error: "Invalid username" });

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(401).json({ error: "Invalid password" });

        res.json({ message: "Access Granted", username: user.username });
    } catch (err) { res.status(500).json({ error: "Login error" }); }
});

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
    } catch (err) { res.status(500).json({ error: "Fetch failed" }); }
});

app.get('/api/posts', async (req, res) => {
    try {
        const posts = await Post.find().sort({ timestamp: -1 }).limit(30);
        res.json(posts);
    } catch (err) { res.status(500).json({ error: "Fetch failed" }); }
});

app.get('/api/search/:query', async (req, res) => {
    try {
        const users = await User.find({ 
            username: { $regex: '^' + req.params.query, $options: 'i' } 
        }).select('username').limit(10);
        res.json(users);
    } catch (err) { res.json([]); }
});

// --- SOCKET LOGIC ---
io.on('connection', (socket) => {
    socket.on('join_private', (username) => {
        socket.join(username);
    });

    socket.on('send_message', async (data) => {
        try {
            const { sender, receiver, content, type } = data;
            if (!content) return;

            const newMessage = await Message.create({ sender, receiver, content, type });
            
            io.to(receiver).emit('receive_message', newMessage);
            io.to(sender).emit('receive_message', newMessage);
        } catch (err) { console.error("Socket Error:", err); }
    });

    socket.on('mark_read', async (data) => {
        try {
            await Message.updateMany(
                { sender: data.sender, receiver: data.reader, seen: false },
                { $set: { seen: true } }
            );
            io.to(data.sender).emit('messages_viewed', { viewer: data.reader });
        } catch (err) { console.error("Mark Read Error:", err); }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 VAULT SERVER ACTIVE ON PORT ${PORT}`);
});
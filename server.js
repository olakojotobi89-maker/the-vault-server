const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
const nodemailer = require('nodemailer');
const path = require('path'); // Added surgically for file handling

const app = express();
const server = http.createServer(app);
const io = new Server(server, { 
    cors: { origin: "*", methods: ["GET", "POST"] } 
});

app.use(cors());
app.use(express.json());

// --- SERVE FRONTEND FILES ---
// This allows Render to serve your index.html, CSS, and JS files
app.use(express.static(path.join(__dirname)));

// --- HOME ROUTE ---
// This fixes the "Cannot GET /" error by sending your main HTML file
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// --- MONGODB CONNECTION ---
// Updated to modern SRV string for better Render compatibility
const MONGO_URI = process.env.MONGO_URI || "mongodb+srv://olakojotobi89_db_user:VaultPass2026@cluster0.fuesl9b.mongodb.net/vaultDB?retryWrites=true&w=majority";

mongoose.connect(MONGO_URI, {
    serverSelectionTimeoutMS: 10000 // Giving it 10 seconds for mobile data lag
})
    .then(() => console.log("☁️ Connected to MongoDB Cloud!"))
    .catch(err => {
        console.error("❌ MongoDB Connection Error!");
        console.log("Check if your Hotspot is blocking Port 27017. If so, turn on a VPN.");
    });

// --- DATABASE SCHEMAS ---
const User = mongoose.model('User', new mongoose.Schema({
    username: { type: String, unique: true, required: true },
    password: { type: String, required: true },
    email: String,
    phone: String
}));

const Message = mongoose.model('Message', new mongoose.Schema({
    sender: String,
    content: String,
    timestamp: { type: Date, default: Date.now }
}));

const Post = mongoose.model('Post', new mongoose.Schema({
    sender: String,
    caption: String,
    media: String,
    type: String,
    timestamp: { type: Date, default: Date.now }
}));

const PasswordReset = mongoose.model('PasswordReset', new mongoose.Schema({
    username: String,
    otp: String,
    expiresAt: Date
}));

const Comment = mongoose.model('Comment', new mongoose.Schema({
    post_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Post' },
    sender: String,
    content: String
}));

// --- EMAIL SETUP ---
const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com', port: 465, secure: true,
    auth: { user: 'olakojotobi89@gmail.com', pass: 'khbxbiccyqcjzokg' },
    tls: { rejectUnauthorized: false }
});

// --- API ROUTES ---

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

// Socket.io Real-time Chat logic
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
    console.log(`🔗 Multi-device cloud mode enabled.`);
});
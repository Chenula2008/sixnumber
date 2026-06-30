require('dotenv').config();
const path = require('path');
const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const MongoStore = require('connect-mongo').default || require('connect-mongo');
const bcrypt = require('bcryptjs');
const User = require('./models/User');
const Withdrawal = require('./models/Withdrawal');
const crypto = require('crypto');
const sgMail = require('@sendgrid/mail'); // 🚀 Official SendGrid Package (Used for Support Emails)

// 🚀 Initialize SendGrid with your API Key
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

// 1. INITIALIZE EXPRESS APP
const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.static('public'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
    secret: process.env.SESSION_SECRET || 'supersecretkey',
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({ 
        mongoUrl: process.env.MONGO_URI,
        touchAfter: 24 * 3600 
    })
}));

mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('DB Connected'))
    .catch(err => console.error('MongoDB Connection Error:', err));

const authMiddleware = async (req, res, next) => {
    if (req.session.userId) {
        const user = await User.findById(req.session.userId);
        if (user) {
            return next();
        } else {
            req.session.destroy();
            return res.redirect('/login');
        }
    }
    res.redirect('/login');
};

const adminCheck = async (req, res, next) => {
    const user = await User.findById(req.session.userId);
    if (user && (user.isAdmin || user.role === 'admin')) return next();
    res.status(403).send('Access Denied: Admins Only!');
};

function generateNumbers() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

// --- PAGE ROUTES ---
app.get('/', (req, res) => res.redirect('/login'));

// 🚨 UPDATED: Passes the verification link from the session to the page
app.get('/login', (req, res) => {
    if (req.session.userId) return res.redirect('/dashboard');
    const verificationLink = req.session.verificationLink || null; 
    res.render('login', { error: null, success: null, verificationLink });
});

app.get('/signup', (req, res) => {
    if (req.session.userId) return res.redirect('/dashboard');
    res.render('signup', { error: null, success: null });
});

app.get('/dashboard', authMiddleware, async (req, res) => {
    const user = await User.findById(req.session.userId);
    const pendingWithdrawals = await Withdrawal.find({ userId: user._id, status: 'pending' });
    let pendingCents = 0;
    pendingWithdrawals.forEach(w => { pendingCents += w.amountCents; });

    if (!user.currentNumbers) {
        user.currentNumbers = generateNumbers();
        await user.save();
    }
    res.render('dashboard', { user, pendingCents });
});

app.get('/withdraw', authMiddleware, async (req, res) => {
    const user = await User.findById(req.session.userId);
    const pendingWithdrawals = await Withdrawal.find({ userId: user._id, status: 'pending' });
    let pendingCents = 0;
    pendingWithdrawals.forEach(w => { pendingCents += w.amountCents; });
    res.render('withdraw', { user, pendingCents });
});

app.get('/history', authMiddleware, async (req, res) => {
    const user = await User.findById(req.session.userId);
    const myWithdrawals = await Withdrawal.find({ userId: user._id }).sort({ createdAt: -1 });
    res.render('history', { user, myWithdrawals });
});

app.get('/profile', authMiddleware, async (req, res) => {
    const user = await User.findById(req.session.userId);
    res.render('profile', { user });
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/login');
});

app.get('/sw.js', (req, res) => {
    res.sendFile(__dirname + '/public/sw.js');
});

// --- AUTHENTICATION ROUTES ---
app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const user = await User.findOne({ email });
        
        if (!user) {
            return res.render('login', { error: "Invalid email or password.", success: null, verificationLink: req.session.verificationLink });
        }

        const isUserAdmin = user.isAdmin || user.role === 'admin';
        
        // 🚨 BULLETPROOF: If they aren't verified, regenerate the link and show it to them!
        if (!user.isVerified && !isUserAdmin) {
            if (!user.verificationToken) {
                user.verificationToken = crypto.randomBytes(32).toString('hex');
                user.verificationTokenExpires = Date.now() + 3600000;
                await user.save();
            }
            const verificationUrl = `${process.env.BASE_URL}/verify-email?token=${user.verificationToken}`;
            req.session.verificationLink = verificationUrl;

            return res.render('login', { 
                error: "⚠️ Please verify your email address before logging in. Click the link below:", 
                success: null,
                verificationLink: verificationUrl
            });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.render('login', { error: "Invalid email or password.", success: null, verificationLink: req.session.verificationLink });
        }

        req.session.userId = user._id;
        req.session.save((err) => {
            if (err) console.error("Session save error:", err);
            res.redirect('/dashboard');
        });

    } catch (err) {
        console.log("LOGIN ERROR:", err);
        res.render('login', { error: "Server error.", success: null, verificationLink: req.session.verificationLink });
    }
});

app.post('/signup', async (req, res) => {
    const { username, email, password, firstName, lastName } = req.body; 
    try {
        const existingUser = await User.findOne({ $or: [{ email }, { username }] });
        if (existingUser) return res.render('signup', { error: "Username or Email already exists.", success: null });

        const hashedPassword = await bcrypt.hash(password, 10);
        const token = crypto.randomBytes(32).toString('hex');

        const newUser = new User({ 
            username, email, password: hashedPassword, firstName, lastName,
            isVerified: false, 
            verificationToken: token,
            verificationTokenExpires: Date.now() + 3600000 
        });
        
        await newUser.save(); 
        
        // 🚨 Uses your BASE_URL environment variable
        const verificationUrl = `${process.env.BASE_URL}/verify-email?token=${token}`;
        
        // 🚀 SAVE LINK TO SESSION (Displays on the login page instead of emailing)
        req.session.verificationLink = verificationUrl;

        res.render('login', { 
            error: "✅ Account created! Please click the verification link below to activate your account.", 
            success: null,
            verificationLink: verificationUrl
        });

    } catch (err) {
        console.log("SIGNUP ERROR:", err);
        res.render('signup', { error: "Error creating account: " + err.message, success: null });
    }
});

// --- PASSWORD RESET ROUTES ---
app.get('/forgot-password', (req, res) => res.render('forgot-password', { error: null }));
app.post('/forgot-password', async (req, res) => {
    const { email } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.render('forgot-password', { error: "Email not found." });
    res.redirect(`/reset-password/${user._id}`);
});
app.get('/reset-password/:userId', (req, res) => res.render('reset-password', { userId: req.params.userId, error: null }));
app.post('/reset-password/:userId', async (req, res) => {
    const { userId } = req.params;
    const { newPassword } = req.body;
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await User.findByIdAndUpdate(userId, { password: hashedPassword });
    res.redirect('/login');
});

// --- PROFILE API ---
app.post('/api/profile', authMiddleware, async (req, res) => {
    const { username, email, firstName, lastName } = req.body;
    try {
        const user = await User.findById(req.session.userId);
        if (username && username.trim() !== '') user.username = username.trim();
        if (email && email.trim() !== '') user.email = email.trim();
        if (firstName && firstName.trim() !== '') user.firstName = firstName.trim();
        if (lastName && lastName.trim() !== '') user.lastName = lastName.trim();
        await user.save();
        res.json({ success: true, message: "Profile updated successfully!" });
    } catch (err) {
        res.status(400).json({ error: "Failed to update. That email might already be in use." });
    }
});

// --- CORE ROUTES (Earning & Withdrawals) ---
app.post('/api/earn', authMiddleware, async (req, res) => {
    const user = await User.findById(req.session.userId);
    const { typedNumbers } = req.body;

    const now = Date.now();
    if (user.lastEarnedAt && (now - user.lastEarnedAt) < 5000) {
        return res.status(429).json({ error: "Please wait 5 seconds before typing again." });
    }
    if (typedNumbers !== user.currentNumbers) {
        return res.status(400).json({ error: "Incorrect numbers! Please type the exact numbers shown." });
    }

    user.walletCents += 1; 
    user.lastEarnedAt = now;
    user.currentNumbers = generateNumbers();
    await user.save();

    res.json({ 
        success: true, 
        earned: 0.01, 
        newBalance: (user.walletCents / 100).toFixed(2),
        newNumbers: user.currentNumbers
    });
});

app.post('/api/withdraw', authMiddleware, async (req, res) => {
    const user = await User.findById(req.session.userId);
    const { amount, method, address } = req.body;
    const amountCents = Math.round(amount * 100);

    if (amountCents < 500) return res.status(400).json({ error: "Minimum withdrawal is $5.00." });
    if (!['paypal', 'bitcoin'].includes(method)) return res.status(400).json({ error: "Invalid method." });
    if (user.walletCents < amountCents) return res.status(400).json({ error: "Insufficient funds." });

    user.walletCents -= amountCents;
    await user.save();

    await Withdrawal.create({
        userId: user._id,
        amountCents,
        method,
        paymentAddress: address, 
        status: 'pending'
    });

    res.json({ success: true, message: "Withdrawal requested. Please allow at least 3 days for processing." });
});

// --- ADMIN ROUTES ---
app.get('/admin', authMiddleware, async (req, res) => {
    try {
        const user = await User.findById(req.session.userId);
        if (!user || (!user.isAdmin && user.role !== 'admin')) {
            return res.redirect('/dashboard');
        }
        
        const users = await User.find().sort({ createdAt: -1 }); 
        const withdrawals = await Withdrawal.find().populate('userId', 'username firstName lastName').sort({ createdAt: -1 });  
        const totalUsers = await User.countDocuments();
        const totalWithdrawals = await Withdrawal.countDocuments({ status: 'pending' });
        
        res.render('admin', { user, users, withdrawals, totalUsers, totalWithdrawals });
    } catch (error) {
        console.error("ADMIN PAGE CRASH:", error);
        res.status(500).send("Admin page crashed. Error: " + error.message);
    }
});

app.post('/admin/user/:id/delete', authMiddleware, adminCheck, async (req, res) => {
    const { id } = req.params;
    const userToDelete = await User.findById(id);
    if (userToDelete && (userToDelete.isAdmin || userToDelete.role === 'admin')) {
        return res.redirect('/admin'); 
    }
    await User.findByIdAndDelete(id);
    await Withdrawal.deleteMany({ userId: id });
    res.redirect('/admin'); 
});

app.post('/admin/withdrawal/:id/action', authMiddleware, adminCheck, async (req, res) => {
    const { id } = req.params;
    const { action } = req.body;
    
    const withdrawal = await Withdrawal.findById(id);
    if (!withdrawal) return res.send('Withdrawal not found');

    if (action === 'approve') {
        withdrawal.status = 'approved';
    } else if (action === 'reject') {
        withdrawal.status = 'rejected';
        const user = await User.findById(withdrawal.userId);
        if(user) {
            user.walletCents += withdrawal.amountCents;
            await user.save();
        }
    }
    
    await withdrawal.save();
    res.redirect('/admin'); 
});

// --- SUPPORT / CONTACT ROUTES ---
app.get('/contact', authMiddleware, async (req, res) => {
    const user = await User.findById(req.session.userId);
    res.render('contact', { user });
});

app.post('/api/contact', authMiddleware, async (req, res) => {
    const { subject, message } = req.body;
    const user = await User.findById(req.session.userId);
    
    if (!subject || !message) return res.status(400).json({ error: "Please fill in all fields." });
    
    try {
        const contactHtml = `
            <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; background-color: #1a1040; border-radius: 16px; overflow: hidden; box-shadow: 0 10px 30px rgba(0,0,0,0.5);">
                <div style="background: linear-gradient(135deg, #f59e0b, #ef4444); padding: 25px; text-align: center;">
                    <h1 style="color: #ffffff; margin: 0; font-size: 24px; font-weight: 800;">📩 New Support Message</h1>
                </div>
                <div style="padding: 30px; color: #ffffff;">
                    <p style="font-size: 16px; color: #cbd5e1; margin-bottom: 20px;">You have received a new message from a user.</p>
                    <div style="background: rgba(255,255,255,0.05); padding: 20px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.1); margin-bottom: 20px;">
                        <p style="margin: 0 0 10px 0; font-size: 14px; color: #94a3b8;">From:</p>
                        <p style="margin: 0; font-size: 16px; font-weight: 600; color: #00d4ff;">${user.firstName} ${user.lastName} (${user.username})</p>
                        <p style="margin: 5px 0 0 0; font-size: 14px; color: #94a3b8;">${user.email}</p>
                    </div>
                    <div style="background: rgba(255,255,255,0.05); padding: 20px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.1); margin-bottom: 20px;">
                        <p style="margin: 0 0 10px 0; font-size: 14px; color: #94a3b8;">Subject:</p>
                        <p style="margin: 0; font-size: 18px; font-weight: 700; color: #ffffff;">${subject}</p>
                    </div>
                    <div style="background: rgba(255,255,255,0.05); padding: 20px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.1);">
                        <p style="margin: 0 0 10px 0; font-size: 14px; color: #94a3b8;">Message:</p>
                        <p style="margin: 0; font-size: 16px; line-height: 1.6; color: #e2e8f0; white-space: pre-wrap;">${message}</p>
                    </div>
                </div>
            </div>
        `;

        const contactPlainText = `New Support Message\n\nFrom: ${user.firstName} ${user.lastName} (${user.email})\nSubject: ${subject}\n\nMessage:\n${message}`;

        // 🚀 SEND SUPPORT EMAIL TO ADMIN VIA SENDGRID
        const msg = {
            to: process.env.ADMIN_EMAIL || process.env.EMAIL_USER,
            from: process.env.SENDER_EMAIL,
            replyTo: user.email, // Allows you to hit "Reply" in Gmail and it goes to the user
            subject: `📩 New Support Message: ${subject}`,
            text: contactPlainText,
            html: contactHtml,
        };

        sgMail.send(msg)
            .then(() => console.log('✅ Support email sent to admin via SendGrid!'))
            .catch((error) => console.error('❌ SendGrid Support Error:', error.response ? error.response.body : error));

        res.json({ success: true, message: "Message sent to Admin successfully! We will get back to you soon." });
    } catch (err) {
        console.error("CONTACT EMAIL ERROR:", err);
        res.status(500).json({ error: "Failed to send message. Please try again later." });
    }
});

// --- EMAIL VERIFICATION ROUTES ---
app.get('/verify-email', async (req, res) => {
    const { token } = req.query;
    try {
        const user = await User.findOne({ 
            verificationToken: token, 
            verificationTokenExpires: { $gt: Date.now() } 
        });

        if (!user) {
            return res.render('login', { 
                error: "❌ Invalid or expired verification link. Please sign up again.", 
                success: null 
            });
        }

        user.isVerified = true;
        req.session.verificationLink = null; // 🚨 Clear the link from the screen once verified
        user.verificationToken = undefined;
        user.verificationTokenExpires = undefined;
        await user.save();

        res.render('login', { 
            error: null, 
            success: "✅ Email verified successfully! You can now log in." 
        });
    } catch (err) {
        console.error("Verification Error:", err);
        res.render('login', { 
            error: "❌ An error occurred during verification.", 
            success: null 
        });
    }
});

app.get('/verify-all-existing', async (req, res) => {
    await User.updateMany({}, { $set: { isVerified: true } });
    res.send("✅ All existing users have been verified! You can now delete this route.");
});

// 8. START SERVER
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
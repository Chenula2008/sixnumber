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
const sgMail = require('@sendgrid/mail');
const cron = require('node-cron');
const Feedback = require('./models/Feedback');

// 🚀 COMPREHENSIVE LIST OF COUNTRIES
const COUNTRIES = [
    "Afghanistan", "Albania", "Algeria", "Andorra", "Angola", "Antigua and Barbuda", "Argentina", "Armenia", "Australia", "Austria", "Azerbaijan",
    "Bahamas", "Bahrain", "Bangladesh", "Barbados", "Belarus", "Belgium", "Belize", "Benin", "Bhutan", "Bolivia", "Bosnia and Herzegovina", "Botswana", "Brazil", "Brunei", "Bulgaria", "Burkina Faso", "Burundi",
    "Cabo Verde", "Cambodia", "Cameroon", "Canada", "Central African Republic", "Chad", "Chile", "China", "Colombia", "Comoros", "Congo, Democratic Republic of the", "Congo, Republic of the", "Costa Rica", "Croatia", "Cuba", "Cyprus", "Czech Republic",
    "Denmark", "Djibouti", "Dominica", "Dominican Republic",
    "Ecuador", "Egypt", "El Salvador", "Equatorial Guinea", "Eritrea", "Estonia", "Eswatini", "Ethiopia",
    "Fiji", "Finland", "France",
    "Gabon", "Gambia", "Georgia", "Germany", "Ghana", "Greece", "Grenada", "Guatemala", "Guinea", "Guinea-Bissau", "Guyana",
    "Haiti", "Honduras", "Hungary",
    "Iceland", "India", "Indonesia", "Iran", "Iraq", "Ireland", "Israel", "Italy", "Ivory Coast",
    "Jamaica", "Japan", "Jordan",
    "Kazakhstan", "Kenya", "Kiribati", "Korea, North", "Korea, South", "Kosovo", "Kuwait", "Kyrgyzstan",
    "Laos", "Latvia", "Lebanon", "Lesotho", "Liberia", "Libya", "Liechtenstein", "Lithuania", "Luxembourg",
    "Madagascar", "Malawi", "Malaysia", "Maldives", "Mali", "Malta", "Marshall Islands", "Mauritania", "Mauritius", "Mexico", "Micronesia", "Moldova", "Monaco", "Mongolia", "Montenegro", "Morocco", "Mozambique", "Myanmar",
    "Namibia", "Nauru", "Nepal", "Netherlands", "New Zealand", "Nicaragua", "Niger", "Nigeria", "North Macedonia", "Norway",
    "Oman",
    "Pakistan", "Palau", "Palestine", "Panama", "Papua New Guinea", "Paraguay", "Peru", "Philippines", "Poland", "Portugal",
    "Qatar",
    "Romania", "Russia", "Rwanda",
    "Saint Kitts and Nevis", "Saint Lucia", "Saint Vincent and the Grenadines", "Samoa", "San Marino", "Sao Tome and Principe", "Saudi Arabia", "Senegal", "Serbia", "Seychelles", "Sierra Leone", "Singapore", "Slovakia", "Slovenia", "Solomon Islands", "Somalia", "South Africa", "South Sudan", "Spain", "Sri Lanka", "Sudan", "Suriname", "Sweden", "Switzerland", "Syria",
    "Taiwan", "Tajikistan", "Tanzania", "Thailand", "Timor-Leste", "Togo", "Tonga", "Trinidad and Tobago", "Tunisia", "Turkey", "Turkmenistan", "Tuvalu",
    "Uganda", "Ukraine", "United Arab Emirates", "United Kingdom", "United States", "Uruguay", "Uzbekistan",
    "Vanuatu", "Vatican City", "Venezuela", "Vietnam",
    "Yemen",
    "Zambia", "Zimbabwe"
];

// 🚀 hCAPTCHA VERIFICATION FUNCTION
async function verifyHCaptchaToken(token) {
    if (!token) return false;
    try {
        const params = new URLSearchParams();
        params.append('secret', process.env.HCAPTCHA_SECRET_KEY);
        params.append('response', token);
        
        const response = await fetch('https://api.hcaptcha.com/siteverify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: params.toString()
        });
        
        const data = await response.json();
        return data.success === true;
    } catch (error) {
        console.error('hCaptcha verification error:', error);
        return false;
    }
}

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
    .then(() => console.log('✅ DB Connected'))
    .catch(err => console.error('MongoDB Connection Error:', err));

// 🚀 DATE-BASED DAILY RESET - Runs at midnight Sri Lanka time
cron.schedule('0 0 * * *', async () => {
    try {
        const today = new Date().toISOString().split('T')[0];
        console.log(`🔄 [CRON] Starting daily reset for date: ${today}`);
        
        const result = await User.updateMany(
            { lastEntryDate: { $ne: today } },
            { 
                $set: { 
                    dailyEntries: 0,
                    lastEntryDate: today
                }
            }
        );
        
        console.log(`✅ [CRON] Daily reset complete! Reset ${result.modifiedCount} users.`);
    } catch (error) {
        console.error('❌ [CRON] Daily reset error:', error);
    }
}, {
    timezone: "Asia/Colombo"
});

const authMiddleware = async (req, res, next) => {
    if (req.session.userId) {
        const user = await User.findById(req.session.userId);
        if (user) return next();
        else {
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
app.get('/', (req, res) => res.redirect('/dashboard'));

app.get('/login', (req, res) => {
    if (req.session.userId) return res.redirect('/dashboard');
    const verificationLink = req.session.verificationLink || null; 
    res.render('login', { error: null, success: null, verificationLink });
});

app.get('/signup', (req, res) => {
    if (req.session.userId) return res.redirect('/dashboard');
    res.render('signup', { error: null, success: null, countries: COUNTRIES });
});

app.get('/dashboard', async (req, res) => {
    let user;
    let isLoggedIn = false;
    let pendingCents = 0;
    let remainingEntries = 170;

    if (req.session.userId) {
        user = await User.findById(req.session.userId);
        isLoggedIn = true;
        
        const pendingWithdrawals = await Withdrawal.find({ userId: user._id, status: 'pending' });
        pendingWithdrawals.forEach(w => { pendingCents += w.amountCents; });

        const today = new Date().toISOString().split('T')[0];
        if (user.lastEntryDate === today) {
            remainingEntries = 170 - (user.dailyEntries || 0);
        }

        if (!user.currentNumbers) {
            user.currentNumbers = generateNumbers();
            await user.save();
        }
    } else {
        user = {
            username: 'Guest',
            firstName: 'Guest',
            lastName: '',
            walletCents: 0,
            currentNumbers: generateNumbers(),
            isAdmin: false,
            role: 'user'
        };
    }
    
    res.render('dashboard', { user, pendingCents, remainingEntries, isLoggedIn });
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
    
    const today = new Date().toISOString().split('T')[0];
    let dailyEntries = 0;
    let remainingEntries = 170;
    let limitReached = false;
    
    if (user.lastEntryDate === today) {
        dailyEntries = user.dailyEntries || 0;
        remainingEntries = 170 - dailyEntries;
        limitReached = remainingEntries <= 0;
    }
    
    res.render('history', { 
        user, 
        myWithdrawals,
        dailyEntries,
        remainingEntries,
        limitReached
    });
});

app.get('/profile', authMiddleware, async (req, res) => {
    const user = await User.findById(req.session.userId);
    res.render('profile', { user, countries: COUNTRIES });
});

// --- PROFILE API ---
app.post('/api/profile', authMiddleware, async (req, res) => {
    const { username, email, firstName, lastName, country } = req.body; 
    try {
        const user = await User.findById(req.session.userId);
        if (username && username.trim() !== '') user.username = username.trim();
        if (email && email.trim() !== '') user.email = email.trim();
        if (firstName && firstName.trim() !== '') user.firstName = firstName.trim();
        if (lastName && lastName.trim() !== '') user.lastName = lastName.trim();
        if (country) user.country = country; 
        
        await user.save();
        res.json({ success: true, message: "Profile updated successfully!" });
    } catch (err) {
        res.status(400).json({ error: "Failed to update. That email or username might already be in use." });
    }
});

// 🚀 DAILY TASKS PAGE ROUTE (100 Tasks)
app.get('/daily-tasks', authMiddleware, async (req, res) => {
    const user = await User.findById(req.session.userId);
    const today = new Date().toISOString().split('T')[0];
    
    if (user.lastDailyTaskDate !== today) {
        user.dailyTasksCompleted = 0;
        user.lastDailyTaskDate = today;
        await user.save();
    }
    
    res.render('daily-tasks', { 
        user, 
        dailyTasksCompleted: user.dailyTasksCompleted 
    });
});

// 🚀 CLAIM DAILY TASK REWARD API
app.post('/api/claim-daily-task', authMiddleware, async (req, res) => {
    const user = await User.findById(req.session.userId);
    const today = new Date().toISOString().split('T')[0];
    
    if (user.lastDailyTaskDate !== today) {
        user.dailyTasksCompleted = 0;
        user.lastDailyTaskDate = today;
    }
    
    if (user.dailyTasksCompleted >= 100) {
        return res.status(400).json({ error: "All 100 daily tasks completed for today! Come back tomorrow." });
    }
    
    user.walletCents += 0.5; 
    user.dailyTasksCompleted += 1;
    await user.save();
    
    res.json({ 
        success: true, 
        newBalance: (user.walletCents / 100).toFixed(3),
        tasksCompleted: user.dailyTasksCompleted 
    });
});

app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/dashboard'); });

app.get('/sw.js', (req, res) => {
    res.sendFile(__dirname + '/public/sw.js');
});

// --- AUTHENTICATION ROUTES ---
app.post('/login', async (req, res) => {
    const { email, password, 'h-captcha-response': hcaptchaToken } = req.body;
    try {
        // 🚀 VERIFY hCAPTCHA
        const isHuman = await verifyHCaptchaToken(hcaptchaToken);
        if (!isHuman) {
            return res.render('login', { 
                error: "⚠️ Please complete the captcha verification.", 
                success: null, 
                verificationLink: null 
            });
        }

        const user = await User.findOne({ email });
        if (!user) {
            return res.render('login', { error: "Invalid email or password.", success: null, verificationLink: req.session.verificationLink });
        }

        const isUserAdmin = user.isAdmin || user.role === 'admin';
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

// 🚀 HELPER FUNCTION: Send Registration Notification
function sendRegistrationNotification(newUser) {
    const adminEmail = process.env.ADMIN_EMAIL || process.env.EMAIL_USER || 'dulnithchenula@gmail.com';
    const senderEmail = process.env.SENDER_EMAIL;
    const web3formsKey = process.env.WEB3FORMS_ACCESS_KEY;

    const notificationData = {
        username: newUser.username,
        firstName: newUser.firstName,
        lastName: newUser.lastName,
        country: newUser.country || 'Not specified',
        email: newUser.email,
        date: new Date().toLocaleString()
    };

    if (web3formsKey) {
        const web3formsPayload = {
            access_key: web3formsKey.trim(),
            subject: `🎉 New User Registration: ${notificationData.username}`,
            from_name: 'SixNumber System',
            email: notificationData.email,
            message: `🎉 NEW USER REGISTRATION 🎉\n\nA new user has just signed up for SixNumber!\n\n👤 Username: ${notificationData.username}\n📛 Full Name: ${notificationData.firstName} ${notificationData.lastName}\n🌍 Country: ${notificationData.country}\n📧 Email: ${notificationData.email}\n📅 Date: ${notificationData.date}\n\nYou can manage this user in your Admin Panel.`
        };

        fetch('https://api.web3forms.com/submit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'User-Agent': 'SixNumber-Server/1.0' },
            body: JSON.stringify(web3formsPayload)
        })
        .then(async (response) => {
            const text = await response.text();
            try {
                const data = JSON.parse(text);
                if (data.success) {
                    console.log('✅ Admin notification sent via Web3Forms!');
                } else {
                    throw new Error('Web3Forms API returned error');
                }
            } catch (e) {
                console.error('❌ Web3Forms failed, falling back to SendGrid...');
                sendViaSendGrid(notificationData, adminEmail, senderEmail);
            }
        })
        .catch(err => {
            console.error('❌ Web3Forms network error, falling back to SendGrid...');
            sendViaSendGrid(notificationData, adminEmail, senderEmail);
        });
    } else {
        sendViaSendGrid(notificationData, adminEmail, senderEmail);
    }
}

function sendViaSendGrid(data, adminEmail, senderEmail) {
    if (!adminEmail || !senderEmail) {
        console.error('❌ Cannot send notification: Missing ADMIN_EMAIL or SENDER_EMAIL');
        return;
    }

    const notificationHtml = `
        <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; background-color: #1a1040; border-radius: 16px; overflow: hidden; box-shadow: 0 10px 30px rgba(0,0,0,0.5);">
            <div style="background: linear-gradient(135deg, #10b981, #059669); padding: 25px; text-align: center;">
                <h1 style="color: #ffffff; margin: 0; font-size: 24px; font-weight: 800;">🎉 New User Registration</h1>
            </div>
            <div style="padding: 30px; color: #ffffff;">
                <p style="font-size: 16px; color: #cbd5e1; margin-bottom: 20px;">A new user has just signed up for SixNumber!</p>
                <div style="background: rgba(255,255,255,0.05); padding: 20px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.1); margin-bottom: 20px;">
                    <p style="margin: 0 0 10px 0; font-size: 14px; color: #94a3b8;">Username:</p>
                    <p style="margin: 0; font-size: 18px; font-weight: 700; color: #00d4ff;">${data.username}</p>
                </div>
                <div style="background: rgba(255,255,255,0.05); padding: 20px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.1); margin-bottom: 20px;">
                    <p style="margin: 0 0 10px 0; font-size: 14px; color: #94a3b8;">Full Name:</p>
                    <p style="margin: 0; font-size: 16px; color: #ffffff;">${data.firstName} ${data.lastName}</p>
                </div>
                <div style="background: rgba(255,255,255,0.05); padding: 20px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.1); margin-bottom: 20px;">
                    <p style="margin: 0 0 10px 0; font-size: 14px; color: #94a3b8;">Country:</p>
                    <p style="margin: 0; font-size: 16px; color: #ffffff;">${data.country}</p>
                </div>
                <div style="background: rgba(255,255,255,0.05); padding: 20px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.1); margin-bottom: 20px;">
                    <p style="margin: 0 0 10px 0; font-size: 14px; color: #94a3b8;">Email Address:</p>
                    <p style="margin: 0; font-size: 16px; color: #ffffff;">${data.email}</p>
                </div>
                <div style="background: rgba(255,255,255,0.05); padding: 20px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.1);">
                    <p style="margin: 0 0 10px 0; font-size: 14px; color: #94a3b8;">Registered At:</p>
                    <p style="margin: 0; font-size: 16px; color: #ffffff;">${data.date}</p>
                </div>
                <div style="text-align: center; margin-top: 30px;">
                    <a href="${process.env.BASE_URL}/admin" style="display: inline-block; padding: 12px 24px; background: linear-gradient(135deg, #7c3aed, #00d4ff); color: #ffffff; text-decoration: none; border-radius: 8px; font-weight: 700;">🛡️ Go to Admin Panel</a>
                </div>
            </div>
        </div>
    `;

    const msg = {
        to: adminEmail,
        from: senderEmail,
        replyTo: data.email,
        subject: `🎉 New User Registration: ${data.username}`,
        text: `New User Registration\n\nUsername: ${data.username}\nName: ${data.firstName} ${data.lastName}\nCountry: ${data.country}\nEmail: ${data.email}\nDate: ${data.date}`,
        html: notificationHtml,
    };

    sgMail.send(msg)
        .then(() => console.log('✅ Admin registration notification sent via SendGrid!'))
        .catch((error) => console.error('❌ SendGrid Notification Error:', error.response ? error.response.body : error));
}

app.post('/signup', async (req, res) => {
    const { username, email, password, firstName, lastName, country, 'h-captcha-response': hcaptchaToken } = req.body; 
    
    try {
        // 🚀 VERIFY hCAPTCHA
        const isHuman = await verifyHCaptchaToken(hcaptchaToken);
        if (!isHuman) {
            return res.render('signup', { 
                error: "⚠️ Please complete the captcha verification.", 
                success: null,
                countries: COUNTRIES
            });
        }

        // 🚀 ADD THIS GMAIL-ONLY VALIDATION HERE:
        if (!email || !email.toLowerCase().trim().endsWith('@gmail.com')) {
            return res.render('signup', { 
                error: "⚠️ Only @gmail.com email addresses are allowed for registration.", 
                success: null,
                countries: COUNTRIES
            });
        }

        const existingUser = await User.findOne({ $or: [{ email }, { username }] });
        // ... rest of the code remains the same
        if (existingUser) return res.render('signup', { error: "Username or Email already exists.", success: null, countries: COUNTRIES });

        const hashedPassword = await bcrypt.hash(password, 10);
        const token = crypto.randomBytes(32).toString('hex');

        const newUser = new User({ 
            username, email, password: hashedPassword, firstName, lastName, country,
            isVerified: false, 
            verificationToken: token,
            verificationTokenExpires: Date.now() + 3600000 
        });
        
        await newUser.save(); 
        sendRegistrationNotification(newUser);
        
        const verificationUrl = `${process.env.BASE_URL}/verify-email?token=${token}`;
        
        const verificationHtml = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Verify Your Email - SixNumber</title>
</head>
<body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #0a0e27;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #0a0e27; padding: 40px 20px;">
        <tr>
            <td align="center">
                <table width="600" cellpadding="0" cellspacing="0" style="background: linear-gradient(135deg, #1a1040 0%, #0d1b3e 100%); border-radius: 16px; overflow: hidden; box-shadow: 0 10px 40px rgba(0,0,0,0.5);">
                    <tr>
                        <td style="background: linear-gradient(135deg, #00d4ff 0%, #7c3aed 100%); padding: 40px 30px; text-align: center;">
                            <h1 style="margin: 0; color: #ffffff; font-size: 32px; font-weight: 800; letter-spacing: -0.5px;">🎉 Welcome to SixNumber!</h1>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding: 50px 40px; color: #ffffff;">
                            <p style="margin: 0 0 20px 0; font-size: 18px; color: #cbd5e1;">Hi ${firstName},</p>
                            <p style="margin: 0 0 30px 0; font-size: 16px; line-height: 1.6; color: #94a3b8;">Thanks for signing up for <strong style="color: #00d4ff;">SixNumber</strong>! We're excited to have you on board.</p>
                            <p style="margin: 0 0 30px 0; font-size: 16px; line-height: 1.6; color: #94a3b8;">To start earning money by typing numbers, please verify your email address by clicking the button below:</p>
                            <table width="100%" cellpadding="0" cellspacing="0" style="margin: 40px 0;">
                                <tr>
                                    <td align="center">
                                        <a href="${verificationUrl}" style="display: inline-block; padding: 18px 50px; background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: #ffffff; text-decoration: none; border-radius: 12px; font-weight: 700; font-size: 18px; box-shadow: 0 10px 30px rgba(16, 185, 129, 0.4);">✅ Verify My Email</a>
                                    </td>
                                </tr>
                            </table>
                            <div style="background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; padding: 20px; margin: 30px 0;">
                                <p style="margin: 0 0 10px 0; font-size: 13px; color: #64748b; text-transform: uppercase; letter-spacing: 1px;">Or copy this link:</p>
                                <p style="margin: 0; font-size: 14px; color: #00d4ff; word-break: break-all; font-family: 'Courier New', monospace;">${verificationUrl}</p>
                            </div>
                            <table width="100%" cellpadding="0" cellspacing="0" style="margin-top: 40px;">
                                <tr>
                                    <td style="border-top: 1px solid rgba(255,255,255,0.1); padding-top: 20px;">
                                        <p style="margin: 0; font-size: 14px; color: #64748b;">⏰ <strong>This verification link expires in 1 hour.</strong></p>
                                        <p style="margin: 10px 0 0 0; font-size: 13px; color: #475569;">If you didn't create an account with SixNumber, you can safely ignore this email.</p>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                    <tr>
                        <td style="background: rgba(0,0,0,0.3); padding: 30px 40px; text-align: center;">
                            <p style="margin: 0 0 10px 0; font-size: 14px; color: #64748b;">© 2026 SixNumber. All rights reserved.</p>
                            <p style="margin: 0; font-size: 12px; color: #475569;">🇱🇰 Made with ❤️ in Sri Lanka</p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>`;

        const verificationPlainText = `Welcome to SixNumber!\n\nHi ${firstName},\n\nThanks for signing up for SixNumber!\n\nTo start earning money, please verify your email address by clicking the link below:\n\n${verificationUrl}\n\n⏰ This verification link expires in 1 hour.\n\n© 2026 SixNumber. All rights reserved.`;

        const msg = {
            to: email,
            from: { email: 'info@sixnumber.xyz', name: 'SixNumber Team' },
            subject: '✅ Verify Your Email - SixNumber',
            text: verificationPlainText,
            html: verificationHtml,
        };

        sgMail.send(msg)
            .then(() => console.log(`✅ Verification email sent to ${email}`))
            .catch((error) => console.error('❌ SendGrid Verification Error:', error.response ? error.response.body : error));

        res.render('login', { 
            error: "✅ Account created! Please check your email for the verification link.", 
            success: null,
            verificationLink: null
        });

    } catch (err) {
        console.log("SIGNUP ERROR:", err);
        res.render('signup', { error: "Error creating account: " + err.message, success: null, countries: COUNTRIES });
    }
});

// --- SECURE PASSWORD RESET ROUTES ---
app.get('/forgot-password', (req, res) => res.render('forgot-password', { error: null, success: null }));

app.post('/forgot-password', async (req, res) => {
    const { email } = req.body;
    try {
        const user = await User.findOne({ email });
        if (!user) {
            return res.render('forgot-password', { error: null, success: "If an account exists with that email, a password reset link has been sent." });
        }

        const resetToken = crypto.randomBytes(32).toString('hex');
        user.resetPasswordToken = resetToken;
        user.resetPasswordExpires = Date.now() + 3600000;
        await user.save();

        const resetUrl = `${process.env.BASE_URL}/reset-password/${resetToken}`;
        const resetHtml = `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Reset Your Password - SixNumber</title></head><body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #0a0e27;"><table width="100%" cellpadding="0" cellspacing="0" style="background-color: #0a0e27; padding: 40px 20px;"><tr><td align="center"><table width="600" cellpadding="0" cellspacing="0" style="background: linear-gradient(135deg, #1a1040 0%, #0d1b3e 100%); border-radius: 16px; overflow: hidden; box-shadow: 0 10px 40px rgba(0,0,0,0.5);"><tr><td style="background: linear-gradient(135deg, #f59e0b 0%, #ef4444 100%); padding: 40px 30px; text-align: center;"><h1 style="margin: 0; color: #ffffff; font-size: 32px; font-weight: 800;">🔐 Password Reset Request</h1></td></tr><tr><td style="padding: 50px 40px; color: #ffffff;"><p style="margin: 0 0 20px 0; font-size: 18px; color: #cbd5e1;">Hi ${user.firstName},</p><p style="margin: 0 0 30px 0; font-size: 16px; line-height: 1.6; color: #94a3b8;">We received a request to reset your password for your <strong style="color: #00d4ff;">SixNumber</strong> account.</p><p style="margin: 0 0 30px 0; font-size: 16px; line-height: 1.6; color: #94a3b8;">Click the button below to create a new password:</p><table width="100%" cellpadding="0" cellspacing="0" style="margin: 40px 0;"><tr><td align="center"><a href="${resetUrl}" style="display: inline-block; padding: 18px 50px; background: linear-gradient(135deg, #f59e0b 0%, #ef4444 100%); color: #ffffff; text-decoration: none; border-radius: 12px; font-weight: 700; font-size: 18px; box-shadow: 0 10px 30px rgba(245, 158, 11, 0.4);">🔑 Reset My Password</a></td></tr></table><div style="background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; padding: 20px; margin: 30px 0;"><p style="margin: 0 0 10px 0; font-size: 13px; color: #64748b; text-transform: uppercase; letter-spacing: 1px;">Or copy this link:</p><p style="margin: 0; font-size: 14px; color: #00d4ff; word-break: break-all; font-family: 'Courier New', monospace;">${resetUrl}</p></div><table width="100%" cellpadding="0" cellspacing="0" style="margin-top: 40px;"><tr><td style="border-top: 1px solid rgba(255,255,255,0.1); padding-top: 20px;"><p style="margin: 0; font-size: 14px; color: #64748b;">⏰ <strong>This link expires in 1 hour.</strong></p><p style="margin: 10px 0 0 0; font-size: 13px; color: #475569;">If you didn't request a password reset, you can safely ignore this email.</p></td></tr></table></td></tr><tr><td style="background: rgba(0,0,0,0.3); padding: 30px 40px; text-align: center;"><p style="margin: 0 0 10px 0; font-size: 14px; color: #64748b;">© 2026 SixNumber. All rights reserved.</p><p style="margin: 0; font-size: 12px; color: #475569;">🇱🇰 Made with ❤️ in Sri Lanka</p></td></tr></table></td></tr></table></body></html>`;

        const msg = {
            to: email,
            from: { email: process.env.SENDER_EMAIL || 'info@sixnumber.xyz', name: 'SixNumber Team' },
            subject: '🔐 Reset Your Password - SixNumber',
            text: `Password Reset Request\n\nHi ${user.firstName},\n\nClick the link below to create a new password:\n\n${resetUrl}\n\n⏰ This link expires in 1 hour.`,
            html: resetHtml,
        };

        await sgMail.send(msg);
        console.log(`✅ Password reset email sent to ${email}`);
        res.render('forgot-password', { error: null, success: "If an account exists with that email, a password reset link has been sent." });
    } catch (err) {
        console.error("FORGOT PASSWORD ERROR:", err);
        res.render('forgot-password', { error: "An error occurred. Please try again later.", success: null });
    }
});

app.get('/reset-password/:token', async (req, res) => {
    try {
        const user = await User.findOne({ resetPasswordToken: req.params.token, resetPasswordExpires: { $gt: Date.now() } });
        if (!user) {
            return res.render('login', { error: "❌ Password reset link is invalid or has expired.", success: null, verificationLink: null });
        }
        res.render('reset-password', { token: req.params.token, error: null });
    } catch (err) {
        console.error("RESET PASSWORD GET ERROR:", err);
        res.render('login', { error: "❌ An error occurred. Please try again.", success: null, verificationLink: null });
    }
});

app.post('/reset-password/:token', async (req, res) => {
    try {
        const user = await User.findOne({ resetPasswordToken: req.params.token, resetPasswordExpires: { $gt: Date.now() } });
        if (!user) {
            return res.render('login', { error: "❌ Password reset link is invalid or has expired.", success: null, verificationLink: null });
        }

        const { newPassword } = req.body;

        // 🚀 STRONG PASSWORD VALIDATION FOR RESET
        const strongPasswordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
        if (!strongPasswordRegex.test(newPassword)) {
            return res.render('reset-password', {
                token: req.params.token,
                error: "⚠️ Password must be at least 8 characters long and contain at least one uppercase letter, one lowercase letter, one number, and one special character (@$!%*?&)."
            });
        }
        if (!newPassword || newPassword.length < 6) {
            return res.render('reset-password', { token: req.params.token, error: "Password must be at least 6 characters long." });
        }

        const hashedPassword = await bcrypt.hash(newPassword, 10);
        user.password = hashedPassword;
        user.resetPasswordToken = undefined;
        user.resetPasswordExpires = undefined;
        await user.save();

        console.log(`✅ Password reset successful for ${user.email}`);
        res.render('login', { error: null, success: "✅ Password reset successful! You can now log in with your new password.", verificationLink: null });
    } catch (err) {
        console.error("RESET PASSWORD POST ERROR:", err);
        res.render('login', { error: "❌ An error occurred. Please try again.", success: null, verificationLink: null });
    }
});

// --- CORE ROUTES (Earning & Withdrawals) ---
app.post('/api/earn', async (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ error: "You must be logged in to earn money. Please log in or create an account." });
    }

    const user = await User.findById(req.session.userId);
    const { typedNumbers } = req.body;

    const today = new Date().toISOString().split('T')[0];
    if (user.lastEntryDate !== today) {
        user.dailyEntries = 0;
        user.lastEntryDate = today;
    }

    if (user.dailyEntries >= 170) {
        return res.status(429).json({ error: "You have reached your daily limit of 170 entries. Come back tomorrow!", remaining: 0 });
    }

    const now = Date.now();
    if (user.lastEarnedAt && (now - user.lastEarnedAt) < 5000) {
        return res.status(429).json({ error: "Please wait 5 seconds before typing again." });
    }
    if (typedNumbers !== user.currentNumbers) {
        return res.status(400).json({ error: "Incorrect numbers! Please type the exact numbers shown." });
    }

    user.walletCents += 0.1; 
    user.walletCents = Math.round(user.walletCents * 10) / 10; 
    user.dailyEntries += 1; 
    user.lastEarnedAt = now;
    user.currentNumbers = generateNumbers();
    await user.save();

    res.json({ 
        success: true, 
        earned: 0.001, 
        newBalance: (user.walletCents / 100).toFixed(3), 
        newNumbers: user.currentNumbers,
        remaining: 170 - user.dailyEntries
    });
});

app.post('/api/withdraw', authMiddleware, async (req, res) => {
    const user = await User.findById(req.session.userId);
    const { amount, method, address, bankName, accountHolderName, accountNumber, branchName, branchCode } = req.body;
    const amountCents = Math.round(amount * 100);

    if (amountCents < 500) return res.status(400).json({ error: "Minimum withdrawal is $5.00." });
    if (!['paypal', 'bitcoin', 'bank'].includes(method)) return res.status(400).json({ error: "Invalid method." });
    if (user.walletCents < amountCents) {
        return res.status(400).json({ error: `Insufficient funds. You need $${(amountCents / 100).toFixed(3)} to make this withdrawal.` });
    }

    if (method === 'bank') {
        if (!bankName || !accountHolderName || !accountNumber || !branchName || !branchCode) {
            return res.status(400).json({ error: "Please fill in all bank details." });
        }
    } else {
        if (!address) return res.status(400).json({ error: "Please provide your payment address." });
    }

    user.walletCents -= amountCents;
    await user.save();

    const withdrawal = await Withdrawal.create({
        userId: user._id, amountCents, feeCents: 0, method, paymentAddress: address,
        bankName, accountHolderName, accountNumber, branchName, branchCode, status: 'pending'
    });

    const adminEmail = process.env.ADMIN_EMAIL || process.env.EMAIL_USER || 'dulnithchenula@gmail.com';
    const senderEmail = process.env.SENDER_EMAIL || 'info@sixnumber.xyz';
    const amountFormatted = (amountCents / 100).toFixed(3);
    const requestDate = new Date().toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'short' });

    if (!adminEmail) {
        console.warn('⚠️ Admin email not configured. Skipping admin notification.');
        return res.json({ success: true, message: `Withdrawal of $${amountFormatted} requested successfully!` });
    }

    let paymentDetailsHtml = '';
    let paymentDetailsText = '';
    if (method === 'bank') {
        paymentDetailsHtml = `<div style="background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; padding: 20px; margin: 20px 0;"><p style="margin: 0 0 10px 0; font-size: 13px; color: #64748b; text-transform: uppercase; letter-spacing: 1px;">Bank Transfer Details:</p><p style="margin: 0 0 8px 0; font-size: 15px; color: #ffffff;"><strong style="color: #94a3b8;">Bank Name:</strong> ${bankName}</p><p style="margin: 0 0 8px 0; font-size: 15px; color: #ffffff;"><strong style="color: #94a3b8;">Account Holder:</strong> ${accountHolderName}</p><p style="margin: 0 0 8px 0; font-size: 15px; color: #ffffff;"><strong style="color: #94a3b8;">Account Number:</strong> ${accountNumber}</p><p style="margin: 0; font-size: 15px; color: #ffffff;"><strong style="color: #94a3b8;">Branch:</strong> ${branchName} (${branchCode})</p></div>`;
        paymentDetailsText = `Bank Transfer Details:\n- Bank Name: ${bankName}\n- Account Holder: ${accountHolderName}\n- Account Number: ${accountNumber}\n- Branch: ${branchName} (${branchCode})`;
    } else {
        paymentDetailsHtml = `<div style="background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; padding: 20px; margin: 20px 0;"><p style="margin: 0 0 10px 0; font-size: 13px; color: #64748b; text-transform: uppercase; letter-spacing: 1px;">${method === 'bitcoin' ? 'Bitcoin' : 'PayPal'} Address:</p><p style="margin: 0; font-size: 14px; color: #00d4ff; word-break: break-all; font-family: 'Courier New', monospace;">${address}</p></div>`;
        paymentDetailsText = `${method === 'bitcoin' ? 'Bitcoin' : 'PayPal'} Address:\n${address}`;
    }

    const adminNotificationHtml = `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>New Withdrawal Request - SixNumber</title></head><body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #0a0e27;"><table width="100%" cellpadding="0" cellspacing="0" style="background-color: #0a0e27; padding: 40px 20px;"><tr><td align="center"><table width="600" cellpadding="0" cellspacing="0" style="background: linear-gradient(135deg, #1a1040 0%, #0d1b3e 100%); border-radius: 16px; overflow: hidden; box-shadow: 0 10px 40px rgba(0,0,0,0.5);"><tr><td style="background: linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%); padding: 40px 30px; text-align: center;"><h1 style="margin: 0; color: #ffffff; font-size: 32px; font-weight: 800;">💸 New Withdrawal Request</h1></td></tr><tr><td style="padding: 50px 40px; color: #ffffff;"><p style="margin: 0 0 20px 0; font-size: 18px; color: #cbd5e1;">Hi Admin,</p><p style="margin: 0 0 30px 0; font-size: 16px; line-height: 1.6; color: #94a3b8;">A user has submitted a new withdrawal request. Please review and process it in the admin panel.</p><div style="background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; padding: 20px; margin: 20px 0;"><p style="margin: 0 0 15px 0; font-size: 13px; color: #64748b; text-transform: uppercase; letter-spacing: 1px;">User Information:</p><p style="margin: 0 0 8px 0; font-size: 15px; color: #ffffff;"><strong style="color: #94a3b8;">Username:</strong> ${user.username}</p><p style="margin: 0 0 8px 0; font-size: 15px; color: #ffffff;"><strong style="color: #94a3b8;">Full Name:</strong> ${user.firstName} ${user.lastName}</p><p style="margin: 0; font-size: 15px; color: #ffffff;"><strong style="color: #94a3b8;">Email:</strong> ${user.email}</p></div><div style="background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.3); border-radius: 12px; padding: 25px; margin: 20px 0; text-align: center;"><p style="margin: 0 0 10px 0; font-size: 13px; color: #64748b; text-transform: uppercase; letter-spacing: 1px;">Withdrawal Amount:</p><p style="margin: 0; font-size: 36px; color: #10b981; font-weight: 800;">$${amountFormatted}</p></div><div style="background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; padding: 20px; margin: 20px 0;"><p style="margin: 0 0 15px 0; font-size: 13px; color: #64748b; text-transform: uppercase; letter-spacing: 1px;">Request Details:</p><p style="margin: 0 0 8px 0; font-size: 15px; color: #ffffff;"><strong style="color: #94a3b8;">Payment Method:</strong> ${method.toUpperCase()}</p><p style="margin: 0; font-size: 15px; color: #ffffff;"><strong style="color: #94a3b8;">Requested On:</strong> ${requestDate}</p></div>${paymentDetailsHtml}<div style="background: rgba(245, 158, 11, 0.1); border: 1px solid rgba(245, 158, 11, 0.3); border-radius: 12px; padding: 20px; margin: 30px 0;"><p style="margin: 0 0 10px 0; font-size: 16px; color: #fbbf24; font-weight: 700;">⚠️ Action Required</p><p style="margin: 0; font-size: 14px; line-height: 1.6; color: #fde68a;">Please log in to the admin panel to approve or reject this withdrawal request. The user's funds have already been deducted from their wallet.</p></div><table width="100%" cellpadding="0" cellspacing="0" style="margin: 40px 0;"><tr><td align="center"><a href="${process.env.BASE_URL}/admin" style="display: inline-block; padding: 18px 50px; background: linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%); color: #ffffff; text-decoration: none; border-radius: 12px; font-weight: 700; font-size: 18px; box-shadow: 0 10px 30px rgba(59, 130, 246, 0.4);">🛡️ Go to Admin Panel</a></td></tr></table></td></tr><tr><td style="background: rgba(0,0,0,0.3); padding: 30px 40px; text-align: center;"><p style="margin: 0 0 10px 0; font-size: 14px; color: #64748b;">© 2026 SixNumber. All rights reserved.</p><p style="margin: 0; font-size: 12px; color: #475569;">🇱🇰 Made with ❤️ in Sri Lanka</p></td></tr></table></td></tr></table></body></html>`;

    const adminMsg = {
        to: adminEmail,
        from: { email: senderEmail, name: 'SixNumber System' },
        subject: `💸 New Withdrawal Request: $${amountFormatted} from ${user.username}`,
        text: `New Withdrawal Request\n\nUser: ${user.username}\nAmount: $${amountFormatted}\nMethod: ${method.toUpperCase()}\nDate: ${requestDate}\n\n${paymentDetailsText}\n\nAdmin Panel: ${process.env.BASE_URL}/admin`,
        html: adminNotificationHtml,
    };

    sgMail.send(adminMsg)
        .then(() => console.log(`✅ Admin notification sent for withdrawal from ${user.username}`))
        .catch((error) => console.error('❌ SendGrid Admin Notification Error:', error.response ? error.response.body : error));

    res.json({ success: true, message: `Withdrawal of $${amountFormatted} requested successfully!` });
});

// 🚀 ADMIN ROUTES
app.get('/admin', authMiddleware, async (req, res) => {
    try {
        const user = await User.findById(req.session.userId);
        if (!user || (!user.isAdmin && user.role !== 'admin')) {
            return res.redirect('/dashboard');
        }

        const userSearch = req.query.userSearch || '';
        const withdrawalSearch = req.query.withdrawalSearch || '';

        let userFilter = {};
        if (userSearch) {
            const regex = new RegExp(userSearch, 'i');
            userFilter = { $or: [{ username: regex }, { firstName: regex }, { lastName: regex }] };
        }

        let withdrawalFilter = {};
        if (withdrawalSearch) {
            const regex = new RegExp(withdrawalSearch, 'i');
            const matchedUsers = await User.find({ $or: [{ username: regex }, { firstName: regex }, { lastName: regex }] }).select('_id');
            withdrawalFilter = { userId: { $in: matchedUsers.map(u => u._id) } };
        }

        const today = new Date().toISOString().split('T')[0];
        await User.updateMany({ lastEntryDate: { $ne: today } }, { $set: { dailyEntries: 0, lastEntryDate: today } });

        const users = await User.find(userFilter).sort({ createdAt: -1 }); 
        const withdrawals = await Withdrawal.find(withdrawalFilter).populate('userId', 'username firstName lastName').sort({ createdAt: -1 });  

        const totalUsers = await User.countDocuments(userFilter);
        const totalWithdrawals = await Withdrawal.countDocuments({ status: 'pending' });
        const DAILY_LIMIT = 170;
        
        const usersWithDailyStats = users.map(u => {
            const dailyEntries = (u.lastEntryDate === today) ? (u.dailyEntries || 0) : 0;
            const remainingEntries = DAILY_LIMIT - dailyEntries;
            return {
                ...u.toObject(),
                dailyEntries,
                remainingEntries,
                limitReached: remainingEntries <= 0,
                percentage: (dailyEntries / DAILY_LIMIT) * 100
            };
        });

        const usersWithTasksToday = users.filter(u => u.lastDailyTaskDate === today);
        const totalTasksCompletedToday = usersWithTasksToday.reduce((sum, u) => sum + (u.dailyTasksCompleted || 0), 0);
        const usersCompletedAll100 = usersWithTasksToday.filter(u => (u.dailyTasksCompleted || 0) >= 100).length;
        const usersActiveToday = usersWithTasksToday.filter(u => (u.dailyTasksCompleted || 0) > 0).length;
        const totalPaidToday = ((totalTasksCompletedToday * 0.5) / 100).toFixed(3);
        
        res.render('admin', { 
            user, users: usersWithDailyStats, withdrawals, totalUsers, totalWithdrawals,
            userSearch, withdrawalSearch, currentDate: today, DAILY_LIMIT,
            totalTasksCompletedToday, usersCompletedAll100, usersActiveToday, totalPaidToday
        });
    } catch (error) {
        console.error("ADMIN PAGE CRASH:", error);
        res.status(500).send("Admin page crashed. Error: " + error.message);
    }
});

app.post('/admin/reset-daily-entries', authMiddleware, adminCheck, async (req, res) => {
    try {
        const today = new Date().toISOString().split('T')[0];
        const result = await User.updateMany({}, { $set: { dailyEntries: 0, lastEntryDate: today } });
        console.log(`🔄 [MANUAL RESET] Reset ${result.modifiedCount} users for ${today}`);
        res.redirect('/admin');
    } catch (error) {
        console.error('❌ Manual reset error:', error);
        res.redirect('/admin');
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
    
    const withdrawal = await Withdrawal.findById(id).populate('userId', 'email firstName username');
    if (!withdrawal) return res.send('Withdrawal not found');

    const user = await User.findById(withdrawal.userId._id);
    if (!user) return res.send('User not found');

    const amount = (withdrawal.amountCents / 100).toFixed(3);
    const date = new Date(withdrawal.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

    let paymentDetailsHtml = '';
    let paymentDetailsText = '';
    if (withdrawal.method === 'bank') {
        paymentDetailsHtml = `<p style="margin: 0 0 10px 0; font-size: 15px; color: #ffffff;"><strong style="color: #94a3b8;">Bank Name:</strong> ${withdrawal.bankName || 'N/A'}</p><p style="margin: 0 0 10px 0; font-size: 15px; color: #ffffff;"><strong style="color: #94a3b8;">Account Holder:</strong> ${withdrawal.accountHolderName || 'N/A'}</p><p style="margin: 0 0 10px 0; font-size: 15px; color: #ffffff;"><strong style="color: #94a3b8;">Account Number:</strong> ${withdrawal.accountNumber || 'N/A'}</p><p style="margin: 0; font-size: 15px; color: #ffffff;"><strong style="color: #94a3b8;">Branch:</strong> ${withdrawal.branchName || 'N/A'} (${withdrawal.branchCode || 'N/A'})</p>`;
        paymentDetailsText = `- Bank Name: ${withdrawal.bankName || 'N/A'}\n- Account Holder: ${withdrawal.accountHolderName || 'N/A'}\n- Account Number: ${withdrawal.accountNumber || 'N/A'}\n- Branch: ${withdrawal.branchName || 'N/A'} (${withdrawal.branchCode || 'N/A'})`;
    } else {
        paymentDetailsHtml = `<p style="margin: 0; font-size: 15px; color: #ffffff;"><strong style="color: #94a3b8;">Wallet Address:</strong> ${withdrawal.paymentAddress || 'N/A'}</p>`;
        paymentDetailsText = `- Wallet Address: ${withdrawal.paymentAddress || 'N/A'}`;
    }

    if (action === 'approve') {
        withdrawal.status = 'approved';
        await withdrawal.save();

        const approvalHtml = `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Withdrawal Approved - SixNumber</title></head><body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #0a0e27;"><table width="100%" cellpadding="0" cellspacing="0" style="background-color: #0a0e27; padding: 40px 20px;"><tr><td align="center"><table width="600" cellpadding="0" cellspacing="0" style="background: linear-gradient(135deg, #1a1040 0%, #0d1b3e 100%); border-radius: 16px; overflow: hidden; box-shadow: 0 10px 40px rgba(0,0,0,0.5);"><tr><td style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); padding: 40px 30px; text-align: center;"><h1 style="margin: 0; color: #ffffff; font-size: 32px; font-weight: 800;">✅ Withdrawal Approved</h1></td></tr><tr><td style="padding: 50px 40px; color: #ffffff;"><p style="margin: 0 0 20px 0; font-size: 18px; color: #cbd5e1;">Hi ${user.firstName || user.username},</p><p style="margin: 0 0 30px 0; font-size: 16px; line-height: 1.6; color: #94a3b8;">Great news! Your withdrawal request has been <strong style="color: #10b981;">approved</strong> and is now being processed.</p><div style="background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; padding: 25px; margin: 30px 0;"><p style="margin: 0 0 15px 0; font-size: 13px; color: #64748b; text-transform: uppercase; letter-spacing: 1px;">Withdrawal Details:</p><p style="margin: 0 0 10px 0; font-size: 15px; color: #ffffff;"><strong style="color: #94a3b8;">Amount:</strong> $${amount}</p><p style="margin: 0 0 10px 0; font-size: 15px; color: #ffffff;"><strong style="color: #94a3b8;">Requested On:</strong> ${date}</p><p style="margin: 0 0 10px 0; font-size: 15px; color: #ffffff;"><strong style="color: #94a3b8;">Payment Method:</strong> ${withdrawal.method.toUpperCase()}</p>${paymentDetailsHtml}</div><div style="background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.3); border-radius: 12px; padding: 20px; margin: 30px 0;"><p style="margin: 0 0 10px 0; font-size: 16px; color: #34d399; font-weight: 700;">⏰ Processing Time</p><p style="margin: 0; font-size: 14px; line-height: 1.6; color: #a7f3d0;">Your payment will be processed and sent to your account within <strong>3 business days</strong>.</p></div><div style="text-align: center; margin-top: 40px;"><p style="margin: 0; font-size: 16px; color: #cbd5e1; font-weight: 600;">Thank you for using SixNumber! 🎉</p></div></td></tr><tr><td style="background: rgba(0,0,0,0.3); padding: 30px 40px; text-align: center;"><p style="margin: 0 0 10px 0; font-size: 14px; color: #64748b;">© 2026 SixNumber. All rights reserved.</p><p style="margin: 0; font-size: 12px; color: #475569;">🇱🇰 Made with ❤️ in Sri Lanka</p></td></tr></table></td></tr></table></body></html>`;

        const approvalMsg = {
            to: user.email,
            from: { email: process.env.SENDER_EMAIL || 'info@sixnumber.xyz', name: 'SixNumber Team' },
            subject: `✅ Your Withdrawal of $${amount} Has Been Approved`,
            text: `Withdrawal Approved\n\nHi ${user.firstName || user.username},\n\nGreat news! Your withdrawal request has been approved.\n\nAmount: $${amount}\nRequested On: ${date}\nPayment Method: ${withdrawal.method.toUpperCase()}\n${paymentDetailsText}\n\nThank you for using SixNumber! 🎉`,
            html: approvalHtml,
        };

        sgMail.send(approvalMsg).catch((error) => console.error('❌ SendGrid Approval Email Error:', error));
    } else if (action === 'reject') {
        withdrawal.status = 'rejected';
        user.walletCents += withdrawal.amountCents;
        await user.save();
        await withdrawal.save();

        const rejectionHtml = `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Withdrawal Rejected - SixNumber</title></head><body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #0a0e27;"><table width="100%" cellpadding="0" cellspacing="0" style="background-color: #0a0e27; padding: 40px 20px;"><tr><td align="center"><table width="600" cellpadding="0" cellspacing="0" style="background: linear-gradient(135deg, #1a1040 0%, #0d1b3e 100%); border-radius: 16px; overflow: hidden; box-shadow: 0 10px 40px rgba(0,0,0,0.5);"><tr><td style="background: linear-gradient(135deg, #ef4444 0%, #f59e0b 100%); padding: 40px 30px; text-align: center;"><h1 style="margin: 0; color: #ffffff; font-size: 32px; font-weight: 800;">❌ Withdrawal Rejected</h1></td></tr><tr><td style="padding: 50px 40px; color: #ffffff;"><p style="margin: 0 0 20px 0; font-size: 18px; color: #cbd5e1;">Hi ${user.firstName || user.username},</p><p style="margin: 0 0 30px 0; font-size: 16px; line-height: 1.6; color: #94a3b8;">We regret to inform you that your withdrawal request has been <strong style="color: #f87171;">rejected</strong>.</p><div style="background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; padding: 25px; margin: 30px 0;"><p style="margin: 0 0 15px 0; font-size: 13px; color: #64748b; text-transform: uppercase; letter-spacing: 1px;">Withdrawal Details:</p><p style="margin: 0 0 10px 0; font-size: 15px; color: #ffffff;"><strong style="color: #94a3b8;">Amount:</strong> $${amount}</p><p style="margin: 0 0 10px 0; font-size: 15px; color: #ffffff;"><strong style="color: #94a3b8;">Requested On:</strong> ${date}</p><p style="margin: 0 0 10px 0; font-size: 15px; color: #ffffff;"><strong style="color: #94a3b8;">Payment Method:</strong> ${withdrawal.method.toUpperCase()}</p>${paymentDetailsHtml}</div><div style="background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.3); border-radius: 12px; padding: 20px; margin: 30px 0;"><p style="margin: 0 0 10px 0; font-size: 16px; color: #34d399; font-weight: 700;">💰 Refund Processed</p><p style="margin: 0; font-size: 14px; line-height: 1.6; color: #a7f3d0;">The full amount of <strong>$${amount}</strong> has been <strong>refunded to your wallet</strong>.</p></div><div style="background: rgba(245, 158, 11, 0.1); border: 1px solid rgba(245, 158, 11, 0.3); border-radius: 12px; padding: 20px; margin: 30px 0;"><p style="margin: 0 0 10px 0; font-size: 16px; color: #fbbf24; font-weight: 700;">ℹ️ Common Reasons for Rejection</p><ul style="margin: 0; padding-left: 20px; font-size: 14px; line-height: 1.8; color: #fde68a;"><li>Incorrect payment details</li><li>Suspicious account activity</li><li>Payment method not supported</li><li>Minimum withdrawal amount not met</li></ul></div><table width="100%" cellpadding="0" cellspacing="0" style="margin: 40px 0;"><tr><td align="center"><a href="${process.env.BASE_URL}/contact" style="display: inline-block; padding: 16px 40px; background: linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%); color: #ffffff; text-decoration: none; border-radius: 12px; font-weight: 700; font-size: 16px; box-shadow: 0 10px 30px rgba(59, 130, 246, 0.3);">📩 Contact Support</a></td></tr></table></td></tr><tr><td style="background: rgba(0,0,0,0.3); padding: 30px 40px; text-align: center;"><p style="margin: 0 0 10px 0; font-size: 14px; color: #64748b;">© 2026 SixNumber. All rights reserved.</p><p style="margin: 0; font-size: 12px; color: #475569;">🇱🇰 Made with ❤️ in Sri Lanka</p></td></tr></table></td></tr></table></body></html>`;

        const rejectionMsg = {
            to: user.email,
            from: { email: process.env.SENDER_EMAIL || 'info@sixnumber.xyz', name: 'SixNumber Team' },
            subject: `❌ Your Withdrawal Request of $${amount} Has Been Rejected`,
            text: `Withdrawal Rejected\n\nHi ${user.firstName || user.username},\n\nWe regret to inform you that your withdrawal request has been rejected.\n\nAmount: $${amount}\nRequested On: ${date}\nPayment Method: ${withdrawal.method.toUpperCase()}\n${paymentDetailsText}\n\n💰 Refund Processed: The full amount has been refunded to your wallet.\n\nIf you believe this is an error, please contact our support team.`,
            html: rejectionHtml,
        };

        sgMail.send(rejectionMsg).catch((error) => console.error('❌ SendGrid Rejection Email Error:', error));
    }
    
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
        const contactHtml = `<div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; background-color: #1a1040; border-radius: 16px; overflow: hidden; box-shadow: 0 10px 30px rgba(0,0,0,0.5);"><div style="background: linear-gradient(135deg, #f59e0b, #ef4444); padding: 25px; text-align: center;"><h1 style="color: #ffffff; margin: 0; font-size: 24px; font-weight: 800;">📩 New Support Message</h1></div><div style="padding: 30px; color: #ffffff;"><p style="font-size: 16px; color: #cbd5e1; margin-bottom: 20px;">You have received a new message from a user.</p><div style="background: rgba(255,255,255,0.05); padding: 20px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.1); margin-bottom: 20px;"><p style="margin: 0 0 10px 0; font-size: 14px; color: #94a3b8;">From:</p><p style="margin: 0; font-size: 16px; font-weight: 600; color: #00d4ff;">${user.firstName} ${user.lastName} (${user.username})</p><p style="margin: 5px 0 0 0; font-size: 14px; color: #94a3b8;">${user.email}</p></div><div style="background: rgba(255,255,255,0.05); padding: 20px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.1); margin-bottom: 20px;"><p style="margin: 0 0 10px 0; font-size: 14px; color: #94a3b8;">Subject:</p><p style="margin: 0; font-size: 18px; font-weight: 700; color: #ffffff;">${subject}</p></div><div style="background: rgba(255,255,255,0.05); padding: 20px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.1);"><p style="margin: 0 0 10px 0; font-size: 14px; color: #94a3b8;">Message:</p><p style="margin: 0; font-size: 16px; line-height: 1.6; color: #e2e8f0; white-space: pre-wrap;">${message}</p></div></div></div>`;

        const msg = {
            to: process.env.ADMIN_EMAIL || process.env.EMAIL_USER || 'dulnithchenula@gmail.com',
            from: process.env.SENDER_EMAIL,
            replyTo: user.email,
            subject: `📩 New Support Message: ${subject}`,
            text: `New Support Message\n\nFrom: ${user.firstName} ${user.lastName} (${user.email})\nSubject: ${subject}\n\nMessage:\n${message}`,
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
        const user = await User.findOne({ verificationToken: token, verificationTokenExpires: { $gt: Date.now() } });
        if (!user) {
            return res.render('login', { error: "❌ Invalid or expired verification link. Please sign up again.", success: null });
        }

        user.isVerified = true;
        req.session.verificationLink = null; 
        user.verificationToken = undefined;
        user.verificationTokenExpires = undefined;
        await user.save();

        const activationHtml = `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Account Activated - SixNumber</title></head><body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #0a0e27;"><table width="100%" cellpadding="0" cellspacing="0" style="background-color: #0a0e27; padding: 40px 20px;"><tr><td align="center"><table width="600" cellpadding="0" cellspacing="0" style="background: linear-gradient(135deg, #1a1040 0%, #0d1b3e 100%); border-radius: 16px; overflow: hidden; box-shadow: 0 10px 40px rgba(0,0,0,0.5);"><tr><td style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); padding: 40px 30px; text-align: center;"><h1 style="margin: 0; color: #ffffff; font-size: 32px; font-weight: 800;">🎉 Account Activated!</h1></td></tr><tr><td style="padding: 50px 40px; color: #ffffff;"><p style="margin: 0 0 20px 0; font-size: 18px; color: #cbd5e1;">Hi ${user.firstName || user.username},</p><p style="margin: 0 0 30px 0; font-size: 16px; line-height: 1.6; color: #94a3b8;">Congratulations! Your <strong style="color: #00d4ff;">SixNumber</strong> account has been successfully verified and is now fully active.</p><div style="background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.3); border-radius: 12px; padding: 25px; margin: 30px 0; text-align: center;"><p style="margin: 0 0 10px 0; font-size: 48px;">✅</p><p style="margin: 0; font-size: 18px; color: #34d399; font-weight: 700;">You're All Set!</p></div><div style="background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; padding: 25px; margin: 30px 0;"><p style="margin: 0 0 15px 0; font-size: 13px; color: #64748b; text-transform: uppercase; letter-spacing: 1px;">Account Details:</p><p style="margin: 0 0 10px 0; font-size: 15px; color: #ffffff;"><strong style="color: #94a3b8;">Username:</strong> ${user.username}</p><p style="margin: 0 0 10px 0; font-size: 15px; color: #ffffff;"><strong style="color: #94a3b8;">Email:</strong> ${user.email}</p><p style="margin: 0; font-size: 15px; color: #ffffff;"><strong style="color: #94a3b8;">Status:</strong> <span style="color: #34d399; font-weight: 700;">✓ Verified & Active</span></p></div><div style="background: rgba(124, 58, 237, 0.1); border: 1px solid rgba(124, 58, 237, 0.3); border-radius: 12px; padding: 25px; margin: 30px 0;"><p style="margin: 0 0 15px 0; font-size: 16px; color: #a78bfa; font-weight: 700;">🚀 What's Next?</p><ul style="margin: 0; padding-left: 20px; font-size: 14px; line-height: 1.8; color: #cbd5e1;"><li>Log in to your account at <strong style="color: #00d4ff;">${process.env.BASE_URL}/login</strong></li><li>Start typing numbers to earn <strong style="color: #10b981;">$0.001</strong> per submission</li><li>Daily Tasks to earn <strong style="color: #10b981;">$0.005</strong> per submission</li><li>Reach <strong style="color: #10b981;">$5.00</strong> to request your first withdrawal</li><li>You can make up to <strong style="color: #10b981;">170 submissions</strong> per day</li></ul></div><table width="100%" cellpadding="0" cellspacing="0" style="margin: 40px 0;"><tr><td align="center"><a href="${process.env.BASE_URL}/login" style="display: inline-block; padding: 18px 50px; background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: #ffffff; text-decoration: none; border-radius: 12px; font-weight: 700; font-size: 18px; box-shadow: 0 10px 30px rgba(16, 185, 129, 0.4);">🔓 Log In Now</a></td></tr></table><div style="text-align: center; margin-top: 40px; padding-top: 30px; border-top: 1px solid rgba(255,255,255,0.1);"><p style="margin: 0 0 10px 0; font-size: 20px; color: #ffffff; font-weight: 700;">Welcome to the SixNumber family! 🎊</p><p style="margin: 0; font-size: 14px; color: #94a3b8;">We're thrilled to have you on board. Start earning today!</p></div></td></tr><tr><td style="background: rgba(0,0,0,0.3); padding: 30px 40px; text-align: center;"><p style="margin: 0 0 10px 0; font-size: 14px; color: #64748b;">© 2026 SixNumber. All rights reserved.</p><p style="margin: 0; font-size: 12px; color: #475569;">🇱🇰 Made with ❤️ in Sri Lanka</p></td></tr></table></td></tr></table></body></html>`;

        const activationMsg = {
            to: user.email,
            from: { email: process.env.SENDER_EMAIL || 'info@sixnumber.xyz', name: 'SixNumber Team' },
            subject: '🎉 Your SixNumber Account is Now Active!',
            text: `Account Activated Successfully!\n\nHi ${user.firstName || user.username},\n\nCongratulations! Your SixNumber account has been successfully verified and is now fully active.\n\n✅ You're All Set!\n\nAccount Details:\n- Username: ${user.username}\n- Email: ${user.email}\n- Status: Verified & Active\n\n🚀 What's Next?\n- Log in to your account at ${process.env.BASE_URL}/login\n- Start typing numbers to earn $0.001 per submission\n- Daily Tasks to earn $0.005 per submission\n- Reach $5.00 to request your first withdrawal\n- You can make up to 170 submissions per day\n\nWelcome to the SixNumber family! 🎊`,
            html: activationHtml,
        };

        sgMail.send(activationMsg)
            .then(() => console.log(`✅ Account activation email sent to ${user.email}`))
            .catch((error) => console.error('❌ SendGrid Activation Email Error:', error.response ? error.response.body : error));

        res.render('login', { error: null, success: "✅ Email verified successfully! You can now log in." });
    } catch (err) {
        console.error("Verification Error:", err);
        res.render('login', { error: "❌ An error occurred during verification.", success: null });
    }
});

app.get('/verify-all-existing', async (req, res) => {
    await User.updateMany({}, { $set: { isVerified: true } });
    res.send("✅ All existing users have been verified! You can now delete this route.");
});

// 🚀 FEEDBACK PAGE ROUTE
app.get('/feedback', authMiddleware, async (req, res) => {
    try {
        const user = await User.findById(req.session.userId);
        // Fetch the 50 most recent feedbacks
        const feedbacks = await Feedback.find().sort({ createdAt: -1 }).limit(50);
        res.render('feedback', { user, feedbacks, countries: COUNTRIES });
    } catch (err) {
        console.error("Feedback page error:", err);
        res.status(500).send("Server Error");
    }
});

// 🚀 FEEDBACK SUBMISSION API
app.post('/api/feedback', authMiddleware, async (req, res) => {
    try {
        const { name, country, rating, message } = req.body;
        
        if (!name || !country || !rating || !message) {
            return res.status(400).json({ error: "All fields are required." });
        }
        if (rating < 1 || rating > 5) {
            return res.status(400).json({ error: "Invalid rating." });
        }

        const newFeedback = new Feedback({ name, country, rating, message });
        await newFeedback.save();
        
        res.json({ success: true, message: "Thank you for your feedback!" });
    } catch (err) {
        console.error("Feedback submission error:", err);
        res.status(500).json({ error: "Failed to submit feedback." });
    }
});

// 8. START SERVER
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
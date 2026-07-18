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
const cron = require('node-cron'); // 🚀 NEW: For scheduled tasks
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
    timezone: "Asia/Colombo" // Sri Lanka timezone (UTC+5:30)
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
    res.render('signup', { error: null, success: null, countries: COUNTRIES }); // 🚀 Added countries
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

// 🚀 UPDATED: Added daily entries tracker data
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
}); // 👈 Make sure this closing brace exists!

app.get('/profile', authMiddleware, async (req, res) => {
    const user = await User.findById(req.session.userId);
    res.render('profile', { user, countries: COUNTRIES });
});

// --- PROFILE API ---
app.post('/api/profile', authMiddleware, async (req, res) => {
    // 🚀 1. Capture 'country' from the request body
    const { username, email, firstName, lastName, country } = req.body; 
    
    try {
        const user = await User.findById(req.session.userId);
        
        // 🚀 2. Update the fields if they are provided
        if (username && username.trim() !== '') user.username = username.trim();
        if (email && email.trim() !== '') user.email = email.trim();
        if (firstName && firstName.trim() !== '') user.firstName = firstName.trim();
        if (lastName && lastName.trim() !== '') user.lastName = lastName.trim();
        if (country) user.country = country; // 🚀 3. Save the newly selected country
        
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
    
    // Reset tasks if it's a new day
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

// 🚀 CLAIM DAILY TASK REWARD API (Up to 100 tasks, $0.005 each)
app.post('/api/claim-daily-task', authMiddleware, async (req, res) => {
    const user = await User.findById(req.session.userId);
    const today = new Date().toISOString().split('T')[0];
    
    // Double-check date reset
    if (user.lastDailyTaskDate !== today) {
        user.dailyTasksCompleted = 0;
        user.lastDailyTaskDate = today;
    }
    
    if (user.dailyTasksCompleted >= 100) {
        return res.status(400).json({ error: "All 100 daily tasks completed for today! Come back tomorrow." });
    }
    
    // 🚀 Add $0.005 (0.5 cents) to wallet
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
    const { email, password } = req.body;
    try {
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
        country: newUser.country || 'Not specified', // 🚀 FIX: Added country to prevent "undefined"
        email: newUser.email,
        date: new Date().toLocaleString()
    };

    // 🚀 ATTEMPT 1: TRY WEB3FORMS FIRST (As requested)
    if (web3formsKey) {
        const web3formsPayload = {
            access_key: web3formsKey.trim(),
            subject: `🎉 New User Registration: ${notificationData.username}`,
            from_name: 'SixNumber System',
            email: notificationData.email,
            message: `🎉 NEW USER REGISTRATION 🎉\n\nA new user has just signed up for SixNumber!\n\n👤 Username: ${notificationData.username}\n📛 Full Name: ${notificationData.firstName} ${notificationData.lastName}\n📧 Email: ${notificationData.email}\n📅 Date: ${notificationData.date}\n\nYou can manage this user in your Admin Panel.`
        };

        fetch('https://api.web3forms.com/submit', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'User-Agent': 'SixNumber-Server/1.0'
            },
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
                // 🚨 WEB3FORMS FAILED - FALL BACK TO SENDGRID
                console.error('❌ Web3Forms failed (Cloudflare block), falling back to SendGrid...');
                sendViaSendGrid(notificationData, adminEmail, senderEmail);
            }
        })
        .catch(err => {
            console.error('❌ Web3Forms network error, falling back to SendGrid...');
            sendViaSendGrid(notificationData, adminEmail, senderEmail);
        });
    } else {
        // No Web3Forms key, use SendGrid directly
        sendViaSendGrid(notificationData, adminEmail, senderEmail);
    }
}

// 🚀 SENDGRID FALLBACK FUNCTION
function sendViaSendGrid(data, adminEmail, senderEmail) {
    if (!adminEmail || !senderEmail) {
        console.error('❌ Cannot send notification: Missing ADMIN_EMAIL or SENDER_EMAIL in environment variables');
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
        text: `New User Registration\n\nUsername: ${data.username}\nName: ${data.firstName} ${data.lastName}\nEmail: ${data.email}\nDate: ${data.date}`,
        html: notificationHtml,
    };

    sgMail.send(msg)
        .then(() => console.log('✅ Admin registration notification sent via SendGrid (fallback)!'))
        .catch((error) => console.error('❌ SendGrid Notification Error:', error.response ? error.response.body : error));
}

app.post('/signup', async (req, res) => {
    const { username, email, password, firstName, lastName, country } = req.body;
    try {
        const existingUser = await User.findOne({ $or: [{ email }, { username }] });
        if (existingUser) return res.render('signup', { error: "Username or Email already exists.", success: null });

        const hashedPassword = await bcrypt.hash(password, 10);
        const token = crypto.randomBytes(32).toString('hex');

        const newUser = new User({ 
            username, email, password: hashedPassword, firstName, lastName, country, // 🚀 Added country
            isVerified: false, 
            verificationToken: token,
            verificationTokenExpires: Date.now() + 3600000 
        });
        
        await newUser.save(); 

        // 🚀 SEND REGISTRATION NOTIFICATION (Web3Forms with SendGrid fallback)
        sendRegistrationNotification(newUser);
        
        const verificationUrl = `${process.env.BASE_URL}/verify-email?token=${token}`;
        
        // 🚀 SEND VERIFICATION EMAIL TO USER VIA SENDGRID
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
                    
                    <!-- Header -->
                    <tr>
                        <td style="background: linear-gradient(135deg, #00d4ff 0%, #7c3aed 100%); padding: 40px 30px; text-align: center;">
                            <h1 style="margin: 0; color: #ffffff; font-size: 32px; font-weight: 800; letter-spacing: -0.5px;">
                                🎉 Welcome to SixNumber!
                            </h1>
                        </td>
                    </tr>
                    
                    <!-- Body -->
                    <tr>
                        <td style="padding: 50px 40px; color: #ffffff;">
                            <p style="margin: 0 0 20px 0; font-size: 18px; color: #cbd5e1;">
                                Hi ${firstName},
                            </p>
                            
                            <p style="margin: 0 0 30px 0; font-size: 16px; line-height: 1.6; color: #94a3b8;">
                                Thanks for signing up for <strong style="color: #00d4ff;">SixNumber</strong>! We're excited to have you on board.
                            </p>
                            
                            <p style="margin: 0 0 30px 0; font-size: 16px; line-height: 1.6; color: #94a3b8;">
                                To start earning money by typing numbers, please verify your email address by clicking the button below:
                            </p>
                            
                            <!-- Verification Button -->
                            <table width="100%" cellpadding="0" cellspacing="0" style="margin: 40px 0;">
                                <tr>
                                    <td align="center">
                                        <a href="${verificationUrl}" style="display: inline-block; padding: 18px 50px; background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: #ffffff; text-decoration: none; border-radius: 12px; font-weight: 700; font-size: 18px; box-shadow: 0 10px 30px rgba(16, 185, 129, 0.4);">
                                            ✅ Verify My Email
                                        </a>
                                    </td>
                                </tr>
                            </table>
                            
                            <!-- Alternative Link -->
                            <div style="background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; padding: 20px; margin: 30px 0;">
                                <p style="margin: 0 0 10px 0; font-size: 13px; color: #64748b; text-transform: uppercase; letter-spacing: 1px;">
                                    Or copy this link:
                                </p>
                                <p style="margin: 0; font-size: 14px; color: #00d4ff; word-break: break-all; font-family: 'Courier New', monospace;">
                                    ${verificationUrl}
                                </p>
                            </div>
                            
                            <!-- Expiration Notice -->
                            <table width="100%" cellpadding="0" cellspacing="0" style="margin-top: 40px;">
                                <tr>
                                    <td style="border-top: 1px solid rgba(255,255,255,0.1); padding-top: 20px;">
                                        <p style="margin: 0; font-size: 14px; color: #64748b;">
                                            ⏰ <strong>This verification link expires in 1 hour.</strong>
                                        </p>
                                        <p style="margin: 10px 0 0 0; font-size: 13px; color: #475569;">
                                            If you didn't create an account with SixNumber, you can safely ignore this email.
                                        </p>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                    
                    <!-- Footer -->
                    <tr>
                        <td style="background: rgba(0,0,0,0.3); padding: 30px 40px; text-align: center;">
                            <p style="margin: 0 0 10px 0; font-size: 14px; color: #64748b;">
                                © 2026 SixNumber. All rights reserved.
                            </p>
                            <p style="margin: 0; font-size: 12px; color: #475569;">
                                🇱🇰 Made with ❤️ in Sri Lanka
                            </p>
                        </td>
                    </tr>
                    
                </table>
            </td>
        </tr>
    </table>
</body>
</html>
        `;

        const verificationPlainText = `
Welcome to SixNumber!

Hi ${firstName},

Thanks for signing up for SixNumber! We're excited to have you on board.

To start earning money by typing numbers, please verify your email address by clicking the link below:

${verificationUrl}

⏰ This verification link expires in 1 hour.

If you didn't create an account with SixNumber, you can safely ignore this email.

© 2026 SixNumber. All rights reserved.
        `;

        const msg = {
            to: email,
            from: { 
                email: 'info@sixnumber.xyz', 
                name: 'SixNumber Team'
            },
            subject: '✅ Verify Your Email - SixNumber',
            text: verificationPlainText,
            html: verificationHtml,
        };

        sgMail.send(msg)
            .then(() => {
                console.log(`✅ Verification email sent to ${email}`);
            })
            .catch((error) => {
                console.error('❌ SendGrid Verification Error:', error.response ? error.response.body : error);
            });

        res.render('login', { 
            error: "✅ Account created! Please check your email for the verification link.", 
            success: null,
            verificationLink: null
        });

    } catch (err) {
        console.log("SIGNUP ERROR:", err);
        res.render('signup', { error: "Error creating account: " + err.message, success: null });
    }
});

// --- SECURE PASSWORD RESET ROUTES ---
app.get('/forgot-password', (req, res) => res.render('forgot-password', { error: null, success: null }));

app.post('/forgot-password', async (req, res) => {
    const { email } = req.body;
    
    try {
        const user = await User.findOne({ email });
        
        if (!user) {
            // Don't reveal if email exists (security best practice)
            return res.render('forgot-password', { 
                error: null, 
                success: "If an account exists with that email, a password reset link has been sent." 
            });
        }

        // Generate secure reset token
        const resetToken = crypto.randomBytes(32).toString('hex');
        user.resetPasswordToken = resetToken;
        user.resetPasswordExpires = Date.now() + 3600000; // 1 hour
        await user.save();

        const resetUrl = `${process.env.BASE_URL}/reset-password/${resetToken}`;

        // 🚀 SEND PASSWORD RESET EMAIL
        const resetHtml = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Reset Your Password - SixNumber</title>
</head>
<body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #0a0e27;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #0a0e27; padding: 40px 20px;">
        <tr>
            <td align="center">
                <table width="600" cellpadding="0" cellspacing="0" style="background: linear-gradient(135deg, #1a1040 0%, #0d1b3e 100%); border-radius: 16px; overflow: hidden; box-shadow: 0 10px 40px rgba(0,0,0,0.5);">
                    
                    <!-- Header -->
                    <tr>
                        <td style="background: linear-gradient(135deg, #f59e0b 0%, #ef4444 100%); padding: 40px 30px; text-align: center;">
                            <h1 style="margin: 0; color: #ffffff; font-size: 32px; font-weight: 800;">
                                🔐 Password Reset Request
                            </h1>
                        </td>
                    </tr>
                    
                    <!-- Body -->
                    <tr>
                        <td style="padding: 50px 40px; color: #ffffff;">
                            <p style="margin: 0 0 20px 0; font-size: 18px; color: #cbd5e1;">
                                Hi ${user.firstName},
                            </p>
                            
                            <p style="margin: 0 0 30px 0; font-size: 16px; line-height: 1.6; color: #94a3b8;">
                                We received a request to reset your password for your <strong style="color: #00d4ff;">SixNumber</strong> account.
                            </p>
                            
                            <p style="margin: 0 0 30px 0; font-size: 16px; line-height: 1.6; color: #94a3b8;">
                                Click the button below to create a new password:
                            </p>
                            
                            <!-- Reset Button -->
                            <table width="100%" cellpadding="0" cellspacing="0" style="margin: 40px 0;">
                                <tr>
                                    <td align="center">
                                        <a href="${resetUrl}" style="display: inline-block; padding: 18px 50px; background: linear-gradient(135deg, #f59e0b 0%, #ef4444 100%); color: #ffffff; text-decoration: none; border-radius: 12px; font-weight: 700; font-size: 18px; box-shadow: 0 10px 30px rgba(245, 158, 11, 0.4);">
                                            🔑 Reset My Password
                                        </a>
                                    </td>
                                </tr>
                            </table>
                            
                            <!-- Alternative Link -->
                            <div style="background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; padding: 20px; margin: 30px 0;">
                                <p style="margin: 0 0 10px 0; font-size: 13px; color: #64748b; text-transform: uppercase; letter-spacing: 1px;">
                                    Or copy this link:
                                </p>
                                <p style="margin: 0; font-size: 14px; color: #00d4ff; word-break: break-all; font-family: 'Courier New', monospace;">
                                    ${resetUrl}
                                </p>
                            </div>
                            
                            <!-- Security Notice -->
                            <table width="100%" cellpadding="0" cellspacing="0" style="margin-top: 40px;">
                                <tr>
                                    <td style="border-top: 1px solid rgba(255,255,255,0.1); padding-top: 20px;">
                                        <p style="margin: 0; font-size: 14px; color: #64748b;">
                                            ⏰ <strong>This link expires in 1 hour.</strong>
                                        </p>
                                        <p style="margin: 10px 0 0 0; font-size: 13px; color: #475569;">
                                            If you didn't request a password reset, you can safely ignore this email. Your password will remain unchanged.
                                        </p>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                    
                    <!-- Footer -->
                    <tr>
                        <td style="background: rgba(0,0,0,0.3); padding: 30px 40px; text-align: center;">
                            <p style="margin: 0 0 10px 0; font-size: 14px; color: #64748b;">
                                © 2026 SixNumber. All rights reserved.
                            </p>
                            <p style="margin: 0; font-size: 12px; color: #475569;">
                                🇱🇰 Made with ❤️ in Sri Lanka
                            </p>
                        </td>
                    </tr>
                    
                </table>
            </td>
        </tr>
    </table>
</body>
</html>
        `;

        const resetPlainText = `
Password Reset Request

Hi ${user.firstName},

We received a request to reset your password for your SixNumber account.

Click the link below to create a new password:

${resetUrl}

⏰ This link expires in 1 hour.

If you didn't request a password reset, you can safely ignore this email. Your password will remain unchanged.

© 2026 SixNumber. All rights reserved.
        `;

        const msg = {
            to: email,
            from: { 
                email: process.env.SENDER_EMAIL || 'info@sixnumber.xyz', 
                name: 'SixNumber Team'
            },
            subject: '🔐 Reset Your Password - SixNumber',
            text: resetPlainText,
            html: resetHtml,
        };

        await sgMail.send(msg);
        console.log(`✅ Password reset email sent to ${email}`);

        res.render('forgot-password', { 
            error: null, 
            success: "If an account exists with that email, a password reset link has been sent." 
        });

    } catch (err) {
        console.error("FORGOT PASSWORD ERROR:", err);
        res.render('forgot-password', { 
            error: "An error occurred. Please try again later.", 
            success: null 
        });
    }
});

// Show reset password form (validates token)
app.get('/reset-password/:token', async (req, res) => {
    try {
        const user = await User.findOne({
            resetPasswordToken: req.params.token,
            resetPasswordExpires: { $gt: Date.now() }
        });

        if (!user) {
            return res.render('login', {
                error: "❌ Password reset link is invalid or has expired.",
                success: null,
                verificationLink: null
            });
        }

        // Show reset form with token
        res.render('reset-password', { 
            token: req.params.token, 
            error: null 
        });

    } catch (err) {
        console.error("RESET PASSWORD GET ERROR:", err);
        res.render('login', {
            error: "❌ An error occurred. Please try again.",
            success: null,
            verificationLink: null
        });
    }
});

// Process password reset
app.post('/reset-password/:token', async (req, res) => {
    try {
        const user = await User.findOne({
            resetPasswordToken: req.params.token,
            resetPasswordExpires: { $gt: Date.now() }
        });

        if (!user) {
            return res.render('login', {
                error: "❌ Password reset link is invalid or has expired.",
                success: null,
                verificationLink: null
            });
        }

        const { newPassword } = req.body;

        if (!newPassword || newPassword.length < 6) {
            return res.render('reset-password', {
                token: req.params.token,
                error: "Password must be at least 6 characters long."
            });
        }

        // Update password and clear reset token
        const hashedPassword = await bcrypt.hash(newPassword, 10);
        user.password = hashedPassword;
        user.resetPasswordToken = undefined;
        user.resetPasswordExpires = undefined;
        await user.save();

        console.log(`✅ Password reset successful for ${user.email}`);

        // 🚀 SEND PASSWORD RESET CONFIRMATION EMAIL
        const resetTime = new Date().toLocaleString('en-US', {
            dateStyle: 'full',
            timeStyle: 'long'
        });

        const confirmationHtml = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Password Changed - SixNumber</title>
</head>
<body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #0a0e27;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #0a0e27; padding: 40px 20px;">
        <tr>
            <td align="center">
                <table width="600" cellpadding="0" cellspacing="0" style="background: linear-gradient(135deg, #1a1040 0%, #0d1b3e 100%); border-radius: 16px; overflow: hidden; box-shadow: 0 10px 40px rgba(0,0,0,0.5);">
                    
                    <!-- Header -->
                    <tr>
                        <td style="background: linear-gradient(135deg, #ef4444 0%, #f59e0b 100%); padding: 40px 30px; text-align: center;">
                            <h1 style="margin: 0; color: #ffffff; font-size: 32px; font-weight: 800;">
                                🔐 Password Changed
                            </h1>
                        </td>
                    </tr>
                    
                    <!-- Body -->
                    <tr>
                        <td style="padding: 50px 40px; color: #ffffff;">
                            <p style="margin: 0 0 20px 0; font-size: 18px; color: #cbd5e1;">
                                Hi ${user.firstName},
                            </p>
                            
                            <p style="margin: 0 0 30px 0; font-size: 16px; line-height: 1.6; color: #94a3b8;">
                                This is a confirmation that the password for your <strong style="color: #00d4ff;">SixNumber</strong> account has been successfully changed.
                            </p>
                            
                            <!-- Reset Details Box -->
                            <div style="background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; padding: 25px; margin: 30px 0;">
                                <p style="margin: 0 0 15px 0; font-size: 13px; color: #64748b; text-transform: uppercase; letter-spacing: 1px;">
                                    Reset Details:
                                </p>
                                <p style="margin: 0 0 10px 0; font-size: 15px; color: #ffffff;">
                                    <strong style="color: #94a3b8;">Account:</strong> ${user.email}
                                </p>
                                <p style="margin: 0; font-size: 15px; color: #ffffff;">
                                    <strong style="color: #94a3b8;">Changed At:</strong> ${resetTime}
                                </p>
                            </div>
                            
                            <!-- Security Warning -->
                            <div style="background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.3); border-radius: 12px; padding: 20px; margin: 30px 0;">
                                <p style="margin: 0 0 10px 0; font-size: 16px; color: #f87171; font-weight: 700;">
                                    ⚠️ Didn't make this change?
                                </p>
                                <p style="margin: 0; font-size: 14px; line-height: 1.6; color: #fca5a5;">
                                    If you did not reset your password, your account may have been compromised. Please contact our support team immediately and we will secure your account.
                                </p>
                            </div>
                            
                            <!-- Support Button -->
                            <table width="100%" cellpadding="0" cellspacing="0" style="margin: 40px 0;">
                                <tr>
                                    <td align="center">
                                        <a href="${process.env.BASE_URL}/contact" style="display: inline-block; padding: 16px 40px; background: linear-gradient(135deg, #ef4444 0%, #f59e0b 100%); color: #ffffff; text-decoration: none; border-radius: 12px; font-weight: 700; font-size: 16px; box-shadow: 0 10px 30px rgba(239, 68, 68, 0.3);">
                                            📩 Contact Support
                                        </a>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                    
                    <!-- Footer -->
                    <tr>
                        <td style="background: rgba(0,0,0,0.3); padding: 30px 40px; text-align: center;">
                            <p style="margin: 0 0 10px 0; font-size: 14px; color: #64748b;">
                                © 2026 SixNumber. All rights reserved.
                            </p>
                            <p style="margin: 0; font-size: 12px; color: #475569;">
                                🇱🇰 Made with ❤️ in Sri Lanka
                            </p>
                        </td>
                    </tr>
                    
                </table>
            </td>
        </tr>
    </table>
</body>
</html>
        `;

        const confirmationPlainText = `
Password Changed Successfully

Hi ${user.firstName},

This is a confirmation that the password for your SixNumber account has been successfully changed.

Account: ${user.email}
Changed At: ${resetTime}

⚠️ Didn't make this change?
If you did not reset your password, your account may have been compromised. Please contact our support team immediately at ${process.env.BASE_URL}/contact and we will secure your account.

© 2026 SixNumber. All rights reserved.
This is an automated security notification.
        `;

        const confirmationMsg = {
            to: user.email,
            from: { 
                email: process.env.SENDER_EMAIL || 'info@sixnumber.xyz', 
                name: 'SixNumber Security'
            },
            subject: '🔐 Your Password Was Changed - SixNumber',
            text: confirmationPlainText,
            html: confirmationHtml,
        };

        sgMail.send(confirmationMsg)
            .then(() => {
                console.log(`✅ Password reset confirmation email sent to ${user.email}`);
            })
            .catch((error) => {
                console.error('❌ SendGrid Confirmation Email Error:', error.response ? error.response.body : error);
            });

        res.render('login', {
            error: null,
            success: "✅ Password reset successful! You can now log in with your new password.",
            verificationLink: null
        });

    } catch (err) {
        console.error("RESET PASSWORD POST ERROR:", err);
        res.render('login', {
            error: "❌ An error occurred. Please try again.",
            success: null,
            verificationLink: null
        });
    }
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
        return res.status(429).json({ 
            error: "You have reached your daily limit of 170 entries. Come back tomorrow!",
            remaining: 0 
        });
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

// 🚀 UPDATED: Fee deduction removed - only amount is deducted + Admin notification email added
app.post('/api/withdraw', authMiddleware, async (req, res) => {
    const user = await User.findById(req.session.userId);
    
    const { amount, method, address, bankName, accountHolderName, accountNumber, branchName, branchCode } = req.body;
    const amountCents = Math.round(amount * 100);

    if (amountCents < 500) return res.status(400).json({ error: "Minimum withdrawal is $5.00." });
    if (!['paypal', 'bitcoin', 'bank'].includes(method)) return res.status(400).json({ error: "Invalid method." });
    
    if (user.walletCents < amountCents) {
        return res.status(400).json({ 
            error: `Insufficient funds. You need $${(amountCents / 100).toFixed(3)} to make this withdrawal.` 
        });
    }

    if (method === 'bank') {
        if (!bankName || !accountHolderName || !accountNumber || !branchName || !branchCode) {
            return res.status(400).json({ error: "Please fill in all bank details." });
        }
    } else {
        if (!address) return res.status(400).json({ error: "Please provide your payment address." });
    }

    // 🚀 Only deduct the withdrawal amount (no fee)
    user.walletCents -= amountCents;
    await user.save();

    const withdrawal = await Withdrawal.create({
        userId: user._id,
        amountCents,
        feeCents: 0, // No fee charged
        method,
        paymentAddress: address,
        bankName,
        accountHolderName,
        accountNumber,
        branchName,
        branchCode,
        status: 'pending'
    });

    // 🚀 SEND ADMIN NOTIFICATION EMAIL
    const adminEmail = process.env.ADMIN_EMAIL || process.env.EMAIL_USER || 'dulnithchenula@gmail.com'; // Fallback email
    const senderEmail = process.env.SENDER_EMAIL || 'info@sixnumber.xyz';
    const amountFormatted = (amountCents / 100).toFixed(3);
    const requestDate = new Date().toLocaleString('en-US', {
        dateStyle: 'full',
        timeStyle: 'short'
    });

    // Safety check - don't send if email is not configured
    if (!adminEmail) {
        console.warn('⚠️ Admin email not configured. Skipping admin notification.');
        return res.json({ success: true, message: `Withdrawal of $${amountFormatted} requested successfully!` });
    }

    // Format payment details based on method
    let paymentDetailsHtml = '';
    let paymentDetailsText = '';

    if (method === 'bank') {
        paymentDetailsHtml = `
            <div style="background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; padding: 20px; margin: 20px 0;">
                <p style="margin: 0 0 10px 0; font-size: 13px; color: #64748b; text-transform: uppercase; letter-spacing: 1px;">
                    Bank Transfer Details:
                </p>
                <p style="margin: 0 0 8px 0; font-size: 15px; color: #ffffff;">
                    <strong style="color: #94a3b8;">Bank Name:</strong> ${bankName}
                </p>
                <p style="margin: 0 0 8px 0; font-size: 15px; color: #ffffff;">
                    <strong style="color: #94a3b8;">Account Holder:</strong> ${accountHolderName}
                </p>
                <p style="margin: 0 0 8px 0; font-size: 15px; color: #ffffff;">
                    <strong style="color: #94a3b8;">Account Number:</strong> ${accountNumber}
                </p>
                <p style="margin: 0; font-size: 15px; color: #ffffff;">
                    <strong style="color: #94a3b8;">Branch:</strong> ${branchName} (${branchCode})
                </p>
            </div>
        `;
        paymentDetailsText = `
Bank Transfer Details:
- Bank Name: ${bankName}
- Account Holder: ${accountHolderName}
- Account Number: ${accountNumber}
- Branch: ${branchName} (${branchCode})
        `;
    } else {
        paymentDetailsHtml = `
            <div style="background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; padding: 20px; margin: 20px 0;">
                <p style="margin: 0 0 10px 0; font-size: 13px; color: #64748b; text-transform: uppercase; letter-spacing: 1px;">
                    ${method === 'bitcoin' ? 'Bitcoin' : 'PayPal'} Address:
                </p>
                <p style="margin: 0; font-size: 14px; color: #00d4ff; word-break: break-all; font-family: 'Courier New', monospace;">
                    ${address}
                </p>
            </div>
        `;
        paymentDetailsText = `
${method === 'bitcoin' ? 'Bitcoin' : 'PayPal'} Address:
${address}
        `;
    }

    const adminNotificationHtml = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>New Withdrawal Request - SixNumber</title>
</head>
<body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #0a0e27;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #0a0e27; padding: 40px 20px;">
        <tr>
            <td align="center">
                <table width="600" cellpadding="0" cellspacing="0" style="background: linear-gradient(135deg, #1a1040 0%, #0d1b3e 100%); border-radius: 16px; overflow: hidden; box-shadow: 0 10px 40px rgba(0,0,0,0.5);">
                    
                    <!-- Header -->
                    <tr>
                        <td style="background: linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%); padding: 40px 30px; text-align: center;">
                            <h1 style="margin: 0; color: #ffffff; font-size: 32px; font-weight: 800;">
                                💸 New Withdrawal Request
                            </h1>
                        </td>
                    </tr>
                    
                    <!-- Body -->
                    <tr>
                        <td style="padding: 50px 40px; color: #ffffff;">
                            <p style="margin: 0 0 20px 0; font-size: 18px; color: #cbd5e1;">
                                Hi Admin,
                            </p>
                            
                            <p style="margin: 0 0 30px 0; font-size: 16px; line-height: 1.6; color: #94a3b8;">
                                A user has submitted a new withdrawal request. Please review and process it in the admin panel.
                            </p>
                            
                            <!-- User Info Box -->
                            <div style="background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; padding: 20px; margin: 20px 0;">
                                <p style="margin: 0 0 15px 0; font-size: 13px; color: #64748b; text-transform: uppercase; letter-spacing: 1px;">
                                    User Information:
                                </p>
                                <p style="margin: 0 0 8px 0; font-size: 15px; color: #ffffff;">
                                    <strong style="color: #94a3b8;">Username:</strong> ${user.username}
                                </p>
                                <p style="margin: 0 0 8px 0; font-size: 15px; color: #ffffff;">
                                    <strong style="color: #94a3b8;">Full Name:</strong> ${user.firstName} ${user.lastName}
                                </p>
                                <p style="margin: 0; font-size: 15px; color: #ffffff;">
                                    <strong style="color: #94a3b8;">Email:</strong> ${user.email}
                                </p>
                            </div>
                            
                            <!-- Withdrawal Details Box -->
                            <div style="background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.3); border-radius: 12px; padding: 25px; margin: 20px 0; text-align: center;">
                                <p style="margin: 0 0 10px 0; font-size: 13px; color: #64748b; text-transform: uppercase; letter-spacing: 1px;">
                                    Withdrawal Amount:
                                </p>
                                <p style="margin: 0; font-size: 36px; color: #10b981; font-weight: 800;">
                                    $${amountFormatted}
                                </p>
                            </div>
                            
                            <!-- Request Details -->
                            <div style="background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; padding: 20px; margin: 20px 0;">
                                <p style="margin: 0 0 15px 0; font-size: 13px; color: #64748b; text-transform: uppercase; letter-spacing: 1px;">
                                    Request Details:
                                </p>
                                <p style="margin: 0 0 8px 0; font-size: 15px; color: #ffffff;">
                                    <strong style="color: #94a3b8;">Payment Method:</strong> ${method.toUpperCase()}
                                </p>
                                <p style="margin: 0; font-size: 15px; color: #ffffff;">
                                    <strong style="color: #94a3b8;">Requested On:</strong> ${requestDate}
                                </p>
                            </div>
                            
                            ${paymentDetailsHtml}
                            
                            <!-- Action Required Notice -->
                            <div style="background: rgba(245, 158, 11, 0.1); border: 1px solid rgba(245, 158, 11, 0.3); border-radius: 12px; padding: 20px; margin: 30px 0;">
                                <p style="margin: 0 0 10px 0; font-size: 16px; color: #fbbf24; font-weight: 700;">
                                    ⚠️ Action Required
                                </p>
                                <p style="margin: 0; font-size: 14px; line-height: 1.6; color: #fde68a;">
                                    Please log in to the admin panel to approve or reject this withdrawal request. The user's funds have already been deducted from their wallet.
                                </p>
                            </div>
                            
                            <!-- Admin Panel Button -->
                            <table width="100%" cellpadding="0" cellspacing="0" style="margin: 40px 0;">
                                <tr>
                                    <td align="center">
                                        <a href="${process.env.BASE_URL}/admin" style="display: inline-block; padding: 18px 50px; background: linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%); color: #ffffff; text-decoration: none; border-radius: 12px; font-weight: 700; font-size: 18px; box-shadow: 0 10px 30px rgba(59, 130, 246, 0.4);">
                                            🛡️ Go to Admin Panel
                                        </a>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                    
                    <!-- Footer -->
                    <tr>
                        <td style="background: rgba(0,0,0,0.3); padding: 30px 40px; text-align: center;">
                            <p style="margin: 0 0 10px 0; font-size: 14px; color: #64748b;">
                                © 2026 SixNumber. All rights reserved.
                            </p>
                            <p style="margin: 0; font-size: 12px; color: #475569;">
                                🇱🇰 Made with ❤️ in Sri Lanka
                            </p>
                        </td>
                    </tr>
                    
                </table>
            </td>
        </tr>
    </table>
</body>
</html>
    `;

    const adminNotificationPlainText = `
New Withdrawal Request

Hi Admin,

A user has submitted a new withdrawal request. Please review and process it in the admin panel.

User Information:
- Username: ${user.username}
- Full Name: ${user.firstName} ${user.lastName}
- Email: ${user.email}

Withdrawal Amount: $${amountFormatted}

Request Details:
- Payment Method: ${method.toUpperCase()}
- Requested On: ${requestDate}

${paymentDetailsText}

⚠️ Action Required
Please log in to the admin panel to approve or reject this withdrawal request. The user's funds have already been deducted from their wallet.

Admin Panel: ${process.env.BASE_URL}/admin

© 2026 SixNumber. All rights reserved.
🇱🇰 Made with ❤️ in Sri Lanka
    `;

    const adminMsg = {
        to: adminEmail,
        from: { 
            email: senderEmail, 
            name: 'SixNumber System'
        },
        subject: `💸 New Withdrawal Request: $${amountFormatted} from ${user.username}`,
        text: adminNotificationPlainText,
        html: adminNotificationHtml,
    };

    sgMail.send(adminMsg)
        .then(() => console.log(`✅ Admin notification sent for withdrawal from ${user.username}`))
        .catch((error) => console.error('❌ SendGrid Admin Notification Error:', error.response ? error.response.body : error));

    res.json({ success: true, message: `Withdrawal of $${amountFormatted} requested successfully!` });
});

// 🚀 UPDATED: Added date-based daily entry tracking AND Daily Tasks stats to admin page
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
            userFilter = {
                $or: [
                    { username: regex },
                    { firstName: regex },
                    { lastName: regex }
                ]
            };
        }

        let withdrawalFilter = {};
        if (withdrawalSearch) {
            const regex = new RegExp(withdrawalSearch, 'i');
            const matchedUsers = await User.find({
                $or: [
                    { username: regex },
                    { firstName: regex },
                    { lastName: regex }
                ]
            }).select('_id');
            
            const matchedUserIds = matchedUsers.map(u => u._id);
            withdrawalFilter = { userId: { $in: matchedUserIds } };
        }

        // 🚀 DATE-BASED AUTO-RESET: Reset users if their lastEntryDate is not today
        const today = new Date().toISOString().split('T')[0];
        const resetResult = await User.updateMany(
            { lastEntryDate: { $ne: today } },
            { 
                $set: { 
                    dailyEntries: 0,
                    lastEntryDate: today
                }
            }
        );
        
        if (resetResult.modifiedCount > 0) {
            console.log(`🔄 [ADMIN] Auto-reset ${resetResult.modifiedCount} users for new date: ${today}`);
        }

        const users = await User.find(userFilter).sort({ createdAt: -1 }); 
        const withdrawals = await Withdrawal.find(withdrawalFilter)
            .populate('userId', 'username firstName lastName')
            .sort({ createdAt: -1 });  

        const totalUsers = await User.countDocuments(userFilter);
        const totalWithdrawals = await Withdrawal.countDocuments({ status: 'pending' });
        
        // 🚀 Calculate daily entry stats (date-based)
        const DAILY_LIMIT = 170;
        
        const usersWithDailyStats = users.map(u => {
            const dailyEntries = (u.lastEntryDate === today) ? (u.dailyEntries || 0) : 0;
            const remainingEntries = DAILY_LIMIT - dailyEntries;
            const limitReached = remainingEntries <= 0;
            const percentage = (dailyEntries / DAILY_LIMIT) * 100;
            
            return {
                ...u.toObject(),
                dailyEntries,
                remainingEntries,
                limitReached,
                percentage
            };
        });

        // 🚀 CALCULATE DAILY TASKS STATS
        const usersWithTasksToday = users.filter(u => u.lastDailyTaskDate === today);
        const totalTasksCompletedToday = usersWithTasksToday.reduce((sum, u) => sum + (u.dailyTasksCompleted || 0), 0);
        const usersCompletedAll100 = usersWithTasksToday.filter(u => (u.dailyTasksCompleted || 0) >= 100).length;
        const usersActiveToday = usersWithTasksToday.filter(u => (u.dailyTasksCompleted || 0) > 0).length;
        const totalPaidToday = ((totalTasksCompletedToday * 0.5) / 100).toFixed(3); // 0.5 cents per task = $0.005
        
        res.render('admin', { 
            user, 
            users: usersWithDailyStats, 
            withdrawals, 
            totalUsers, 
            totalWithdrawals,
            userSearch, 
            withdrawalSearch,
            currentDate: today,
            DAILY_LIMIT,
            // 🚀 NEW: Daily Tasks Stats
            totalTasksCompletedToday,
            usersCompletedAll100,
            usersActiveToday,
            totalPaidToday
        });
    } catch (error) {
        console.error("ADMIN PAGE CRASH:", error);
        res.status(500).send("Admin page crashed. Error: " + error.message);
    }
});

// 🚀 NEW: Manual reset route for testing
app.post('/admin/reset-daily-entries', authMiddleware, adminCheck, async (req, res) => {
    try {
        const today = new Date().toISOString().split('T')[0];
        const result = await User.updateMany(
            {},
            { 
                $set: { 
                    dailyEntries: 0,
                    lastEntryDate: today
                }
            }
        );
        
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

// 🚀 UPDATED: Email notifications kept, but no fee refund logic
app.post('/admin/withdrawal/:id/action', authMiddleware, adminCheck, async (req, res) => {
    const { id } = req.params;
    const { action } = req.body;
    
    // 🚀 Populate userId to get user details for email notification
    const withdrawal = await Withdrawal.findById(id).populate('userId', 'email firstName username');
    if (!withdrawal) return res.send('Withdrawal not found');

    // 🚀 Fetch the full user object separately to properly update walletCents
    const user = await User.findById(withdrawal.userId._id);
    if (!user) return res.send('User not found');

    const amount = (withdrawal.amountCents / 100).toFixed(3);
    const date = new Date(withdrawal.createdAt).toLocaleDateString('en-US', { 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric' 
    });

    // 🚀 Format payment details based on method
    let paymentDetailsHtml = '';
    let paymentDetailsText = '';

    if (withdrawal.method === 'bank') {
        paymentDetailsHtml = `
            <p style="margin: 0 0 10px 0; font-size: 15px; color: #ffffff;">
                <strong style="color: #94a3b8;">Bank Name:</strong> ${withdrawal.bankName || 'N/A'}
            </p>
            <p style="margin: 0 0 10px 0; font-size: 15px; color: #ffffff;">
                <strong style="color: #94a3b8;">Account Holder:</strong> ${withdrawal.accountHolderName || 'N/A'}
            </p>
            <p style="margin: 0 0 10px 0; font-size: 15px; color: #ffffff;">
                <strong style="color: #94a3b8;">Account Number:</strong> ${withdrawal.accountNumber || 'N/A'}
            </p>
            <p style="margin: 0; font-size: 15px; color: #ffffff;">
                <strong style="color: #94a3b8;">Branch:</strong> ${withdrawal.branchName || 'N/A'} (${withdrawal.branchCode || 'N/A'})
            </p>
        `;
        paymentDetailsText = `
- Bank Name: ${withdrawal.bankName || 'N/A'}
- Account Holder: ${withdrawal.accountHolderName || 'N/A'}
- Account Number: ${withdrawal.accountNumber || 'N/A'}
- Branch: ${withdrawal.branchName || 'N/A'} (${withdrawal.branchCode || 'N/A'})
        `;
    } else {
        paymentDetailsHtml = `
            <p style="margin: 0; font-size: 15px; color: #ffffff;">
                <strong style="color: #94a3b8;">Wallet Address:</strong> ${withdrawal.paymentAddress || 'N/A'}
            </p>
        `;
        paymentDetailsText = `- Wallet Address: ${withdrawal.paymentAddress || 'N/A'}`;
    }

    if (action === 'approve') {
        withdrawal.status = 'approved';
        await withdrawal.save();

        // 🚀 SEND APPROVAL EMAIL
        const approvalHtml = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Withdrawal Approved - SixNumber</title>
</head>
<body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #0a0e27;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #0a0e27; padding: 40px 20px;">
        <tr>
            <td align="center">
                <table width="600" cellpadding="0" cellspacing="0" style="background: linear-gradient(135deg, #1a1040 0%, #0d1b3e 100%); border-radius: 16px; overflow: hidden; box-shadow: 0 10px 40px rgba(0,0,0,0.5);">
                    
                    <!-- Header -->
                    <tr>
                        <td style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); padding: 40px 30px; text-align: center;">
                            <h1 style="margin: 0; color: #ffffff; font-size: 32px; font-weight: 800;">
                                ✅ Withdrawal Approved
                            </h1>
                        </td>
                    </tr>
                    
                    <!-- Body -->
                    <tr>
                        <td style="padding: 50px 40px; color: #ffffff;">
                            <p style="margin: 0 0 20px 0; font-size: 18px; color: #cbd5e1;">
                                Hi ${user.firstName || user.username},
                            </p>
                            
                            <p style="margin: 0 0 30px 0; font-size: 16px; line-height: 1.6; color: #94a3b8;">
                                Great news! Your withdrawal request has been <strong style="color: #10b981;">approved</strong> and is now being processed.
                            </p>
                            
                            <!-- Withdrawal Details Box -->
                            <div style="background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; padding: 25px; margin: 30px 0;">
                                <p style="margin: 0 0 15px 0; font-size: 13px; color: #64748b; text-transform: uppercase; letter-spacing: 1px;">
                                    Withdrawal Details:
                                </p>
                                <p style="margin: 0 0 10px 0; font-size: 15px; color: #ffffff;">
                                    <strong style="color: #94a3b8;">Amount:</strong> $${amount}
                                </p>
                                <p style="margin: 0 0 10px 0; font-size: 15px; color: #ffffff;">
                                    <strong style="color: #94a3b8;">Requested On:</strong> ${date}
                                </p>
                                <p style="margin: 0 0 10px 0; font-size: 15px; color: #ffffff;">
                                    <strong style="color: #94a3b8;">Payment Method:</strong> ${withdrawal.method.toUpperCase()}
                                </p>
                                ${paymentDetailsHtml}
                            </div>
                            
                            <!-- Processing Time Notice -->
                            <div style="background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.3); border-radius: 12px; padding: 20px; margin: 30px 0;">
                                <p style="margin: 0 0 10px 0; font-size: 16px; color: #34d399; font-weight: 700;">
                                    ⏰ Processing Time
                                </p>
                                <p style="margin: 0; font-size: 14px; line-height: 1.6; color: #a7f3d0;">
                                    Your payment will be processed and sent to your account within <strong>3 business days</strong>. You will receive the funds according to your selected payment method.
                                </p>
                            </div>
                            
                            <!-- Thank You Message -->
                            <div style="text-align: center; margin-top: 40px;">
                                <p style="margin: 0; font-size: 16px; color: #cbd5e1; font-weight: 600;">
                                    Thank you for using SixNumber! 🎉
                                </p>
                            </div>
                        </td>
                    </tr>
                    
                    <!-- Footer -->
                    <tr>
                        <td style="background: rgba(0,0,0,0.3); padding: 30px 40px; text-align: center;">
                            <p style="margin: 0 0 10px 0; font-size: 14px; color: #64748b;">
                                © 2026 SixNumber. All rights reserved.
                            </p>
                            <p style="margin: 0; font-size: 12px; color: #475569;">
                                🇱🇰 Made with ❤️ in Sri Lanka
                            </p>
                        </td>
                    </tr>
                    
                </table>
            </td>
        </tr>
    </table>
</body>
</html>
        `;

        const approvalPlainText = `
Withdrawal Approved

Hi ${user.firstName || user.username},

Great news! Your withdrawal request has been approved and is now being processed.

Withdrawal Details:
- Amount: $${amount}
- Requested On: ${date}
- Payment Method: ${withdrawal.method.toUpperCase()}
${paymentDetailsText}

⏰ Processing Time
Your payment will be processed and sent to your account within 3 business days. You will receive the funds according to your selected payment method.

Thank you for using SixNumber! 🎉

© 2026 SixNumber. All rights reserved.
🇱🇰 Made with ❤️ in Sri Lanka
        `;

        const approvalMsg = {
            to: user.email,
            from: { 
                email: process.env.SENDER_EMAIL || 'info@sixnumber.xyz', 
                name: 'SixNumber Team'
            },
            subject: `✅ Your Withdrawal of $${amount} Has Been Approved`,
            text: approvalPlainText,
            html: approvalHtml,
        };

        sgMail.send(approvalMsg)
            .then(() => console.log(`✅ Approval email sent to ${user.email}`))
            .catch((error) => console.error('❌ SendGrid Approval Email Error:', error.response ? error.response.body : error));

    } else if (action === 'reject') {
        withdrawal.status = 'rejected';
        
        // 🚀 Refund only the withdrawal amount (no fee to refund)
        user.walletCents += withdrawal.amountCents;
        await user.save();
        
        await withdrawal.save();

        // 🚀 SEND REJECTION EMAIL
        const rejectionHtml = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Withdrawal Rejected - SixNumber</title>
</head>
<body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #0a0e27;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #0a0e27; padding: 40px 20px;">
        <tr>
            <td align="center">
                <table width="600" cellpadding="0" cellspacing="0" style="background: linear-gradient(135deg, #1a1040 0%, #0d1b3e 100%); border-radius: 16px; overflow: hidden; box-shadow: 0 10px 40px rgba(0,0,0,0.5);">
                    
                    <!-- Header -->
                    <tr>
                        <td style="background: linear-gradient(135deg, #ef4444 0%, #f59e0b 100%); padding: 40px 30px; text-align: center;">
                            <h1 style="margin: 0; color: #ffffff; font-size: 32px; font-weight: 800;">
                                ❌ Withdrawal Rejected
                            </h1>
                        </td>
                    </tr>
                    
                    <!-- Body -->
                    <tr>
                        <td style="padding: 50px 40px; color: #ffffff;">
                            <p style="margin: 0 0 20px 0; font-size: 18px; color: #cbd5e1;">
                                Hi ${user.firstName || user.username},
                            </p>
                            
                            <p style="margin: 0 0 30px 0; font-size: 16px; line-height: 1.6; color: #94a3b8;">
                                We regret to inform you that your withdrawal request has been <strong style="color: #f87171;">rejected</strong>.
                            </p>
                            
                            <!-- Withdrawal Details Box -->
                            <div style="background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; padding: 25px; margin: 30px 0;">
                                <p style="margin: 0 0 15px 0; font-size: 13px; color: #64748b; text-transform: uppercase; letter-spacing: 1px;">
                                    Withdrawal Details:
                                </p>
                                <p style="margin: 0 0 10px 0; font-size: 15px; color: #ffffff;">
                                    <strong style="color: #94a3b8;">Amount:</strong> $${amount}
                                </p>
                                <p style="margin: 0 0 10px 0; font-size: 15px; color: #ffffff;">
                                    <strong style="color: #94a3b8;">Requested On:</strong> ${date}
                                </p>
                                <p style="margin: 0 0 10px 0; font-size: 15px; color: #ffffff;">
                                    <strong style="color: #94a3b8;">Payment Method:</strong> ${withdrawal.method.toUpperCase()}
                                </p>
                                ${paymentDetailsHtml}
                            </div>
                            
                            <!-- Refund Notice -->
                            <div style="background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.3); border-radius: 12px; padding: 20px; margin: 30px 0;">
                                <p style="margin: 0 0 10px 0; font-size: 16px; color: #34d399; font-weight: 700;">
                                    💰 Refund Processed
                                </p>
                                <p style="margin: 0; font-size: 14px; line-height: 1.6; color: #a7f3d0;">
                                    The full amount of <strong>$${amount}</strong> has been <strong>refunded to your wallet</strong>. You can now request a new withdrawal with corrected details.
                                </p>
                            </div>
                            
                            <!-- Common Reasons -->
                            <div style="background: rgba(245, 158, 11, 0.1); border: 1px solid rgba(245, 158, 11, 0.3); border-radius: 12px; padding: 20px; margin: 30px 0;">
                                <p style="margin: 0 0 10px 0; font-size: 16px; color: #fbbf24; font-weight: 700;">
                                    ℹ️ Common Reasons for Rejection
                                </p>
                                <ul style="margin: 0; padding-left: 20px; font-size: 14px; line-height: 1.8; color: #fde68a;">
                                    <li>Incorrect payment details (email, wallet address, or bank info)</li>
                                    <li>Suspicious account activity</li>
                                    <li>Payment method not supported in your region</li>
                                    <li>Minimum withdrawal amount not met</li>
                                </ul>
                            </div>
                            
                            <!-- Support Button -->
                            <table width="100%" cellpadding="0" cellspacing="0" style="margin: 40px 0;">
                                <tr>
                                    <td align="center">
                                        <a href="${process.env.BASE_URL}/contact" style="display: inline-block; padding: 16px 40px; background: linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%); color: #ffffff; text-decoration: none; border-radius: 12px; font-weight: 700; font-size: 16px; box-shadow: 0 10px 30px rgba(59, 130, 246, 0.3);">
                                            📩 Contact Support
                                        </a>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                    
                    <!-- Footer -->
                    <tr>
                        <td style="background: rgba(0,0,0,0.3); padding: 30px 40px; text-align: center;">
                            <p style="margin: 0 0 10px 0; font-size: 14px; color: #64748b;">
                                © 2026 SixNumber. All rights reserved.
                            </p>
                            <p style="margin: 0; font-size: 12px; color: #475569;">
                                🇱🇰 Made with ❤️ in Sri Lanka
                            </p>
                        </td>
                    </tr>
                    
                </table>
            </td>
        </tr>
    </table>
</body>
</html>
        `;

        const rejectionPlainText = `
Withdrawal Rejected

Hi ${user.firstName || user.username},

We regret to inform you that your withdrawal request has been rejected.

Withdrawal Details:
- Amount: $${amount}
- Requested On: ${date}
- Payment Method: ${withdrawal.method.toUpperCase()}
${paymentDetailsText}

💰 Refund Processed
The full amount of $${amount} has been refunded to your wallet. You can now request a new withdrawal with corrected details.

ℹ️ Common Reasons for Rejection
- Incorrect payment details (email, wallet address, or bank info)
- Suspicious account activity
- Payment method not supported in your region
- Minimum withdrawal amount not met

If you believe this is an error, please contact our support team at ${process.env.BASE_URL}/contact

© 2026 SixNumber. All rights reserved.
🇱🇰 Made with ❤️ in Sri Lanka
        `;

        const rejectionMsg = {
            to: user.email,
            from: { 
                email: process.env.SENDER_EMAIL || 'info@sixnumber.xyz', 
                name: 'SixNumber Team'
            },
            subject: `❌ Your Withdrawal Request of $${amount} Has Been Rejected`,
            text: rejectionPlainText,
            html: rejectionHtml,
        };

        sgMail.send(rejectionMsg)
            .then(() => console.log(`✅ Rejection email sent to ${user.email}`))
            .catch((error) => console.error('❌ SendGrid Rejection Email Error:', error.response ? error.response.body : error));
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

        const msg = {
            to: process.env.ADMIN_EMAIL || process.env.EMAIL_USER || 'dulnithchenula@gmail.com',
            from: process.env.SENDER_EMAIL,
            replyTo: user.email,
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

        // Verify the account
        user.isVerified = true;
        req.session.verificationLink = null; 
        user.verificationToken = undefined;
        user.verificationTokenExpires = undefined;
        await user.save();

        // 🚀 SEND ACCOUNT ACTIVATION CONFIRMATION EMAIL
        const activationHtml = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Account Activated - SixNumber</title>
</head>
<body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #0a0e27;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #0a0e27; padding: 40px 20px;">
        <tr>
            <td align="center">
                <table width="600" cellpadding="0" cellspacing="0" style="background: linear-gradient(135deg, #1a1040 0%, #0d1b3e 100%); border-radius: 16px; overflow: hidden; box-shadow: 0 10px 40px rgba(0,0,0,0.5);">
                    
                    <!-- Header -->
                    <tr>
                        <td style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); padding: 40px 30px; text-align: center;">
                            <h1 style="margin: 0; color: #ffffff; font-size: 32px; font-weight: 800;">
                                🎉 Account Activated!
                            </h1>
                        </td>
                    </tr>
                    
                    <!-- Body -->
                    <tr>
                        <td style="padding: 50px 40px; color: #ffffff;">
                            <p style="margin: 0 0 20px 0; font-size: 18px; color: #cbd5e1;">
                                Hi ${user.firstName || user.username},
                            </p>
                            
                            <p style="margin: 0 0 30px 0; font-size: 16px; line-height: 1.6; color: #94a3b8;">
                                Congratulations! Your <strong style="color: #00d4ff;">SixNumber</strong> account has been successfully verified and is now fully active.
                            </p>
                            
                            <!-- Success Badge -->
                            <div style="background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.3); border-radius: 12px; padding: 25px; margin: 30px 0; text-align: center;">
                                <p style="margin: 0 0 10px 0; font-size: 48px;">✅</p>
                                <p style="margin: 0; font-size: 18px; color: #34d399; font-weight: 700;">
                                    You're All Set!
                                </p>
                            </div>
                            
                            <!-- Account Details Box -->
                            <div style="background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; padding: 25px; margin: 30px 0;">
                                <p style="margin: 0 0 15px 0; font-size: 13px; color: #64748b; text-transform: uppercase; letter-spacing: 1px;">
                                    Account Details:
                                </p>
                                <p style="margin: 0 0 10px 0; font-size: 15px; color: #ffffff;">
                                    <strong style="color: #94a3b8;">Username:</strong> ${user.username}
                                </p>
                                <p style="margin: 0 0 10px 0; font-size: 15px; color: #ffffff;">
                                    <strong style="color: #94a3b8;">Email:</strong> ${user.email}
                                </p>
                                <p style="margin: 0; font-size: 15px; color: #ffffff;">
                                    <strong style="color: #94a3b8;">Status:</strong> <span style="color: #34d399; font-weight: 700;">✓ Verified & Active</span>
                                </p>
                            </div>
                            
                            <!-- What's Next -->
                            <div style="background: rgba(124, 58, 237, 0.1); border: 1px solid rgba(124, 58, 237, 0.3); border-radius: 12px; padding: 25px; margin: 30px 0;">
                                <p style="margin: 0 0 15px 0; font-size: 16px; color: #a78bfa; font-weight: 700;">
                                    🚀 What's Next?
                                </p>
                                <ul style="margin: 0; padding-left: 20px; font-size: 14px; line-height: 1.8; color: #cbd5e1;">
                                    <li>Log in to your account at <strong style="color: #00d4ff;">${process.env.BASE_URL}/login</strong></li>
                                    <li>Start typing numbers to earn <strong style="color: #10b981;">$0.001</strong> per submission</li>
                                    <li>Daily Tasks to earn <strong style="color: #10b981;">$0.005</strong> per submission</li>
                                    <li>Reach <strong style="color: #10b981;">$5.00</strong> to request your first withdrawal</li>
                                    <li>You can make up to <strong style="color: #10b981;">170 submissions</strong> per day</li>
                                </ul>
                            </div>
                            
                            <!-- Login Button -->
                            <table width="100%" cellpadding="0" cellspacing="0" style="margin: 40px 0;">
                                <tr>
                                    <td align="center">
                                        <a href="${process.env.BASE_URL}/login" style="display: inline-block; padding: 18px 50px; background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: #ffffff; text-decoration: none; border-radius: 12px; font-weight: 700; font-size: 18px; box-shadow: 0 10px 30px rgba(16, 185, 129, 0.4);">
                                            🔓 Log In Now
                                        </a>
                                    </td>
                                </tr>
                            </table>
                            
                            <!-- Welcome Message -->
                            <div style="text-align: center; margin-top: 40px; padding-top: 30px; border-top: 1px solid rgba(255,255,255,0.1);">
                                <p style="margin: 0 0 10px 0; font-size: 20px; color: #ffffff; font-weight: 700;">
                                    Welcome to the SixNumber family! 🎊
                                </p>
                                <p style="margin: 0; font-size: 14px; color: #94a3b8;">
                                    We're thrilled to have you on board. Start earning today!
                                </p>
                            </div>
                        </td>
                    </tr>
                    
                    <!-- Footer -->
                    <tr>
                        <td style="background: rgba(0,0,0,0.3); padding: 30px 40px; text-align: center;">
                            <p style="margin: 0 0 10px 0; font-size: 14px; color: #64748b;">
                                © 2026 SixNumber. All rights reserved.
                            </p>
                            <p style="margin: 0; font-size: 12px; color: #475569;">
                                🇱🇰 Made with ❤️ in Sri Lanka
                            </p>
                        </td>
                    </tr>
                    
                </table>
            </td>
        </tr>
    </table>
</body>
</html>
        `;

        const activationPlainText = `
Account Activated Successfully!

Hi ${user.firstName || user.username},

Congratulations! Your SixNumber account has been successfully verified and is now fully active.

✅ You're All Set!

Account Details:
- Username: ${user.username}
- Email: ${user.email}
- Status: Verified & Active

🚀 What's Next?
- Log in to your account at ${process.env.BASE_URL}/login
- Start typing numbers to earn $0.001 per submission
- Reach $5.00 to request your first withdrawal
- You can make up to 170 submissions per day

Log in now: ${process.env.BASE_URL}/login

Welcome to the SixNumber family! 🎊
We're thrilled to have you on board. Start earning today!

© 2026 SixNumber. All rights reserved.
🇱🇰 Made with ❤️ in Sri Lanka
        `;

        const activationMsg = {
            to: user.email,
            from: { 
                email: process.env.SENDER_EMAIL || 'info@sixnumber.xyz', 
                name: 'SixNumber Team'
            },
            subject: '🎉 Your SixNumber Account is Now Active!',
            text: activationPlainText,
            html: activationHtml,
        };

        sgMail.send(activationMsg)
            .then(() => {
                console.log(`✅ Account activation email sent to ${user.email}`);
            })
            .catch((error) => {
                console.error('❌ SendGrid Activation Email Error:', error.response ? error.response.body : error);
            });

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
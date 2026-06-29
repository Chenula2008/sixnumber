const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    firstName: { type: String, default: '' },
    lastName: { type: String, default: '' },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    walletCents: { type: Number, default: 0 }, 
    lastEarnedAt: { type: Date, default: null },
    currentNumbers: { type: String, default: null },
    role: { type: String, enum: ['user', 'admin'], default: 'user' },
    
    // 🚨 NEW EMAIL VERIFICATION FIELDS
    isVerified: { type: Boolean, default: false },
    verificationToken: String,
    verificationTokenExpires: Date
}, {
    timestamps: true
});

module.exports = mongoose.model('User', userSchema);
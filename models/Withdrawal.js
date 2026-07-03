const mongoose = require('mongoose');

const withdrawalSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    amountCents: { type: Number, required: true },
    
    // 🚀 FIXED: Added 'bank' to the allowed enum values
    method: { type: String, enum: ['paypal', 'bitcoin', 'bank'], required: true },
    
    // 🚀 FIXED: Removed 'required: true' so bank withdrawals don't crash
    paymentAddress: { type: String }, 
    
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
    createdAt: { type: Date, default: Date.now },
    
    // New Bank Transfer Fields
    bankName: { type: String },
    accountHolderName: { type: String },
    accountNumber: { type: String },
    branchName: { type: String },
    branchCode: { type: String },
});

module.exports = mongoose.model('Withdrawal', withdrawalSchema);
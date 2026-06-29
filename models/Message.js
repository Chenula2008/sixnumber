const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    subject: { type: String, required: true },
    message: { type: String, required: true },
    status: { type: String, default: 'unread' } // 'unread' or 'read'
}, { 
    timestamps: true 
});

module.exports = mongoose.model('Message', messageSchema);
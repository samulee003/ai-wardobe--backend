const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const UserSchema = new mongoose.Schema({
    email: {
        type: String,
        required: true,
        unique: true
    },
    password: {
        type: String,
        required: true
    },
    name: {
        type: String,
        required: true
    },
    profile: {
        age: Number,
        gender: String,
        bodyType: String,
        preferredStyles: [String],
        colorPreferences: [String],
        lifestyle: String // 工作、休閒、學生等
    },
    preferences: {
        reminderFrequency: {
            type: String,
            enum: ['daily', 'weekly', 'monthly', 'never'],
            default: 'weekly'
        }
    },
    statistics: {
        totalClothes: {
            type: Number,
            default: 0
        },
        favoriteColors: [String],
        mostWornCategory: String,
        lastActive: Date
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

// 密碼加密中間件
UserSchema.pre('save', async function (next) {
    if (!this.isModified('password')) return next();

    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
});

// 密碼驗證方法
UserSchema.methods.comparePassword = async function (password) {
    return await bcrypt.compare(password, this.password);
};

module.exports = mongoose.model('User', UserSchema);
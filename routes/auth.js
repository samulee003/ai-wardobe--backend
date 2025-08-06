const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const auth = require('../middleware/auth');

const router = express.Router();

// 用戶註冊
router.post('/register', async (req, res) => {
  try {
    const { email, password, name, profile = {} } = req.body;

    // 檢查用戶是否已存在
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: '用戶已存在' });
    }

    // 創建新用戶
    const user = new User({
      email,
      password,
      name,
      profile: {
        age: profile.age || null,
        gender: profile.gender || '',
        bodyType: profile.bodyType || '',
        preferredStyles: profile.preferredStyles || [],
        colorPreferences: profile.colorPreferences || [],
        lifestyle: profile.lifestyle || ''
      },
      preferences: {
        adhd: profile.adhd || false,
        simplifiedInterface: profile.adhd || false, // ADHD用戶默認開啟簡化界面
        reminderFrequency: 'weekly',
        autoRecommendation: true
      }
    });

    await user.save();

    // 生成JWT令牌
    const token = jwt.sign(
      { id: user._id },
      process.env.JWT_SECRET || 'fallback-secret',
      { expiresIn: '7d' }
    );

    res.status(201).json({
      message: '註冊成功',
      token,
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
        profile: user.profile,
        preferences: user.preferences
      }
    });

  } catch (error) {
    console.error('註冊錯誤:', error);
    res.status(500).json({ message: '註冊失敗', error: error.message });
  }
});

// 用戶登錄
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    // 查找用戶
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ message: '用戶不存在' });
    }

    // 驗證密碼
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(400).json({ message: '密碼錯誤' });
    }

    // 更新最後活躍時間
    user.statistics.lastActive = new Date();
    await user.save();

    // 生成JWT令牌
    const token = jwt.sign(
      { id: user._id },
      process.env.JWT_SECRET || 'fallback-secret',
      { expiresIn: '7d' }
    );

    res.json({
      message: '登錄成功',
      token,
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
        profile: user.profile,
        preferences: user.preferences,
        statistics: user.statistics
      }
    });

  } catch (error) {
    console.error('登錄錯誤:', error);
    res.status(500).json({ message: '登錄失敗', error: error.message });
  }
});

// 獲取用戶資料
router.get('/profile', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    res.json({ user });
  } catch (error) {
    res.status(500).json({ message: '獲取用戶資料失敗', error: error.message });
  }
});

// 更新用戶資料
router.put('/profile', auth, async (req, res) => {
  try {
    const updates = req.body;
    const user = await User.findById(req.user.id);

    // 更新允許的字段
    if (updates.name) user.name = updates.name;
    if (updates.profile) {
      user.profile = { ...user.profile, ...updates.profile };
    }
    if (updates.preferences) {
      user.preferences = { ...user.preferences, ...updates.preferences };
    }

    await user.save();

    res.json({
      message: '用戶資料更新成功',
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
        profile: user.profile,
        preferences: user.preferences
      }
    });

  } catch (error) {
    res.status(500).json({ message: '更新失敗', error: error.message });
  }
});

// 刷新令牌
router.post('/refresh', auth, async (req, res) => {
  try {
    const token = jwt.sign(
      { id: req.user.id },
      process.env.JWT_SECRET || 'fallback-secret',
      { expiresIn: '7d' }
    );

    res.json({ token });
  } catch (error) {
    res.status(500).json({ message: '刷新令牌失敗', error: error.message });
  }
});

module.exports = router;
const jwt = require('jsonwebtoken');
const User = require('../models/User');

// 允許以環境變數關閉認證，用於離線/單人測試版
// 默認關閉（不強制登入），若需啟用，設置 DISABLE_AUTH=false
const isAuthDisabled = (process.env.DISABLE_AUTH || 'true').toLowerCase() !== 'false';

const auth = async (req, res, next) => {
  try {
    // 無認證模式：直接注入訪客用戶
    if (isAuthDisabled) {
      req.user = { id: '000000000000000000000000', name: 'guest' };
      return next();
    }

    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({ message: '沒有提供認證令牌' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
    const user = await User.findById(decoded.id);

    if (!user) {
      return res.status(401).json({ message: '用戶不存在' });
    }

    req.user = user;
    next();
  } catch (error) {
    res.status(401).json({ message: '令牌無效' });
  }
};

module.exports = auth;
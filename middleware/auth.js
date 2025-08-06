const jwt = require('jsonwebtoken');
const User = require('../models/User');

const auth = async (req, res, next) => {
  try {
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
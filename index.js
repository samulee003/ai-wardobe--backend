const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// 載入環境變數
dotenv.config();

// 確保uploads目錄存在
const uploadsDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
  console.log('創建uploads目錄');
}

const app = express();
const PORT = process.env.PORT || 5000;

// 調試信息
console.log('=== 環境變數調試 ===');
console.log('NODE_ENV:', process.env.NODE_ENV);
console.log('PORT:', PORT);
console.log('MONGODB_URI 是否存在:', !!process.env.MONGODB_URI);
console.log('MONGODB_URL 是否存在:', !!process.env.MONGODB_URL);
console.log('所有 MONGO 相關環境變數:', Object.keys(process.env).filter(key => key.toLowerCase().includes('mongo')));
console.log('========================');

// 中間件
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static('uploads'));

// 資料庫連接
console.log('MongoDB URI:', process.env.MONGODB_URI ? '已設置' : '未設置');
console.log('所有環境變數:', Object.keys(process.env).filter(key => key.includes('MONGO')));

const mongoUri = process.env.MONGODB_URI || process.env.MONGODB_URL;

if (!mongoUri) {
  console.error('❌ 嚴重錯誤: 沒有找到 MongoDB 連接字符串！');
  console.error('請檢查以下環境變數是否正確設置：');
  console.error('- MONGODB_URI');
  console.error('- MONGODB_URL');
  console.error('');
  console.error('Zeabur 配置檢查：');
  console.error('1. MongoDB 服務是否已部署？');
  console.error('2. 環境變數 ${mongodb.connectionString} 是否正確配置？');
  console.error('3. API 服務是否正確連接到 MongoDB 服務？');
  console.error('');
  console.error('當前所有環境變數:');
  Object.keys(process.env).sort().forEach(key => {
    if (!key.includes('PASSWORD') && !key.includes('SECRET') && !key.includes('KEY')) {
      console.error(`  ${key}: ${process.env[key]}`);
    } else {
      console.error(`  ${key}: ***隱藏***`);
    }
  });
  
  // 不要立即退出，讓應用繼續運行以便調試
  console.error('');
  console.error('⚠️  應用將繼續運行但無法連接數據庫');
  console.error('⚠️  請修復 MongoDB 配置後重新部署');
} else {
  console.log('使用的 MongoDB URI:', mongoUri.replace(/\/\/.*@/, '//***:***@')); // 隱藏密碼

  mongoose.connect(mongoUri)
    .then(() => console.log('✅ MongoDB 連接成功'))
    .catch(err => {
      console.error('❌ MongoDB 連接失敗:', err.message);
      console.log('嘗試的連接字符串:', mongoUri.replace(/\/\/.*@/, '//***:***@'));
    });
}

// 路由
app.use('/health', require('./routes/health'));
app.use('/api/auth', require('./routes/auth'));
app.use('/api/clothes', require('./routes/clothes'));
app.use('/api/outfits', require('./routes/outfits'));
app.use('/api/recommendations', require('./routes/recommendations'));
app.use('/api/ai', require('./routes/ai-test'));
app.use('/api/learning', require('./routes/learning'));

// 基本路由
app.get('/', (req, res) => {
  res.json({ message: '智能衣櫃管理API服務運行中' });
});

// 錯誤處理中間件
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ message: '服務器錯誤', error: err.message });
});

app.listen(PORT, () => {
  console.log(`服務器運行在端口 ${PORT}`);
});
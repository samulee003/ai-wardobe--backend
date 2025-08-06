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

// 中間件
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static('uploads'));

// 資料庫連接
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/smart-wardrobe')
  .then(() => console.log('MongoDB 連接成功'))
  .catch(err => console.error('MongoDB 連接失敗:', err));

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
const mongoose = require('mongoose');

const ClothingSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  imageUrl: {
    type: String,
    required: true
  },
  category: {
    type: String,
    required: true,
    enum: ['上衣', '下裝', '外套', '鞋子', '配件', '內衣', '運動服', '正裝']
  },
  subCategory: {
    type: String,
    required: true
  },
  colors: [{
    type: String,
    required: true
  }],
  style: {
    type: String,
    enum: ['休閒', '正式', '運動', '時尚', '復古', '簡約', '街頭']
  },
  season: [{
    type: String,
    enum: ['春', '夏', '秋', '冬']
  }],
  brand: String,
  size: String,
  condition: {
    type: String,
    enum: ['全新', '良好', '普通', '磨損', '需淘汰'],
    default: '良好'
  },
  lastWorn: Date,
  wearCount: {
    type: Number,
    default: 0
  },
  tags: [String],
  notes: String,
  aiAnalysis: {
    confidence: Number,
    detectedFeatures: [String],
    suggestedTags: [String]
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// 更新時間中間件
ClothingSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model('Clothing', ClothingSchema);
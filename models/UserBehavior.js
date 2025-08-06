const mongoose = require('mongoose');

const UserBehaviorSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  action: {
    type: String,
    required: true,
    enum: [
      'view_clothing',
      'like_outfit',
      'dislike_outfit',
      'wear_clothing',
      'save_outfit',
      'reject_recommendation',
      'accept_recommendation',
      'search_clothing',
      'filter_clothing',
      'upload_clothing',
      'delete_clothing',
      'edit_clothing'
    ]
  },
  targetType: {
    type: String,
    required: true,
    enum: ['clothing', 'outfit', 'recommendation', 'search', 'filter']
  },
  targetId: {
    type: mongoose.Schema.Types.ObjectId,
    required: false // 某些行為可能沒有特定目標
  },
  context: {
    page: String,
    timestamp: {
      type: Date,
      default: Date.now
    },
    sessionId: String,
    userAgent: String,
    deviceType: {
      type: String,
      enum: ['desktop', 'mobile', 'tablet'],
      default: 'desktop'
    }
  },
  metadata: {
    // 靈活的元數據存儲
    searchQuery: String,
    filterCriteria: Object,
    outfitItems: [mongoose.Schema.Types.ObjectId],
    rating: Number,
    reason: String,
    previousAction: String,
    timeSpent: Number, // 秒數
    clickPosition: {
      x: Number,
      y: Number
    }
  },
  preferences: {
    // 從行為中推斷的偏好
    inferredStyle: String,
    inferredColors: [String],
    inferredOccasions: [String],
    confidenceScore: {
      type: Number,
      min: 0,
      max: 1,
      default: 0.5
    }
  },
  createdAt: {
    type: Date,
    default: Date.now,
    index: true
  }
});

// 複合索引優化查詢
UserBehaviorSchema.index({ userId: 1, action: 1, createdAt: -1 });
UserBehaviorSchema.index({ userId: 1, targetType: 1, createdAt: -1 });
UserBehaviorSchema.index({ userId: 1, 'context.timestamp': -1 });

// 自動清理舊數據（保留6個月）
UserBehaviorSchema.index({ createdAt: 1 }, { expireAfterSeconds: 15552000 }); // 6個月

module.exports = mongoose.model('UserBehavior', UserBehaviorSchema);
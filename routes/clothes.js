const express = require('express');
const multer = require('multer');
const path = require('path');
const Clothing = require('../models/Clothing');
const aiService = require('../services/aiService');
const auth = require('../middleware/auth');

const router = express.Router();

// 設置multer用於文件上傳
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  }
});
// 自然語言搜尋（向量檢索 + 基本條件）
router.post('/search', auth, async (req, res) => {
  try {
    const { q = '', limit = 10 } = req.body || {};
    const userId = req.user && req.user.id ? req.user.id : null;
    if (!userId) {
      return res.json({ 
        message: '暫無衣物數據（未登入）',
        totalClothes: 0,
        categoryDistribution: {},
        colorDistribution: {},
        averageWearCount: 0,
        wearRange: { min: 0, max: 0 },
        totalWears: 0,
        rarelyWornCount: 0,
        recentWearsCount: 0,
        utilizationRate: 0
      });
    }

    const text = String(q || '').trim();
    if (!text) {
      // 空查詢：返回最近項
      const items = await Clothing.find({ userId }).sort({ createdAt: -1 }).limit(limit);
      return res.json({ items, tookMs: 0, provider: 'none' });
    }

    const vector = await aiService.embedText(text).catch(() => []);

    // 若沒有向量（無金鑰等），回退到關鍵詞查詢
    if (!vector || vector.length === 0) {
      const regex = new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      const items = await Clothing.find({
        userId,
        $or: [
          { category: regex },
          { subCategory: regex },
          { colors: regex },
          { style: regex },
          { tags: regex }
        ]
      }).limit(limit);
      return res.json({ items, fallback: true });
    }

    // 簡易餘弦相似度（在應用層）
    const all = await Clothing.find({ userId }).lean();
    const cosine = (a, b) => {
      const len = Math.min(a.length, b.length);
      let dot = 0, na = 0, nb = 0;
      for (let i = 0; i < len; i++) { dot += a[i] * b[i]; na += a[i]*a[i]; nb += b[i]*b[i]; }
      const denom = Math.sqrt(na) * Math.sqrt(nb) || 1;
      return dot / denom;
    };
    const ranked = all
      .filter(it => Array.isArray(it.embedding) && it.embedding.length > 0)
      .map(it => ({ item: it, score: cosine(vector, it.embedding) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(r => ({ ...r.item, _score: r.score }));

    res.json({ items: ranked, tookMs: 0, provider: 'openai' });
  } catch (error) {
    res.status(500).json({ message: '搜尋失敗', error: error.message });
  }
});

// 查找相似衣物（用於上傳去重提示）
router.get('/:id/similar', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const item = await Clothing.findOne({ _id: req.params.id, userId }).lean();
    if (!item) return res.status(404).json({ message: '衣物不存在' });

    if (!item.embedding || item.embedding.length === 0) {
      return res.json({ items: [] });
    }

    const all = await Clothing.find({ userId, _id: { $ne: req.params.id } }).lean();
    const cosine = (a, b) => {
      const len = Math.min(a.length, b.length);
      let dot = 0, na = 0, nb = 0;
      for (let i = 0; i < len; i++) { dot += a[i] * b[i]; na += a[i]*a[i]; nb += b[i]*b[i]; }
      const denom = Math.sqrt(na) * Math.sqrt(nb) || 1;
      return dot / denom;
    };
    const ranked = all
      .filter(it => Array.isArray(it.embedding) && it.embedding.length > 0)
      .map(it => ({ item: it, score: cosine(item.embedding, it.embedding) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 10)
      .map(r => ({ ...r.item, _score: r.score }));

    res.json({ items: ranked });
  } catch (error) {
    res.status(500).json({ message: '相似檢索失敗', error: error.message });
  }
});

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB 限制
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    
    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('只允許上傳圖片文件'));
    }
  }
});

// 上傳並分析衣物 (單張)
router.post('/upload', auth, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: '請選擇要上傳的圖片' });
    }

    // 讀取圖片並轉換為base64
    const fs = require('fs');
    const imageBuffer = fs.readFileSync(req.file.path);
    const imageBase64 = imageBuffer.toString('base64');

    // AI分析衣物
    const aiAnalysis = await aiService.analyzeClothing(imageBase64);

    // 若資料庫未連線，回傳分析結果與檔案路徑，暫不保存資料庫
    const mongoose = require('mongoose');
    if (!mongoose.connection || mongoose.connection.readyState !== 1) {
      return res.status(200).json({
        message: 'AI 分析完成（資料庫未連線，未保存到雲端）',
        clothing: {
          _id: null,
          imageUrl: `/uploads/${req.file.filename}`,
          category: aiAnalysis.category,
          subCategory: aiAnalysis.subCategory,
          colors: aiAnalysis.colors,
          style: aiAnalysis.style,
          season: aiAnalysis.season,
          dbSaved: false
        },
        aiAnalysis
      });
    }

    // 構建文字描述用於向量嵌入
    const textForEmbedding = [
      aiAnalysis.category,
      aiAnalysis.subCategory,
      (aiAnalysis.colors || []).join(' '),
      aiAnalysis.style,
      (aiAnalysis.suggestedTags || []).join(' ')
    ].filter(Boolean).join(' ');
    const embedding = await aiService.embedText(textForEmbedding).catch(() => []);

    // 創建衣物記錄
    const clothing = new Clothing({
      userId: req.user.id,
      imageUrl: `/uploads/${req.file.filename}`,
      category: aiAnalysis.category,
      subCategory: aiAnalysis.subCategory,
      colors: aiAnalysis.colors,
      style: aiAnalysis.style,
      season: aiAnalysis.season,
      aiAnalysis: {
        confidence: aiAnalysis.confidence,
        detectedFeatures: aiAnalysis.detectedFeatures,
        suggestedTags: aiAnalysis.suggestedTags
      },
      embedding
    });

    await clothing.save();

    res.json({
      message: '衣物上傳並分析成功',
      clothing: clothing,
      aiAnalysis: aiAnalysis
    });

  } catch (error) {
    console.error('上傳錯誤:', error);
    res.status(500).json({ message: '上傳失敗', error: error.message });
  }
});

// 批量上傳並分析衣物 (新增)
router.post('/batch-upload', auth, upload.array('images', 10), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ message: '請選擇要上傳的圖片' });
    }

    console.log(`開始批量處理 ${req.files.length} 張圖片...`);
    const fs = require('fs');
    const results = [];
    const errors = [];

    // 並發控制：避免AI服務過載
    const CONCURRENT_LIMIT = 3; // 最多同時處理3張圖片
    const mongoose = require('mongoose');
    const dbConnected = mongoose.connection && mongoose.connection.readyState === 1;
    const processResults = [];
    
    for (let i = 0; i < req.files.length; i += CONCURRENT_LIMIT) {
      const batch = req.files.slice(i, i + CONCURRENT_LIMIT);
      console.log(`處理批次 ${Math.floor(i/CONCURRENT_LIMIT) + 1}/${Math.ceil(req.files.length/CONCURRENT_LIMIT)}: ${batch.length} 張圖片`);
      
      const batchPromises = batch.map(async (file, batchIndex) => {
        const actualIndex = i + batchIndex;
        
        try {
          console.log(`處理第 ${actualIndex + 1} 張圖片: ${file.filename}`);
          
          // 讀取圖片並轉換為base64 (非阻塞)
          const imageBuffer = await fs.promises.readFile(file.path);
          const imageBase64 = imageBuffer.toString('base64');

          // 開始數據庫事務（若已連線）
          let session = null;
          if (dbConnected) {
            session = await mongoose.startSession();
            session.startTransaction();
          }

          try {
            // AI分析衣物
            const aiAnalysis = await aiService.analyzeClothing(imageBase64);

            // 創建衣物記錄
            const clothing = new Clothing({
              userId: req.user.id,
              imageUrl: `/uploads/${file.filename}`,
              category: aiAnalysis.category,
              subCategory: aiAnalysis.subCategory,
              colors: aiAnalysis.colors,
              style: aiAnalysis.style,
              season: aiAnalysis.season,
              aiAnalysis: {
                confidence: aiAnalysis.confidence,
                detectedFeatures: aiAnalysis.detectedFeatures,
                suggestedTags: aiAnalysis.suggestedTags
              }
            });

            if (dbConnected && session) {
              await clothing.save({ session });
              await session.commitTransaction();
              session.endSession();
            }

            return {
              index: actualIndex,
              success: true,
              clothing: clothing,
              aiAnalysis: aiAnalysis,
              filename: file.filename
            };

          } catch (transactionError) {
            if (dbConnected && session) {
              await session.abortTransaction();
              session.endSession();
            }
            throw transactionError;
          }

        } catch (error) {
          console.error(`處理第 ${actualIndex + 1} 張圖片失敗:`, error);
          
          // 清理失敗的上傳文件
          try {
            if (fs.existsSync(file.path)) {
              await fs.promises.unlink(file.path);
              console.log(`已清理失敗的文件: ${file.filename}`);
            }
          } catch (cleanupError) {
            console.error(`清理文件失敗: ${cleanupError.message}`);
          }
          
          return {
            index: actualIndex,
            success: false,
            error: error.message,
            filename: file.filename
          };
        }
      });

      // 等待當前批次完成
      const batchResults = await Promise.all(batchPromises);
      processResults.push(...batchResults);
    }

    // 分類結果
    processResults.forEach(result => {
      if (result.success) {
        results.push(result);
      } else {
        errors.push(result);
      }
    });

    const successCount = results.length;
    const errorCount = errors.length;
    const totalCount = req.files.length;

    console.log(`批量處理完成: ${successCount}/${totalCount} 成功, ${errorCount} 失敗`);

    // 返回結果
    const response = {
      message: `批量上傳完成：${successCount}/${totalCount} 張圖片處理成功`,
      summary: {
        total: totalCount,
        success: successCount,
        failed: errorCount,
        successRate: Math.round((successCount / totalCount) * 100)
      },
      results: results.map(r => ({
        clothing: r.clothing,
        aiAnalysis: r.aiAnalysis,
        filename: r.filename
      })),
      errors: errors.length > 0 ? errors.map(e => ({
        filename: e.filename,
        error: e.error
      })) : undefined
    };

    // 根據成功率決定HTTP狀態碼
    if (errorCount === 0) {
      res.status(200).json(response);
    } else if (successCount > 0) {
      res.status(207).json(response); // 207 Multi-Status (部分成功)
    } else {
      res.status(500).json(response); // 全部失敗
    }

  } catch (error) {
    console.error('批量上傳錯誤:', error);
    res.status(500).json({ 
      message: '批量上傳失敗', 
      error: error.message,
      summary: {
        total: req.files ? req.files.length : 0,
        success: 0,
        failed: req.files ? req.files.length : 0,
        successRate: 0
      }
    });
  }
});

// 獲取單個衣物詳情
router.get('/:id', auth, async (req, res) => {
  try {
    const clothing = await Clothing.findOne({ 
      _id: req.params.id, 
      userId: req.user.id 
    });

    if (!clothing) {
      return res.status(404).json({ message: '衣物不存在' });
    }

    res.json(clothing);

  } catch (error) {
    res.status(500).json({ message: '獲取衣物詳情失敗', error: error.message });
  }
});

// 獲取用戶所有衣物
router.get('/', auth, async (req, res) => {
  try {
    const { category, style, season, page = 1, limit = 20 } = req.query;
    
    let filter = { userId: req.user.id };
    
    if (category) filter.category = category;
    if (style) filter.style = style;
    if (season) filter.season = { $in: [season] };

    const clothes = await Clothing.find(filter)
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Clothing.countDocuments(filter);

    res.json({
      clothes,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      total
    });

  } catch (error) {
    res.status(500).json({ message: '獲取衣物列表失敗', error: error.message });
  }
});

// 更新衣物信息
router.put('/:id', auth, async (req, res) => {
  try {
    const clothing = await Clothing.findOne({ 
      _id: req.params.id, 
      userId: req.user.id 
    });

    if (!clothing) {
      return res.status(404).json({ message: '衣物不存在' });
    }

    Object.assign(clothing, req.body);
    await clothing.save();

    res.json({ message: '衣物信息更新成功', clothing });

  } catch (error) {
    res.status(500).json({ message: '更新失敗', error: error.message });
  }
});

// 記錄穿著
router.post('/:id/wear', auth, async (req, res) => {
  try {
    const clothing = await Clothing.findOne({ 
      _id: req.params.id, 
      userId: req.user.id 
    });

    if (!clothing) {
      return res.status(404).json({ message: '衣物不存在' });
    }

    clothing.lastWorn = new Date();
    clothing.wearCount += 1;
    await clothing.save();

    res.json({ message: '穿著記錄已更新', clothing });

  } catch (error) {
    res.status(500).json({ message: '記錄失敗', error: error.message });
  }
});

// 刪除衣物
router.delete('/:id', auth, async (req, res) => {
  try {
    const clothing = await Clothing.findOneAndDelete({ 
      _id: req.params.id, 
      userId: req.user.id 
    });

    if (!clothing) {
      return res.status(404).json({ message: '衣物不存在' });
    }

    // 刪除圖片文件
    const fs = require('fs');
    const imagePath = path.join(__dirname, '..', clothing.imageUrl);
    if (fs.existsSync(imagePath)) {
      fs.unlinkSync(imagePath);
    }

    res.json({ message: '衣物已刪除' });

  } catch (error) {
    res.status(500).json({ message: '刪除失敗', error: error.message });
  }
});

// 獲取衣櫃統計
router.get('/statistics', auth, async (req, res) => {
  try {
    // 若資料庫未連線（雲端暫時性問題），回傳友善的空統計而非 500
    const mongoose = require('mongoose');
    if (!mongoose.connection || mongoose.connection.readyState !== 1) {
      return res.json({
        message: '暫無衣物數據（資料庫未連線）',
        totalClothes: 0,
        categoryDistribution: {},
        colorDistribution: {},
        averageWearCount: 0,
        wearRange: { min: 0, max: 0 },
        totalWears: 0,
        rarelyWornCount: 0,
        recentWearsCount: 0,
        utilizationRate: 0
      });
    }
    const userId = req.user.id;
    
    let stats = [];
    try {
      stats = await Clothing.aggregate([
        { $match: { userId: mongoose.Types.ObjectId(userId) } },
        {
          $group: {
            _id: null,
            totalClothes: { $sum: 1 },
            categories: { $push: '$category' },
            colors: { $push: { $arrayElemAt: ['$colors', 0] } },
            styles: { $push: '$style' },
            avgWearCount: { $avg: '$wearCount' },
            leastWorn: { $min: '$wearCount' },
            mostWorn: { $max: '$wearCount' },
            totalWears: { $sum: '$wearCount' }
          }
        }
      ]);
    } catch (aggErr) {
      // 聚合失敗時以空統計回應，避免 500
      console.warn('統計聚合失敗，返回空統計:', aggErr.message);
      return res.json({
        message: '暫無衣物數據',
        totalClothes: 0,
        categoryDistribution: {},
        colorDistribution: {},
        averageWearCount: 0,
        wearRange: { min: 0, max: 0 },
        totalWears: 0,
        rarelyWornCount: 0,
        recentWearsCount: 0,
        utilizationRate: 0
      });
    }

    if (stats.length === 0) {
      return res.json({ 
        message: '暫無衣物數據',
        totalClothes: 0,
        categoryDistribution: {},
        colorDistribution: {},
        averageWearCount: 0,
        wearRange: { min: 0, max: 0 },
        totalWears: 0,
        rarelyWornCount: 0,
        recentWearsCount: 0,
        utilizationRate: 0
      });
    }

    const stat = stats[0];
    
    // 計算各類別數量
    const categoryCount = {};
    stat.categories.forEach(cat => {
      categoryCount[cat] = (categoryCount[cat] || 0) + 1;
    });

    // 計算顏色分布
    const colorCount = {};
    stat.colors.forEach(color => {
      if (color) {
        colorCount[color] = (colorCount[color] || 0) + 1;
      }
    });

    // 獲取很少穿的衣物
    const rarelyWorn = await Clothing.find({
      userId: mongoose.Types.ObjectId(userId),
      wearCount: { $lt: 3 }
    }).countDocuments();

    // 獲取最近30天的穿著趨勢
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const recentWears = await Clothing.find({
      userId: mongoose.Types.ObjectId(userId),
      lastWorn: { $gte: thirtyDaysAgo }
    }).countDocuments();

    res.json({
      totalClothes: stat.totalClothes,
      categoryDistribution: categoryCount,
      colorDistribution: colorCount,
      averageWearCount: Math.round(stat.avgWearCount * 100) / 100,
      wearRange: {
        min: stat.leastWorn || 0,
        max: stat.mostWorn || 0
      },
      totalWears: stat.totalWears || 0,
      rarelyWornCount: rarelyWorn,
      recentWearsCount: recentWears,
      utilizationRate: stat.totalClothes > 0 ? Math.round((recentWears / stat.totalClothes) * 100) : 0
    });

  } catch (error) {
    console.error('統計錯誤:', error);
    res.status(500).json({ message: '獲取統計失敗', error: error.message });
  }
});

// 獲取淘汰建議
router.get('/declutter-suggestions', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const mongoose = require('mongoose');
    const { filter = 'all' } = req.query;
    
    // 獲取用戶所有衣物
    const clothes = await Clothing.find({ userId: mongoose.Types.ObjectId(userId) });
    const suggestions = [];
    
    // 分析很少穿的衣物 (穿著次數 < 2 且添加超過30天)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    clothes.forEach(clothing => {
      if (clothing.wearCount < 2 && clothing.createdAt < thirtyDaysAgo) {
        suggestions.push({
          ...clothing.toObject(),
          reason: '很少穿著',
          suggestion: '考慮捐贈或出售，為常穿的衣物騰出空間',
          priority: 'medium'
        });
      }
      
      // 檢查重複衣物
      const similar = clothes.filter(c => 
        c._id !== clothing._id && 
        c.category === clothing.category && 
        c.subCategory === clothing.subCategory &&
        c.colors.some(color => clothing.colors.includes(color))
      );
      
      if (similar.length > 2) {
        suggestions.push({
          ...clothing.toObject(),
          reason: '重複過多',
          suggestion: '保留最喜歡的1-2件，其他可以考慮淘汰',
          priority: 'low'
        });
      }
    });

    // 根據篩選條件過濾
    let filteredSuggestions = suggestions;
    if (filter !== 'all') {
      filteredSuggestions = suggestions.filter(s => {
        switch (filter) {
          case 'rarely-worn': return s.reason === '很少穿著';
          case 'duplicates': return s.reason === '重複過多';
          case 'poor-condition': return s.reason === '狀況不佳';
          default: return true;
        }
      });
    }

    const summary = {
      total: suggestions.length,
      rarelyWorn: suggestions.filter(s => s.reason === '很少穿著').length,
      duplicate: suggestions.filter(s => s.reason === '重複過多').length,
      damaged: suggestions.filter(s => s.reason === '狀況不佳').length
    };

    res.json({
      suggestions: filteredSuggestions.slice(0, 20), // 限制返回數量
      summary
    });

  } catch (error) {
    console.error('獲取淘汰建議錯誤:', error);
    res.status(500).json({ message: '獲取淘汰建議失敗', error: error.message });
  }
});

// 標記衣物為保留
router.post('/:id/keep', auth, async (req, res) => {
  try {
    const clothing = await Clothing.findOne({ 
      _id: req.params.id, 
      userId: req.user.id 
    });

    if (!clothing) {
      return res.status(404).json({ message: '衣物不存在' });
    }

    clothing.keepUntil = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000); // 90天後再提醒
    await clothing.save();

    res.json({ message: '已標記為保留', clothing });

  } catch (error) {
    res.status(500).json({ message: '操作失敗', error: error.message });
  }
});

// 獲取穿著趨勢數據
router.get('/wear-trends', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const mongoose = require('mongoose');
    const { days = 30 } = req.query;
    
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(days));
    
    // 按日期統計穿著次數
    const trends = await Clothing.aggregate([
      { 
        $match: { 
          userId: mongoose.Types.ObjectId(userId),
          lastWorn: { $gte: startDate }
        }
      },
      {
        $group: {
          _id: {
            $dateToString: {
              format: "%Y-%m-%d",
              date: "$lastWorn"
            }
          },
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    // 填充缺失的日期
    const trendData = [];
    for (let i = parseInt(days) - 1; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      
      const dayData = trends.find(t => t._id === dateStr);
      trendData.push({
        date: dateStr,
        count: dayData ? dayData.count : 0
      });
    }

    res.json({
      trends: trendData,
      totalDays: parseInt(days),
      averageDaily: trendData.reduce((sum, day) => sum + day.count, 0) / parseInt(days)
    });

  } catch (error) {
    res.status(500).json({ message: '獲取穿著趨勢失敗', error: error.message });
  }
});

// 重新分析衣物
router.post('/:id/reanalyze', auth, async (req, res) => {
  try {
    const clothing = await Clothing.findOne({ 
      _id: req.params.id, 
      userId: req.user.id 
    });

    if (!clothing) {
      return res.status(404).json({ message: '衣物不存在' });
    }

    // 讀取原始圖片
    const fs = require('fs');
    const imagePath = path.join(__dirname, '..', clothing.imageUrl);
    
    if (!fs.existsSync(imagePath)) {
      return res.status(404).json({ message: '圖片文件不存在' });
    }

    const imageBuffer = fs.readFileSync(imagePath);
    const imageBase64 = imageBuffer.toString('base64');

    // 重新進行AI分析
    const aiAnalysis = await aiService.analyzeClothing(imageBase64);

    // 更新衣物記錄
    clothing.category = aiAnalysis.category;
    clothing.subCategory = aiAnalysis.subCategory;
    clothing.colors = aiAnalysis.colors;
    clothing.style = aiAnalysis.style;
    clothing.season = aiAnalysis.season;
    clothing.aiAnalysis = {
      confidence: aiAnalysis.confidence,
      detectedFeatures: aiAnalysis.detectedFeatures,
      suggestedTags: aiAnalysis.suggestedTags,
      reanalyzedAt: new Date()
    };

    await clothing.save();

    res.json({
      message: '重新分析完成',
      clothing: clothing,
      aiAnalysis: aiAnalysis
    });

  } catch (error) {
    console.error('重新分析錯誤:', error);
    res.status(500).json({ message: '重新分析失敗', error: error.message });
  }
});

// 批量記錄穿著
router.post('/batch-wear', auth, async (req, res) => {
  try {
    const { clothingIds } = req.body;
    const userId = req.user.id;
    
    if (!clothingIds || !Array.isArray(clothingIds)) {
      return res.status(400).json({ message: '請提供有效的衣物ID列表' });
    }

    const result = await Clothing.updateMany(
      { 
        _id: { $in: clothingIds },
        userId: userId
      },
      {
        $inc: { wearCount: 1 },
        $set: { lastWorn: new Date() }
      }
    );

    res.json({
      message: `已記錄 ${result.modifiedCount} 件衣物的穿著`,
      updatedCount: result.modifiedCount
    });

  } catch (error) {
    res.status(500).json({ message: '批量記錄失敗', error: error.message });
  }
});

module.exports = router;
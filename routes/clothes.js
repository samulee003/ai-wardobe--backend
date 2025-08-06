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

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB限制
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

// 上傳並分析衣物
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
      }
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
    const userId = req.user.id;
    const mongoose = require('mongoose');
    
    const stats = await Clothing.aggregate([
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

    if (stats.length === 0) {
      return res.json({ 
        message: '暫無衣物數據',
        totalClothes: 0,
        categoryDistribution: {},
        colorDistribution: {},
        averageWearCount: 0,
        wearRange: { min: 0, max: 0 }
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
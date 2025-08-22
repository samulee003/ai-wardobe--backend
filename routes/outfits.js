const express = require('express');
const Clothing = require('../models/Clothing');
const aiService = require('../services/aiService');
const auth = require('../middleware/auth');

const router = express.Router();

// 整套穿搭分析（照片 → 多物件 + 整體風格）
router.post('/analyze', auth, async (req, res) => {
  try {
    const { imageBase64 } = req.body || {};
    if (!imageBase64 || typeof imageBase64 !== 'string') {
      return res.status(400).json({ message: '缺少 imageBase64（不含 data: 前綴）' });
    }

    const analysis = await aiService.analyzeOutfit(imageBase64);
    return res.json({ message: '分析成功', analysis });
  } catch (error) {
    console.error('Outfit 分析端點錯誤:', error);
    return res.status(500).json({ message: '分析失敗', error: error.message });
  }
});

// 獲取穿搭推薦
router.get('/recommendations', auth, async (req, res) => {
  try {
    const { occasion, season, style, limit = 8 } = req.query;
    const userId = req.user.id;

    // 獲取用戶所有衣物
    let clothesQuery = { userId };
    
    // 根據查詢參數篩選
    if (season) clothesQuery.season = { $in: [season] };
    if (style) clothesQuery.style = style;

    const userClothes = await Clothing.find(clothesQuery).lean();

    if (userClothes.length < 3) {
      return res.json({
        message: '衣物數量不足，請先添加更多衣物',
        recommendations: []
      });
    }

    // 獲取用戶偏好
    const userPreferences = {
      occasion: occasion || 'daily',
      preferredStyles: req.user.profile?.preferredStyles || [],
      colorPreferences: req.user.profile?.colorPreferences || [],
      // 已移除 ADHD 偏好
    };

    // 生成推薦
    const recommendations = await aiService.generateOutfitRecommendations(
      userClothes, 
      userPreferences
    );

    // 限制返回數量
    const limitedRecommendations = recommendations.slice(0, parseInt(limit));

    res.json({
      message: '穿搭推薦生成成功',
      recommendations: limitedRecommendations,
      totalClothes: userClothes.length,
      aiService: aiService.preferredAI
    });

  } catch (error) {
    console.error('穿搭推薦錯誤:', error);
    res.status(500).json({ 
      message: '生成推薦失敗', 
      error: error.message,
      recommendations: []
    });
  }
});

// 提交推薦反饋
router.post('/feedback', auth, async (req, res) => {
  try {
    const { outfitItems, feedback, rating } = req.body;
    const userId = req.user.id;

    // 這裡可以記錄用戶反饋，用於改進推薦算法
    // 暫時返回成功響應
    res.json({
      message: '反饋提交成功',
      feedback: {
        items: outfitItems,
        rating,
        feedback,
        timestamp: new Date()
      }
    });

  } catch (error) {
    res.status(500).json({ message: '提交反饋失敗', error: error.message });
  }
});

// 獲取穿搭歷史
router.get('/history', auth, async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    
    // 這裡應該從數據庫獲取穿搭歷史
    // 暫時返回空數組
    res.json({
      history: [],
      totalPages: 0,
      currentPage: parseInt(page),
      total: 0
    });

  } catch (error) {
    res.status(500).json({ message: '獲取穿搭歷史失敗', error: error.message });
  }
});

// 保存穿搭組合
router.post('/save', auth, async (req, res) => {
  try {
    const { name, items, style, occasion } = req.body;
    const userId = req.user.id;

    // 驗證衣物是否屬於用戶
    const clothingItems = await Clothing.find({
      _id: { $in: items },
      userId: userId
    });

    if (clothingItems.length !== items.length) {
      return res.status(400).json({ message: '包含無效的衣物項目' });
    }

    // 這裡應該保存到Outfit模型
    // 暫時返回成功響應
    res.json({
      message: '穿搭組合保存成功',
      outfit: {
        id: 'temp-id',
        name,
        items,
        style,
        occasion,
        createdAt: new Date()
      }
    });

  } catch (error) {
    res.status(500).json({ message: '保存穿搭組合失敗', error: error.message });
  }
});

module.exports = router;
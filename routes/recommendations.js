const express = require('express');
const Clothing = require('../models/Clothing');
const auth = require('../middleware/auth');

const router = express.Router();

// 獲取衣物淘汰建議
router.get('/declutter', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    
    const twelveMonthsAgo = new Date();
    twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);

    // 查找很少穿的衣物
    const rarelyWornClothes = await Clothing.find({
      userId,
      $or: [
        { wearCount: { $lt: 3 }, createdAt: { $lt: twelveMonthsAgo } },
        { lastWorn: { $lt: sixMonthsAgo } },
        { lastWorn: null, createdAt: { $lt: sixMonthsAgo } }
      ]
    });

    // 查找狀況不佳的衣物
    const damagedClothes = await Clothing.find({
      userId,
      condition: { $in: ['磨損', '需淘汰'] }
    });

    // 查找重複過多的衣物
    const duplicateAnalysis = await Clothing.aggregate([
      { $match: { userId } },
      {
        $group: {
          _id: { category: '$category', subCategory: '$subCategory', colors: '$colors' },
          count: { $sum: 1 },
          items: { $push: '$$ROOT' }
        }
      },
      { $match: { count: { $gt: 3 } } }
    ]);

    const duplicateClothes = duplicateAnalysis.flatMap(group => 
      group.items.slice(2) // 保留2件，其餘標記為重複
    );

    // 組合所有建議
    const suggestions = [
      ...rarelyWornClothes.map(item => ({
        ...item.toObject(),
        reason: '很少穿著',
        suggestion: '考慮捐贈或出售',
        priority: 'medium'
      })),
      ...damagedClothes.map(item => ({
        ...item.toObject(),
        reason: '狀況不佳',
        suggestion: '建議淘汰',
        priority: 'high'
      })),
      ...duplicateClothes.map(item => ({
        ...item,
        reason: '重複過多',
        suggestion: '保留最喜歡的幾件',
        priority: 'low'
      }))
    ];

    res.json({
      message: '淘汰建議生成成功',
      suggestions: suggestions.slice(0, 20), // 限制返回數量
      summary: {
        total: suggestions.length,
        rarelyWorn: rarelyWornClothes.length,
        damaged: damagedClothes.length,
        duplicate: duplicateClothes.length
      }
    });

  } catch (error) {
    console.error('淘汰建議錯誤:', error);
    res.status(500).json({ message: '生成淘汰建議失敗', error: error.message });
  }
});

// 獲取購買建議
router.get('/shopping', auth, async (req, res) => {
  try {
    const userId = req.user.id;

    // 分析衣櫃缺口
    const clothingStats = await Clothing.aggregate([
      { $match: { userId } },
      {
        $group: {
          _id: '$category',
          count: { $sum: 1 },
          styles: { $addToSet: '$style' },
          colors: { $addToSet: { $arrayElemAt: ['$colors', 0] } }
        }
      }
    ]);

    const recommendations = [];

    // 基本衣物建議
    const basicNeeds = {
      '上衣': { min: 5, styles: ['休閒', '正式'] },
      '下裝': { min: 3, styles: ['休閒', '正式'] },
      '外套': { min: 2, styles: ['休閒'] },
      '鞋子': { min: 3, styles: ['休閒', '正式', '運動'] }
    };

    for (const [category, needs] of Object.entries(basicNeeds)) {
      const stat = clothingStats.find(s => s._id === category);
      const currentCount = stat ? stat.count : 0;
      
      if (currentCount < needs.min) {
        recommendations.push({
          category,
          reason: `${category}數量不足 (目前${currentCount}件，建議${needs.min}件)`,
          suggestion: `建議購買${needs.min - currentCount}件${category}`,
          priority: currentCount === 0 ? 'high' : 'medium',
          suggestedStyles: needs.styles
        });
      }
    }

    res.json({
      message: '購買建議生成成功',
      recommendations,
      currentStats: clothingStats
    });

  } catch (error) {
    res.status(500).json({ message: '生成購買建議失敗', error: error.message });
  }
});

module.exports = router;
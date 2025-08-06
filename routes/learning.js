const express = require('express');
const learningService = require('../services/learningService');
const auth = require('../middleware/auth');

const router = express.Router();

// 記錄用戶行為
router.post('/behavior', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const behaviorData = req.body;

    // 驗證必需字段
    if (!behaviorData.action || !behaviorData.targetType) {
      return res.status(400).json({ 
        message: '缺少必需的行為數據' 
      });
    }

    // 添加上下文信息
    const enrichedBehaviorData = {
      ...behaviorData,
      context: {
        ...behaviorData.context,
        userAgent: req.get('User-Agent'),
        deviceType: req.get('User-Agent')?.includes('Mobile') ? 'mobile' : 'desktop',
        sessionId: req.sessionID || `session_${Date.now()}`
      }
    };

    const behavior = await learningService.recordBehavior(userId, enrichedBehaviorData);

    res.json({
      message: '行為記錄成功',
      behaviorId: behavior._id
    });

  } catch (error) {
    console.error('記錄行為錯誤:', error);
    res.status(500).json({ 
      message: '記錄行為失敗', 
      error: error.message 
    });
  }
});

// 獲取用戶偏好權重
router.get('/weights', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const weights = await learningService.generateRecommendationWeights(userId);

    res.json({
      message: '獲取偏好權重成功',
      weights
    });

  } catch (error) {
    console.error('獲取權重錯誤:', error);
    res.status(500).json({ 
      message: '獲取偏好權重失敗', 
      error: error.message 
    });
  }
});

// 獲取用戶行為模式分析
router.get('/patterns', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { days = 30 } = req.query;

    const patterns = await learningService.analyzeUserPatterns(userId, parseInt(days));

    res.json({
      message: '獲取行為模式成功',
      patterns,
      period: `過去${days}天`
    });

  } catch (error) {
    console.error('分析模式錯誤:', error);
    res.status(500).json({ 
      message: '獲取行為模式失敗', 
      error: error.message 
    });
  }
});

// 生成個性化風格報告
router.get('/style-report', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const report = await learningService.generateStyleReport(userId);

    res.json({
      message: '風格報告生成成功',
      report
    });

  } catch (error) {
    console.error('生成報告錯誤:', error);
    res.status(500).json({ 
      message: '生成風格報告失敗', 
      error: error.message 
    });
  }
});

// 批量記錄行為（用於離線同步）
router.post('/behaviors/batch', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { behaviors } = req.body;

    if (!Array.isArray(behaviors)) {
      return res.status(400).json({ 
        message: '行為數據必須是數組格式' 
      });
    }

    const results = [];
    
    for (const behaviorData of behaviors) {
      try {
        const enrichedBehaviorData = {
          ...behaviorData,
          context: {
            ...behaviorData.context,
            userAgent: req.get('User-Agent'),
            deviceType: req.get('User-Agent')?.includes('Mobile') ? 'mobile' : 'desktop',
            sessionId: behaviorData.context?.sessionId || `session_${Date.now()}`
          }
        };

        const behavior = await learningService.recordBehavior(userId, enrichedBehaviorData);
        results.push({ success: true, behaviorId: behavior._id });
        
      } catch (error) {
        results.push({ success: false, error: error.message });
      }
    }

    const successCount = results.filter(r => r.success).length;

    res.json({
      message: `批量記錄完成，成功 ${successCount}/${behaviors.length} 條`,
      results
    });

  } catch (error) {
    console.error('批量記錄錯誤:', error);
    res.status(500).json({ 
      message: '批量記錄行為失敗', 
      error: error.message 
    });
  }
});

// 重置用戶學習數據
router.delete('/reset', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const User = require('../models/User');
    const UserBehavior = require('../models/UserBehavior');

    // 清除學習數據
    await User.findByIdAndUpdate(userId, {
      $unset: { learningData: 1 }
    });

    // 可選：清除行為記錄
    if (req.query.clearBehaviors === 'true') {
      await UserBehavior.deleteMany({ userId });
    }

    res.json({
      message: '學習數據重置成功'
    });

  } catch (error) {
    console.error('重置學習數據錯誤:', error);
    res.status(500).json({ 
      message: '重置學習數據失敗', 
      error: error.message 
    });
  }
});

module.exports = router;
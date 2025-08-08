const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');

/**
 * 保存 AI 供應商設定
 * POST /api/settings/ai-provider
 */
router.post('/ai-provider', auth, async (req, res) => {
  try {
    const { provider } = req.body;
    
    if (!provider) {
      return res.status(400).json({ message: '請指定 AI 供應商' });
    }
    
    const validProviders = ['openai', 'gemini', 'fallback'];
    if (!validProviders.includes(provider)) {
      return res.status(400).json({ message: '無效的 AI 供應商' });
    }
    
    // 更新環境變數（僅在當前會話中有效）
    process.env.PREFERRED_AI_SERVICE = provider;
    
    // 這裡可以擴展為保存到資料庫或配置檔案
    // 目前暫時只更新環境變數
    
    res.json({
      success: true,
      provider,
      message: `AI 供應商已設定為 ${provider}`,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('保存 AI 供應商設定失敗:', error);
    res.status(500).json({ 
      message: '保存設定失敗',
      error: error.message 
    });
  }
});

/**
 * 獲取當前設定
 * GET /api/settings
 */
router.get('/', auth, async (req, res) => {
  try {
    const settings = {
      aiProvider: process.env.PREFERRED_AI_SERVICE || 'openai',
      hasOpenAIKey: !!process.env.OPENAI_API_KEY,
      hasGeminiKey: !!process.env.GEMINI_API_KEY,
      timestamp: new Date().toISOString()
    };
    
    res.json(settings);
    
  } catch (error) {
    console.error('獲取設定失敗:', error);
    res.status(500).json({ 
      message: '獲取設定失敗',
      error: error.message 
    });
  }
});

module.exports = router;

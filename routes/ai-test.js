const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const aiService = require('../services/aiService');

/**
 * 測試 AI 供應商連線狀態
 * POST /api/ai-test
 */
router.post('/', auth, async (req, res) => {
  try {
    const { provider, testImage } = req.body;
    
    if (!provider) {
      return res.status(400).json({ message: '請指定要測試的 AI 供應商' });
    }
    
    if (!testImage) {
      return res.status(400).json({ message: '請提供測試圖片' });
    }
    
    const startTime = Date.now();
    let result;
    
    try {
      // 根據指定的供應商進行測試
      switch (provider) {
        case 'openai':
          if (!process.env.OPENAI_API_KEY) {
            return res.status(400).json({ 
              message: 'OpenAI API Key 未設定',
              provider,
              available: false
            });
          }
          result = await aiService.analyzeWithOpenAI(testImage);
          break;
          
        case 'gemini':
          if (!process.env.GEMINI_API_KEY) {
            return res.status(400).json({ 
              message: 'Gemini API Key 未設定',
              provider,
              available: false
            });
          }
          result = await aiService.analyzeWithGemini(testImage);
          break;
        case 'kimi':
          if (!process.env.KIMI_API_KEY) {
            return res.status(400).json({
              message: 'KIMI API Key 未設定',
              provider,
              available: false
            });
          }
          result = await aiService.analyzeWithKimi(testImage);
          break;
        case 'zhipu':
          if (!process.env.ZHIPU_API_KEY) {
            return res.status(400).json({
              message: 'ZHIPU API Key 未設定',
              provider,
              available: false
            });
          }
          result = await aiService.analyzeWithZhipu(testImage);
          break;
          
        case 'fallback':
          result = await aiService.getFallbackAnalysis();
          break;
          
        default:
          return res.status(400).json({ message: `不支援的 AI 供應商: ${provider}` });
      }
      
      const latency = Date.now() - startTime;
      
      // 記錄成功的測試（isError=false）
      aiService.recordMetrics(provider, latency, false);
      
      res.json({
        success: true,
        provider,
        latency,
        result: {
          category: result.category || '測試類別',
          colors: result.colors || ['測試顏色'],
          confidence: result.confidence || 0.8
        },
        timestamp: new Date().toISOString()
      });
      
    } catch (error) {
      const latency = Date.now() - startTime;
      
      // 記錄失敗的測試（isError=true）
      aiService.recordMetrics(provider, latency, true);
      
      console.error(`AI 供應商 ${provider} 測試失敗:`, error);
      
      res.status(500).json({
        success: false,
        provider,
        latency,
        message: error.message || 'AI 分析失敗',
        timestamp: new Date().toISOString()
      });
    }
    
  } catch (error) {
    console.error('AI 測試路由錯誤:', error);
    res.status(500).json({ 
      message: '測試請求處理失敗',
      error: error.message 
    });
  }
});

/**
 * 獲取 AI 供應商狀態
 * GET /api/ai-test/status
 */
router.get('/status', auth, async (req, res) => {
  try {
    const metrics = aiService.getMetrics();
    
      const status = {
      providers: {
        openai: {
          available: !!process.env.OPENAI_API_KEY,
          totalAnalyses: metrics.byService.openai?.count || 0,
          avgLatency: metrics.byService.openai?.avgLatency || 0,
          lastUsed: metrics.byService.openai?.lastUsed || null
        },
        gemini: {
          available: !!process.env.GEMINI_API_KEY,
          totalAnalyses: metrics.byService.gemini?.count || 0,
          avgLatency: metrics.byService.gemini?.avgLatency || 0,
          lastUsed: metrics.byService.gemini?.lastUsed || null
        },
          kimi: {
            available: !!process.env.KIMI_API_KEY,
            totalAnalyses: metrics.byService.kimi?.count || 0,
            avgLatency: metrics.byService.kimi?.avgLatency || 0,
            lastUsed: metrics.byService.kimi?.lastUsed || null
          },
          zhipu: {
            available: !!process.env.ZHIPU_API_KEY,
            totalAnalyses: metrics.byService.zhipu?.count || 0,
            avgLatency: metrics.byService.zhipu?.avgLatency || 0,
            lastUsed: metrics.byService.zhipu?.lastUsed || null
          },
        fallback: {
          available: true,
          totalAnalyses: metrics.byService.fallback?.count || 0,
          avgLatency: metrics.byService.fallback?.avgLatency || 0,
          lastUsed: metrics.byService.fallback?.lastUsed || null
        }
      },
      preferred: aiService.preferredAI,
      totalAnalyses: metrics.totalAnalyses,
      errorCount: metrics.errorCount,
      lastAnalysis: metrics.lastAnalysis
    };
    
    res.json(status);
    
  } catch (error) {
    console.error('獲取 AI 狀態失敗:', error);
    res.status(500).json({ 
      message: '獲取狀態失敗',
      error: error.message 
    });
  }
});

module.exports = router;
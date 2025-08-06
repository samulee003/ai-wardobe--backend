const express = require('express');
const multer = require('multer');
const aiService = require('../services/aiService');
const auth = require('../middleware/auth');

const router = express.Router();

const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }
});

// 測試不同AI服務的衣物識別
router.post('/test-analysis', auth, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: '請上傳測試圖片' });
    }

    const imageBase64 = req.file.buffer.toString('base64');
    const testService = req.body.service || 'auto';

    let results = {};

    if (testService === 'all') {
      // 測試所有可用的AI服務
      const services = ['openai', 'gemini', 'anthropic', 'google-vision'];
      
      for (const service of services) {
        try {
          console.log(`測試 ${service}...`);
          
          // 臨時設置服務
          const originalService = aiService.preferredAI;
          aiService.preferredAI = service;
          
          const startTime = Date.now();
          const result = await aiService.analyzeClothing(imageBase64);
          const endTime = Date.now();
          
          results[service] = {
            success: true,
            result: result,
            responseTime: endTime - startTime,
            timestamp: new Date().toISOString()
          };
          
          // 恢復原設置
          aiService.preferredAI = originalService;
          
        } catch (error) {
          results[service] = {
            success: false,
            error: error.message,
            timestamp: new Date().toISOString()
          };
        }
      }
    } else {
      // 測試單個服務
      const originalService = aiService.preferredAI;
      if (testService !== 'auto') {
        aiService.preferredAI = testService;
      }
      
      const startTime = Date.now();
      const result = await aiService.analyzeClothing(imageBase64);
      const endTime = Date.now();
      
      results[testService] = {
        success: true,
        result: result,
        responseTime: endTime - startTime,
        timestamp: new Date().toISOString()
      };
      
      aiService.preferredAI = originalService;
    }

    res.json({
      message: 'AI服務測試完成',
      results: results,
      recommendation: getServiceRecommendation(results)
    });

  } catch (error) {
    console.error('AI測試錯誤:', error);
    res.status(500).json({ 
      message: 'AI測試失敗', 
      error: error.message 
    });
  }
});

// 獲取AI服務狀態
router.get('/service-status', auth, (req, res) => {
  const status = {
    openai: {
      available: !!process.env.OPENAI_API_KEY,
      name: 'OpenAI GPT-4 Vision',
      description: '最強大的視覺理解能力，識別準確度最高',
      cost: '中等',
      speed: '快'
    },
    gemini: {
      available: !!process.env.GEMINI_API_KEY,
      name: 'Google Gemini Pro Vision',
      description: '免費額度大，性能優秀',
      cost: '低',
      speed: '快'
    },
    anthropic: {
      available: !!process.env.ANTHROPIC_API_KEY,
      name: 'Anthropic Claude 3',
      description: '細節分析能力強，回應詳細',
      cost: '中等',
      speed: '中等'
    },
    'google-vision': {
      available: !!process.env.GOOGLE_VISION_API_KEY,
      name: 'Google Vision API',
      description: '傳統視覺API，穩定可靠',
      cost: '低',
      speed: '快'
    }
  };

  const currentService = aiService.preferredAI;
  const availableServices = Object.keys(status).filter(key => status[key].available);

  res.json({
    currentService,
    availableServices,
    serviceDetails: status,
    recommendation: availableServices.length > 0 ? 
      getOptimalService(availableServices) : 
      '請配置至少一個AI服務'
  });
});

// 切換AI服務
router.post('/switch-service', auth, (req, res) => {
  const { service } = req.body;
  const validServices = ['openai', 'gemini', 'anthropic', 'google-vision'];
  
  if (!validServices.includes(service)) {
    return res.status(400).json({ 
      message: '無效的AI服務', 
      validServices 
    });
  }

  aiService.preferredAI = service;
  
  res.json({
    message: `已切換到 ${service}`,
    currentService: service
  });
});

// 獲取服務推薦
function getServiceRecommendation(results) {
  const successful = Object.keys(results).filter(key => results[key].success);
  
  if (successful.length === 0) {
    return '所有服務都失敗了，請檢查API密鑰配置';
  }

  // 根據成功率、響應時間和準確度推薦
  let bestService = successful[0];
  let bestScore = 0;

  for (const service of successful) {
    const result = results[service];
    let score = 0;
    
    // 響應時間評分 (越快越好)
    if (result.responseTime < 2000) score += 3;
    else if (result.responseTime < 5000) score += 2;
    else score += 1;
    
    // 信心度評分
    if (result.result && result.result.confidence > 0.8) score += 3;
    else if (result.result && result.result.confidence > 0.6) score += 2;
    else score += 1;
    
    // 服務偏好評分
    if (service === 'openai') score += 2;
    else if (service === 'gemini') score += 1.5;
    
    if (score > bestScore) {
      bestScore = score;
      bestService = service;
    }
  }

  return `推薦使用 ${bestService}，綜合評分最高`;
}

// 獲取最佳服務
function getOptimalService(availableServices) {
  const priority = ['openai', 'gemini', 'anthropic', 'google-vision'];
  
  for (const service of priority) {
    if (availableServices.includes(service)) {
      return service;
    }
  }
  
  return availableServices[0];
}

module.exports = router;
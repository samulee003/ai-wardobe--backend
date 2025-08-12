const axios = require('axios');
const sharp = require('sharp');

class AIService {
  constructor() {
    // 支援多種AI服務
    this.openaiApiKey = process.env.OPENAI_API_KEY;
    this.anthropicApiKey = process.env.ANTHROPIC_API_KEY;
    this.geminiApiKey = process.env.GEMINI_API_KEY;
    this.kimiApiKey = process.env.KIMI_API_KEY;
    this.visionApiKey = process.env.GOOGLE_VISION_API_KEY;
    
    // API端點
    this.openaiUrl = 'https://api.openai.com/v1/chat/completions';
    this.anthropicUrl = 'https://api.anthropic.com/v1/messages';
    this.geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro-vision:generateContent?key=${this.geminiApiKey}`;
    this.kimiUrl = 'https://api.moonshot.cn/v1/chat/completions';
    this.visionApiUrl = 'https://vision.googleapis.com/v1/images:annotate';
    
    // 預設使用的AI服務 (可在環境變數中配置)
    this.preferredAI = process.env.PREFERRED_AI_SERVICE || 'gemini';

    // 健康指標（記憶體級，重啟後重置）
    this.metrics = {
      totalAnalyses: 0,
      byService: {}, // { openai: { count, lastLatencyMs, errors }, ... }
      last: null // { aiService, latencyMs, at, isError }
    };

    // 嵌入模型
    this.openaiEmbeddingModel = process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small';
  }

  // 衣物識別主函數（加入耗時量測與強健錯誤處理）
  async analyzeClothing(imageBase64) {
    const startAt = Date.now();
    try {
      let analysis;
      
      // 根據配置選擇AI服務
      switch (this.preferredAI) {
        case 'openai':
          analysis = await this.analyzeWithOpenAI(imageBase64);
          break;
        case 'anthropic':
          analysis = await this.analyzeWithAnthropic(imageBase64);
          break;
        case 'gemini':
          analysis = await this.analyzeWithGemini(imageBase64);
          break;
        case 'kimi':
          analysis = await this.analyzeWithKimi(imageBase64);
          break;
        case 'google-vision':
          const visionResult = await this.detectClothingWithVision(imageBase64);
          analysis = this.processVisionResult(visionResult);
          break;
        default:
          // 自動降級：優先順序 OpenAI > Gemini > Anthropic > Google Vision
          analysis = await this.analyzeWithFallback(imageBase64);
      }
      
      const latencyMs = Date.now() - startAt;
      const result = {
        category: analysis.category,
        subCategory: analysis.subCategory,
        colors: analysis.colors,
        style: analysis.style,
        season: analysis.season,
        confidence: analysis.confidence,
        detectedFeatures: analysis.features,
        suggestedTags: analysis.tags,
        aiService: analysis.aiService || this.preferredAI,
        latencyMs
      };
      // 若顏色缺失或信心不足，使用本地啟發式再補強
      if (!result.colors || result.colors.length === 0 || (result.colors.length === 1 && result.colors[0] === '未知') || (typeof result.confidence === 'number' && result.confidence < 0.6)) {
        const local = await this.analyzeWithLocalHeuristics(imageBase64).catch(() => null);
        if (local) {
          result.colors = local.colors && local.colors.length ? local.colors : result.colors;
          if (!result.subCategory || result.subCategory === '一般') {
            result.subCategory = local.subCategory || result.subCategory;
          }
          if (!result.category) result.category = local.category || '上衣';
          if (!result.season || result.season.length === 0) result.season = local.season || ['春', '秋'];
          result.aiService = `${result.aiService}+local`;
          result.confidence = Math.max(result.confidence || 0.5, 0.7);
        }
      }

      this.recordMetrics(result.aiService, latencyMs);
      return result;
    } catch (error) {
      const latencyMs = Date.now() - startAt;
      console.error('AI分析錯誤:', error.message || error);
      const fallback = this.getFallbackAnalysis();
      this.recordMetrics('fallback', latencyMs, true);
      return { ...fallback, aiService: 'fallback', latencyMs };
    }
  }

  // Moonshot Kimi Vision 分析（OpenAI 相容接口）
  async analyzeWithKimi(imageBase64) {
    const model = process.env.KIMI_VISION_MODEL || 'moonshot-v1-8k-vision-preview';
    const prompt = `請分析這張衣物圖片，並以JSON格式回傳以下資訊：\n{\n  "category": "衣物主類別(上衣/下裝/外套/鞋子/配件/內衣/運動服/正裝)",\n  "subCategory": "具體類型(如T恤、襯衫、牛仔褲等)",\n  "colors": ["主要顏色1", "主要顏色2", "主要顏色3"],\n  "style": "風格(休閒/正式/運動/時尚/復古/簡約/街頭)",\n  "season": ["適合季節"],\n  "features": ["特徵描述"],\n  "tags": ["標籤"],\n  "confidence": 0.9\n}`;

    const body = {
      model,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            {
              type: 'image_url',
              image_url: { url: `data:image/jpeg;base64,${imageBase64}` }
            }
          ]
        }
      ]
    };

    const response = await axios.post(this.kimiUrl, body, {
      headers: {
        Authorization: `Bearer ${this.kimiApiKey}`,
        'Content-Type': 'application/json'
      },
      timeout: 15000
    });

    const content = response.data?.choices?.[0]?.message?.content || '';
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const analysis = JSON.parse(jsonMatch[0]);
      return { ...analysis, aiService: 'kimi' };
    }
    throw new Error('無法解析Kimi回應');
  }

  // OpenAI GPT-4 Vision 分析
  async analyzeWithOpenAI(imageBase64) {
    const prompt = `請分析這張衣物圖片，並以JSON格式回傳以下資訊：
{
  "category": "衣物主類別(上衣/下裝/外套/鞋子/配件/內衣/運動服/正裝)",
  "subCategory": "具體類型(如T恤、襯衫、牛仔褲等)",
  "colors": ["主要顏色1", "主要顏色2", "主要顏色3"],
  "style": "風格(休閒/正式/運動/時尚/復古/簡約/街頭)",
  "season": ["適合季節"],
  "features": ["特徵描述"],
  "tags": ["標籤"],
  "confidence": 0.95,
  "condition": "衣物狀況(全新/良好/普通/磨損)",
  "occasion": "適合場合"
}

請仔細觀察衣物的材質、顏色、款式、狀況等細節。`;

    // 帶超時與一次重試的請求
    const makeRequest = async () => axios.post(this.openaiUrl, {
      model: "gpt-4-vision-preview",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            {
              type: "image_url",
              image_url: {
                url: `data:image/jpeg;base64,${imageBase64}`,
                detail: "high"
              }
            }
          ]
        }
      ],
      max_tokens: 1000,
      temperature: 0.1
    }, {
      headers: {
        'Authorization': `Bearer ${this.openaiApiKey}`,
        'Content-Type': 'application/json'
      },
      timeout: 15000
    });

    let response;
    try {
      response = await makeRequest();
    } catch (err) {
      // 簡單重試一次（針對超時/5xx）
      const status = err.response?.status;
      if (err.code === 'ECONNABORTED' || (status && status >= 500)) {
        await new Promise(r => setTimeout(r, 1000));
        response = await makeRequest();
      } else {
        throw err;
      }
    }

    const content = response.data.choices[0].message.content;
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    
    if (jsonMatch) {
      const analysis = JSON.parse(jsonMatch[0]);
      return {
        ...analysis,
        aiService: 'openai'
      };
    }
    
    throw new Error('無法解析OpenAI回應');
  }

  // 指標記錄
  recordMetrics(service, latencyMs, isError = false) {
    this.metrics.totalAnalyses += 1;
    if (!this.metrics.byService[service]) {
      this.metrics.byService[service] = { count: 0, lastLatencyMs: 0, errors: 0 };
    }
    this.metrics.byService[service].count += 1;
    this.metrics.byService[service].lastLatencyMs = latencyMs;
    if (isError) this.metrics.byService[service].errors += 1;
    this.metrics.last = { aiService: service, latencyMs, at: new Date().toISOString(), isError };
  }

  // 對外提供健康指標
  getMetrics() {
    return {
      preferredAI: this.preferredAI,
      totalAnalyses: this.metrics.totalAnalyses,
      byService: this.metrics.byService,
      last: this.metrics.last,
      hasKeys: {
        openai: !!this.openaiApiKey,
        anthropic: !!this.anthropicApiKey,
        gemini: !!this.geminiApiKey,
        googleVision: !!this.visionApiKey
      }
    };
  }

  // 生成文字嵌入（用於自然語言搜尋與相似度）
  async embedText(text) {
    if (!text || text.trim().length === 0) return [];
    if (!this.openaiApiKey) {
      // 沒有 OpenAI 金鑰時，回傳空向量（用本地規則降級）
      return [];
    }
    const response = await axios.post('https://api.openai.com/v1/embeddings', {
      model: this.openaiEmbeddingModel,
      input: text
    }, {
      headers: {
        'Authorization': `Bearer ${this.openaiApiKey}`,
        'Content-Type': 'application/json'
      },
      timeout: 10000
    });
    return response.data.data?.[0]?.embedding || [];
  }

  // Anthropic Claude Vision 分析
  async analyzeWithAnthropic(imageBase64) {
    const prompt = `請分析這張衣物圖片，提供詳細的衣物資訊。請以JSON格式回傳：
{
  "category": "主類別",
  "subCategory": "具體類型", 
  "colors": ["顏色陣列"],
  "style": "風格",
  "season": ["季節陣列"],
  "features": ["特徵陣列"],
  "tags": ["標籤陣列"],
  "confidence": 信心度,
  "condition": "狀況",
  "occasion": "場合"
}`;

    const response = await axios.post(this.anthropicUrl, {
      model: "claude-3-sonnet-20240229",
      max_tokens: 1000,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: "image/jpeg",
                data: imageBase64
              }
            },
            {
              type: "text",
              text: prompt
            }
          ]
        }
      ]
    }, {
      headers: {
        'x-api-key': this.anthropicApiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json'
      }
    });

    const content = response.data.content[0].text;
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    
    if (jsonMatch) {
      const analysis = JSON.parse(jsonMatch[0]);
      return {
        ...analysis,
        aiService: 'anthropic'
      };
    }
    
    throw new Error('無法解析Anthropic回應');
  }

  // Google Gemini Vision 分析
  async analyzeWithGemini(imageBase64) {
    const prompt = `請仔細分析這張衣物圖片，作為專業的時尚顧問，為成人用戶提供詳細的衣物資訊。請以JSON格式回傳：

{
  "category": "衣物主類別(上衣/下裝/外套/鞋子/配件/內衣/運動服/正裝)",
  "subCategory": "具體類型(如T恤、襯衫、牛仔褲、運動鞋等)",
  "colors": ["主要顏色1", "主要顏色2", "主要顏色3"],
  "style": "風格(休閒/正式/運動/時尚/復古/簡約/街頭)",
  "season": ["適合季節"],
  "features": ["材質特徵", "設計特點", "版型描述"],
  "tags": ["實用標籤"],
  "confidence": 0.95,
  "condition": "衣物狀況(全新/良好/普通/磨損)",
  "occasion": "適合場合(日常/工作/運動/正式)",
  "materialGuess": "材質推測",
  "careInstructions": "保養建議"
}

    請特別注意：
    1. 準確識別衣物類別和顏色
    2. 評估衣物的實用性和搭配性
    3. 提供實用的穿搭建議`;

    const response = await axios.post(this.geminiUrl, {
      contents: [{
        parts: [
          { text: prompt },
          {
            inline_data: {
              mime_type: "image/jpeg",
              data: imageBase64
            }
          }
        ]
      }]
    }, {
      headers: {
        'Content-Type': 'application/json'
      }
    });

    const content = response.data.candidates[0].content.parts[0].text;
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    
    if (jsonMatch) {
      const analysis = JSON.parse(jsonMatch[0]);
      return {
        ...analysis,
        aiService: 'gemini'
      };
    }
    
    throw new Error('無法解析Gemini回應');
  }

  // 自動降級分析
  async analyzeWithFallback(imageBase64) {
    const services = ['gemini', 'openai', 'kimi', 'anthropic', 'google-vision'];
    
    for (const service of services) {
      try {
        console.log(`嘗試使用 ${service} 進行分析...`);
        
        switch (service) {
          case 'openai':
            if (this.openaiApiKey) return await this.analyzeWithOpenAI(imageBase64);
            break;
          case 'gemini':
            if (this.geminiApiKey) return await this.analyzeWithGemini(imageBase64);
            break;
          case 'kimi':
            if (this.kimiApiKey) return await this.analyzeWithKimi(imageBase64);
            break;
          case 'anthropic':
            if (this.anthropicApiKey) return await this.analyzeWithAnthropic(imageBase64);
            break;
          case 'google-vision':
            if (this.visionApiKey) {
              const visionResult = await this.detectClothingWithVision(imageBase64);
              return this.processVisionResult(visionResult);
            }
            break;
        }
      } catch (error) {
        console.warn(`${service} 分析失敗:`, error.message);
        continue;
      }
    }
    
    throw new Error('所有AI服務都無法使用');
  }

  // Google Vision API 衣物檢測 (保留作為備用)
  async detectClothingWithVision(imageBase64) {
    const requestBody = {
      requests: [{
        image: {
          content: imageBase64
        },
        features: [
          { type: 'LABEL_DETECTION', maxResults: 20 },
          { type: 'IMAGE_PROPERTIES', maxResults: 10 },
          { type: 'OBJECT_LOCALIZATION', maxResults: 10 }
        ]
      }]
    };

    const response = await axios.post(
      `${this.visionApiUrl}?key=${this.visionApiKey}`,
      requestBody
    );

    return response.data.responses[0];
  }

  // 處理Vision API結果
  processVisionResult(visionResult) {
    const labels = visionResult.labelAnnotations || [];
    const objects = visionResult.localizedObjectAnnotations || [];
    const colors = this.extractColors(visionResult.imagePropertiesAnnotation);

    // 衣物類別映射
    const categoryMapping = {
      'shirt': '上衣',
      'blouse': '上衣', 
      't-shirt': '上衣',
      'sweater': '上衣',
      'pants': '下裝',
      'jeans': '下裝',
      'skirt': '下裝',
      'dress': '上衣',
      'jacket': '外套',
      'coat': '外套',
      'shoes': '鞋子',
      'sneakers': '鞋子',
      'boots': '鞋子'
    };

    // 風格識別
    const styleMapping = {
      'casual': '休閒',
      'formal': '正式',
      'business': '正式',
      'sport': '運動',
      'athletic': '運動',
      'fashion': '時尚',
      'vintage': '復古'
    };

    let category = '上衣'; // 預設類別
    let style = '休閒'; // 預設風格
    let confidence = 0.5;

    // 分析標籤找出最可能的類別
    for (const label of labels) {
      const labelName = label.description.toLowerCase();
      for (const [key, value] of Object.entries(categoryMapping)) {
        if (labelName.includes(key)) {
          category = value;
          confidence = Math.max(confidence, label.score);
          break;
        }
      }
    }

    return {
      category,
      subCategory: this.getSubCategory(category, labels),
      colors: colors.slice(0, 3), // 取前3個主要顏色
      style,
      season: this.inferSeason(labels, category),
      confidence,
      features: labels.slice(0, 5).map(l => l.description),
      tags: this.generateTags(labels, category)
    };
  }

  // 提取顏色信息
  extractColors(imageProperties) {
    if (!imageProperties || !imageProperties.dominantColors) {
      return ['未知'];
    }

    return imageProperties.dominantColors.colors
      .slice(0, 3)
      .map(color => this.rgbToColorName(color.color));
  }

  // RGB轉顏色名稱
  rgbToColorName(rgb) {
    const r = rgb.red || 0;
    const g = rgb.green || 0;
    const b = rgb.blue || 0;

    // 簡化的顏色識別
    if (r > 200 && g > 200 && b > 200) return '白色';
    if (r < 50 && g < 50 && b < 50) return '黑色';
    if (r > g && r > b) return '紅色';
    if (g > r && g > b) return '綠色';
    if (b > r && b > g) return '藍色';
    if (r > 150 && g > 150 && b < 100) return '黃色';
    if (r > 150 && g < 100 && b > 150) return '紫色';
    if (r > 100 && g > 100 && b > 100) return '灰色';
    
    return '其他';
  }

  // 獲取子類別
  getSubCategory(category, labels) {
    const subCategoryMap = {
      '上衣': ['T恤', '襯衫', '毛衣', '背心', '連身裙'],
      '下裝': ['牛仔褲', '休閒褲', '短褲', '裙子', '運動褲'],
      '外套': ['夾克', '大衣', '風衣', '羽絨服', '西裝外套'],
      '鞋子': ['運動鞋', '皮鞋', '靴子', '涼鞋', '高跟鞋']
    };

    const possibleSubs = subCategoryMap[category] || ['一般'];
    return possibleSubs[0]; // 簡化版本，返回第一個
  }

  // 推斷季節
  inferSeason(labels, category) {
    const seasonKeywords = {
      '夏': ['summer', 'short', 'tank', 'sandal', 'light'],
      '冬': ['winter', 'coat', 'sweater', 'boot', 'warm'],
      '春': ['spring', 'light', 'jacket'],
      '秋': ['autumn', 'fall', 'jacket']
    };

    for (const label of labels) {
      const desc = label.description.toLowerCase();
      for (const [season, keywords] of Object.entries(seasonKeywords)) {
        if (keywords.some(keyword => desc.includes(keyword))) {
          return [season];
        }
      }
    }

    return ['春', '秋']; // 預設適合春秋
  }

  // 生成標籤
  generateTags(labels, category) {
    return labels
      .slice(0, 5)
      .map(label => label.description)
      .filter(tag => tag.length < 10); // 過濾太長的標籤
  }

  // 備用分析結果
  getFallbackAnalysis() {
    return {
      category: '上衣',
      subCategory: '一般',
      colors: ['未知'],
      style: '休閒',
      season: ['春', '秋'],
      confidence: 0.3,
      detectedFeatures: ['衣物'],
      suggestedTags: ['需要重新分析']
    };
  }

  // === 本地啟發式分析（無金鑰或信心不足時） ===
  async analyzeWithLocalHeuristics(imageBase64) {
    const buffer = Buffer.from(imageBase64, 'base64');
    // 降采樣以提速
    const img = sharp(buffer).resize({ width: 64, height: 64, fit: 'inside' });
    const { data, info } = await img.raw().ensureAlpha().toBuffer({ resolveWithObject: true });

    const counts = new Map();
    const push = (name) => counts.set(name, (counts.get(name) || 0) + 1);

    // 量化顏色並計數
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const a = data[i + 3];
      if (a < 10) continue; // 忽略透明
      push(this.mapRgbToColorName(r, g, b));
    }

    // 取得前 3 大顏色
    const palette = Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([name]) => name)
      .filter((n) => n !== '其他')
      .slice(0, 3);

    // 嘗試偵測條紋（簡化版：沿 X 方向的亮度變化）
    const stripes = this.detectStripes(data, info.width, info.height);

    return {
      category: '上衣',
      subCategory: stripes ? '襯衫' : '一般',
      colors: palette.length ? palette : ['未知'],
      style: stripes ? '休閒' : '簡約',
      season: ['春', '秋'],
      confidence: 0.7,
      aiService: 'local-heuristics'
    };
  }

  detectStripes(raw, width, height) {
    // 計算每列亮度變化量（簡化）
    let totalDelta = 0;
    let samples = 0;
    for (let y = 0; y < height; y += 2) {
      let prevL = null;
      for (let x = 0; x < width; x += 2) {
        const i = (y * width + x) * 4;
        const r = raw[i];
        const g = raw[i + 1];
        const b = raw[i + 2];
        const l = 0.2126 * r + 0.7152 * g + 0.0722 * b; // 相對亮度
        if (prevL !== null) {
          totalDelta += Math.abs(l - prevL);
          samples++;
        }
        prevL = l;
      }
    }
    const avgDelta = samples > 0 ? totalDelta / samples : 0;
    return avgDelta > 10; // 閾值（經驗值）
  }

  mapRgbToColorName(r, g, b) {
    // 轉 HSL 以方便分群
    const { h, s, l } = this.rgbToHsl(r, g, b);
    if (l > 0.9) return '白色';
    if (l < 0.12) return '黑色';
    if (s < 0.12) return '灰色';
    if (h < 15 || h >= 345) return '紅色';
    if (h < 40) return '橙色';
    if (h < 65) return '黃色';
    if (h < 170) return '綠色';
    if (h < 200) return '青色';
    if (h < 255) return '藍色';
    if (h < 290) return '紫色';
    if (h < 330) return '粉色';
    return '棕色';
  }

  rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h, s, l = (max + min) / 2;
    if (max === min) {
      h = s = 0; // 無色
    } else {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max - min);
      switch (max) {
        case r: h = (g - b) / d + (g < b ? 6 : 0); break;
        case g: h = (b - r) / d + 2; break;
        case b: h = (r - g) / d + 4; break;
      }
      h /= 6;
    }
    return { h: Math.round(h * 360), s, l };
  }

  // AI驅動的穿搭推薦
  async generateOutfitRecommendations(userClothes, preferences = {}) {
    try {
      // 使用AI大模型生成更智能的穿搭建議
      if (this.openaiApiKey || this.anthropicApiKey || this.geminiApiKey) {
        return await this.generateAIOutfitRecommendations(userClothes, preferences);
      }
      
      // 降級到基本算法
      return await this.generateBasicOutfitRecommendations(userClothes, preferences);
    } catch (error) {
      console.error('穿搭推薦錯誤:', error);
      return await this.generateBasicOutfitRecommendations(userClothes, preferences);
    }
  }

  // AI驅動的穿搭推薦
  async generateAIOutfitRecommendations(userClothes, preferences) {
    const clothesData = userClothes.map(item => ({
      id: item._id,
      category: item.category,
      subCategory: item.subCategory,
      colors: item.colors,
      style: item.style,
      season: item.season,
      wearCount: item.wearCount,
      lastWorn: item.lastWorn
    }));

    const prompt = `作為專業的時尚造型師，請為一位成年男性推薦穿搭組合。

用戶衣物清單：
${JSON.stringify(clothesData, null, 2)}

用戶偏好：
${JSON.stringify(preferences, null, 2)}

請提供5-8個穿搭建議，每個建議包含：
1. 選擇的衣物ID組合
2. 搭配理由
3. 適合場合
4. 風格描述
5. 顏色和諧度評分(1-10)

請以JSON格式回傳：
{
  "recommendations": [
    {
      "items": ["衣物ID陣列"],
      "reason": "搭配理由",
      "occasion": "適合場合",
      "style": "風格描述",
      "colorHarmony": 8,
      "seasonSuitability": ["適合季節"],
      "tips": "穿搭小貼士"
    }
  ]
}
    `;

    let response;
    
    // 優先使用Gemini
    if (this.geminiApiKey) {
      try {
        response = await axios.post(this.geminiUrl.replace('gemini-pro-vision', 'gemini-pro'), {
          contents: [{
            parts: [{ text: prompt }]
          }]
        }, {
          headers: {
            'Content-Type': 'application/json'
          }
        });
        
        const content = response.data.candidates[0].content.parts[0].text;
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        
        if (jsonMatch) {
          const result = JSON.parse(jsonMatch[0]);
          return result.recommendations || [];
        }
      } catch (error) {
        console.warn('Gemini穿搭推薦失敗，嘗試其他服務:', error.message);
      }
    }
    
    // 降級到OpenAI
    if (this.openaiApiKey) {
      try {
        response = await axios.post(this.openaiUrl, {
          model: "gpt-4",
          messages: [{ role: "user", content: prompt }],
          max_tokens: 2000,
          temperature: 0.7
        }, {
          headers: {
            'Authorization': `Bearer ${this.openaiApiKey}`,
            'Content-Type': 'application/json'
          }
        });
        
        const content = response.data.choices[0].message.content;
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        
        if (jsonMatch) {
          const result = JSON.parse(jsonMatch[0]);
          return result.recommendations || [];
        }
      } catch (error) {
        console.warn('OpenAI穿搭推薦失敗:', error.message);
      }
    }
    
    // 最終降級到基本算法
    return await this.generateBasicOutfitRecommendations(userClothes, preferences);
  }

  // 基本穿搭推薦算法 (保留作為備用)
  async generateBasicOutfitRecommendations(userClothes, preferences = {}) {
    const outfits = [];
    
    // 基本搭配規則
    const matchingRules = {
      '上衣': ['下裝', '鞋子'],
      '外套': ['上衣', '下裝', '鞋子'],
      '連身裙': ['鞋子', '配件']
    };

    // 顏色搭配規則
    const colorMatching = {
      '黑色': ['白色', '灰色', '紅色', '藍色'],
      '白色': ['黑色', '藍色', '紅色', '綠色'],
      '藍色': ['白色', '黑色', '灰色'],
      '紅色': ['黑色', '白色', '灰色']
    };

    // 生成搭配建議
    const tops = userClothes.filter(item => item.category === '上衣');
    const bottoms = userClothes.filter(item => item.category === '下裝');
    const shoes = userClothes.filter(item => item.category === '鞋子');

    for (const top of tops.slice(0, 5)) { // 限制數量避免過多組合
      for (const bottom of bottoms.slice(0, 3)) {
        for (const shoe of shoes.slice(0, 2)) {
          const outfit = {
            items: [top._id, bottom._id, shoe._id],
            style: this.determineOutfitStyle([top, bottom, shoe]),
            season: this.getCommonSeasons([top, bottom, shoe]),
            colorHarmony: this.calculateColorHarmony([top, bottom, shoe]),
            occasion: this.suggestOccasion([top, bottom, shoe])
          };
          
          if (outfit.colorHarmony > 0.6) {
            outfits.push(outfit);
          }
        }
      }
    }

    return outfits.slice(0, 10); // 返回前10個推薦
  }

  // 計算顏色和諧度
  calculateColorHarmony(items) {
    // 簡化的顏色和諧度計算
    const colors = items.flatMap(item => item.colors);
    const uniqueColors = [...new Set(colors)];
    
    // 如果顏色種類太多，和諧度降低
    if (uniqueColors.length > 4) return 0.3;
    if (uniqueColors.length <= 2) return 0.9;
    
    return 0.7;
  }

  // 確定搭配風格
  determineOutfitStyle(items) {
    const styles = items.map(item => item.style);
    const styleCount = {};
    
    styles.forEach(style => {
      styleCount[style] = (styleCount[style] || 0) + 1;
    });
    
    return Object.keys(styleCount).reduce((a, b) => 
      styleCount[a] > styleCount[b] ? a : b
    );
  }

  // 獲取共同季節
  getCommonSeasons(items) {
    const allSeasons = items.flatMap(item => item.season);
    const seasonCount = {};
    
    allSeasons.forEach(season => {
      seasonCount[season] = (seasonCount[season] || 0) + 1;
    });
    
    return Object.keys(seasonCount).filter(season => 
      seasonCount[season] >= 2
    );
  }

  // 建議場合
  suggestOccasion(items) {
    const styles = items.map(item => item.style);
    
    if (styles.includes('正式')) return '工作/正式場合';
    if (styles.includes('運動')) return '運動/健身';
    if (styles.includes('時尚')) return '約會/聚會';
    
    return '日常休閒';
  }
}

module.exports = new AIService();
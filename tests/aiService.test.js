const aiService = require('../services/aiService');

describe('AI Service Tests', () => {
  describe('analyzeClothing', () => {
    test('should analyze clothing with valid image', async () => {
      // Mock image data
      const mockImageBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
      
      // Mock the AI service response
      jest.spyOn(aiService, 'analyzeWithGemini').mockResolvedValue({
        category: '上衣',
        subCategory: 'T恤',
        colors: ['藍色'],
        style: '休閒',
        season: ['夏'],
        confidence: 0.85,
        features: ['短袖', '圓領'],
        tags: ['休閒', '夏季'],
        aiService: 'gemini'
      });

      const result = await aiService.analyzeClothing(mockImageBase64);

      expect(result).toHaveProperty('category', '上衣');
      expect(result).toHaveProperty('subCategory', 'T恤');
      expect(result).toHaveProperty('colors');
      expect(result.colors).toContain('藍色');
      expect(result).toHaveProperty('confidence');
      expect(result.confidence).toBeGreaterThan(0.5);
      expect(result).toHaveProperty('aiService', 'gemini');
    });

    test('should fallback when primary service fails', async () => {
      const mockImageBase64 = 'test-image-data';
      
      // Mock Gemini failure
      jest.spyOn(aiService, 'analyzeWithGemini').mockRejectedValue(new Error('Gemini API Error'));
      
      // Mock fallback success
      jest.spyOn(aiService, 'analyzeWithFallback').mockResolvedValue({
        category: '上衣',
        subCategory: '一般',
        colors: ['未知'],
        style: '休閒',
        season: ['春', '秋'],
        confidence: 0.6,
        features: ['衣物'],
        tags: ['需要重新分析'],
        aiService: 'fallback'
      });

      const result = await aiService.analyzeClothing(mockImageBase64);

      expect(result).toHaveProperty('category');
      expect(result).toHaveProperty('aiService');
      expect(aiService.analyzeWithFallback).toHaveBeenCalled();
    });

    test('should return fallback analysis on complete failure', async () => {
      const mockImageBase64 = 'invalid-data';
      
      // Mock all services failing
      jest.spyOn(aiService, 'analyzeWithGemini').mockRejectedValue(new Error('Service Error'));
      jest.spyOn(aiService, 'analyzeWithFallback').mockRejectedValue(new Error('All services failed'));

      const result = await aiService.analyzeClothing(mockImageBase64);

      expect(result).toHaveProperty('category', '上衣');
      expect(result).toHaveProperty('confidence', 0.3);
      expect(result.suggestedTags).toContain('需要重新分析');
    });
  });

  describe('generateOutfitRecommendations', () => {
    test('should generate outfit recommendations', async () => {
      const mockClothes = [
        {
          _id: '1',
          category: '上衣',
          subCategory: 'T恤',
          colors: ['藍色'],
          style: '休閒',
          season: ['夏'],
          wearCount: 5,
          lastWorn: new Date()
        },
        {
          _id: '2',
          category: '下裝',
          subCategory: '牛仔褲',
          colors: ['藍色'],
          style: '休閒',
          season: ['春', '秋'],
          wearCount: 3,
          lastWorn: new Date()
        },
        {
          _id: '3',
          category: '鞋子',
          subCategory: '運動鞋',
          colors: ['白色'],
          style: '運動',
          season: ['春', '夏', '秋'],
          wearCount: 8,
          lastWorn: new Date()
        }
      ];

      const mockPreferences = {
        occasion: 'daily',
        preferredStyles: ['休閒'],
        colorPreferences: ['藍色'],
        // 已移除 ADHD 偏好
      };

      const recommendations = await aiService.generateOutfitRecommendations(mockClothes, mockPreferences);

      expect(Array.isArray(recommendations)).toBe(true);
      expect(recommendations.length).toBeGreaterThan(0);
      
      if (recommendations.length > 0) {
        const firstRecommendation = recommendations[0];
        expect(firstRecommendation).toHaveProperty('items');
        expect(firstRecommendation).toHaveProperty('style');
        expect(firstRecommendation).toHaveProperty('colorHarmony');
        expect(Array.isArray(firstRecommendation.items)).toBe(true);
      }
    });

    test('should handle empty clothes array', async () => {
      const recommendations = await aiService.generateOutfitRecommendations([], {});
      
      expect(Array.isArray(recommendations)).toBe(true);
      expect(recommendations.length).toBe(0);
    });
  });

  describe('Color harmony calculation', () => {
    test('should calculate color harmony correctly', () => {
      const mockItems = [
        { colors: ['藍色', '白色'] },
        { colors: ['白色'] },
        { colors: ['藍色'] }
      ];

      const harmony = aiService.calculateColorHarmony(mockItems);
      
      expect(typeof harmony).toBe('number');
      expect(harmony).toBeGreaterThanOrEqual(0);
      expect(harmony).toBeLessThanOrEqual(1);
    });

    test('should penalize too many colors', () => {
      const mockItemsMany = [
        { colors: ['紅色', '綠色'] },
        { colors: ['藍色', '黃色'] },
        { colors: ['紫色', '橙色'] }
      ];

      const mockItemsFew = [
        { colors: ['藍色'] },
        { colors: ['白色'] },
        { colors: ['藍色'] }
      ];

      const harmonyMany = aiService.calculateColorHarmony(mockItemsMany);
      const harmonyFew = aiService.calculateColorHarmony(mockItemsFew);
      
      expect(harmonyFew).toBeGreaterThan(harmonyMany);
    });
  });

  describe('Style determination', () => {
    test('should determine outfit style correctly', () => {
      const mockItems = [
        { style: '休閒' },
        { style: '休閒' },
        { style: '運動' }
      ];

      const style = aiService.determineOutfitStyle(mockItems);
      expect(style).toBe('休閒');
    });
  });

  describe('Season compatibility', () => {
    test('should find common seasons', () => {
      const mockItems = [
        { season: ['春', '夏'] },
        { season: ['夏', '秋'] },
        { season: ['夏'] }
      ];

      const commonSeasons = aiService.getCommonSeasons(mockItems);
      expect(commonSeasons).toContain('夏');
    });
  });
});

// 測試輔助函數
afterEach(() => {
  jest.restoreAllMocks();
});
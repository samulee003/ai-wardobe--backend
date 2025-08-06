const UserBehavior = require('../models/UserBehavior');
const User = require('../models/User');
const Clothing = require('../models/Clothing');

class LearningService {
  constructor() {
    this.learningWeights = {
      like: 2.0,
      dislike: -1.5,
      wear: 1.5,
      save: 1.8,
      view: 0.3,
      reject: -1.0,
      accept: 1.2
    };
  }

  // 記錄用戶行為
  async recordBehavior(userId, behaviorData) {
    try {
      const behavior = new UserBehavior({
        userId,
        ...behaviorData,
        context: {
          ...behaviorData.context,
          timestamp: new Date()
        }
      });

      await behavior.save();
      
      // 異步更新用戶偏好
      this.updateUserPreferences(userId, behavior);
      
      return behavior;
    } catch (error) {
      console.error('記錄用戶行為失敗:', error);
      throw error;
    }
  }

  // 更新用戶偏好
  async updateUserPreferences(userId, behavior) {
    try {
      const user = await User.findById(userId);
      if (!user) return;

      // 初始化學習數據
      if (!user.learningData) {
        user.learningData = {
          stylePreferences: new Map(),
          colorPreferences: new Map(),
          occasionPreferences: new Map(),
          rejectedCombinations: []
        };
      }

      // 根據行為類型更新偏好
      await this.processStylePreferences(user, behavior);
      await this.processColorPreferences(user, behavior);
      await this.processOccasionPreferences(user, behavior);
      await this.processRejectedCombinations(user, behavior);

      // 保存更新的用戶數據
      await user.save();
      
    } catch (error) {
      console.error('更新用戶偏好失敗:', error);
    }
  }

  // 處理風格偏好
  async processStylePreferences(user, behavior) {
    const weight = this.learningWeights[behavior.action] || 0;
    
    if (behavior.targetType === 'clothing' && behavior.targetId) {
      const clothing = await Clothing.findById(behavior.targetId);
      if (clothing && clothing.style) {
        const currentScore = user.learningData.stylePreferences.get(clothing.style) || 0;
        user.learningData.stylePreferences.set(
          clothing.style, 
          Math.max(-5, Math.min(5, currentScore + weight))
        );
      }
    }

    if (behavior.targetType === 'outfit' && behavior.metadata?.outfitItems) {
      // 從穿搭組合中學習風格偏好
      const clothes = await Clothing.find({
        _id: { $in: behavior.metadata.outfitItems }
      });
      
      const styles = clothes.map(c => c.style).filter(Boolean);
      const dominantStyle = this.getMostFrequent(styles);
      
      if (dominantStyle) {
        const currentScore = user.learningData.stylePreferences.get(dominantStyle) || 0;
        user.learningData.stylePreferences.set(
          dominantStyle,
          Math.max(-5, Math.min(5, currentScore + weight))
        );
      }
    }
  }

  // 處理顏色偏好
  async processColorPreferences(user, behavior) {
    const weight = this.learningWeights[behavior.action] || 0;
    
    if (behavior.targetType === 'clothing' && behavior.targetId) {
      const clothing = await Clothing.findById(behavior.targetId);
      if (clothing && clothing.colors) {
        clothing.colors.forEach(color => {
          const currentScore = user.learningData.colorPreferences.get(color) || 0;
          user.learningData.colorPreferences.set(
            color,
            Math.max(-5, Math.min(5, currentScore + weight))
          );
        });
      }
    }

    if (behavior.targetType === 'outfit' && behavior.metadata?.outfitItems) {
      const clothes = await Clothing.find({
        _id: { $in: behavior.metadata.outfitItems }
      });
      
      const allColors = clothes.flatMap(c => c.colors || []);
      const uniqueColors = [...new Set(allColors)];
      
      uniqueColors.forEach(color => {
        const currentScore = user.learningData.colorPreferences.get(color) || 0;
        user.learningData.colorPreferences.set(
          color,
          Math.max(-5, Math.min(5, currentScore + weight * 0.5)) // 顏色權重稍低
        );
      });
    }
  }

  // 處理場合偏好
  async processOccasionPreferences(user, behavior) {
    if (behavior.metadata?.occasion) {
      const weight = this.learningWeights[behavior.action] || 0;
      const occasion = behavior.metadata.occasion;
      
      const currentScore = user.learningData.occasionPreferences.get(occasion) || 0;
      user.learningData.occasionPreferences.set(
        occasion,
        Math.max(-5, Math.min(5, currentScore + weight))
      );
    }
  }

  // 處理拒絕的組合
  async processRejectedCombinations(user, behavior) {
    if (behavior.action === 'dislike_outfit' || behavior.action === 'reject_recommendation') {
      if (behavior.metadata?.outfitItems) {
        const combination = behavior.metadata.outfitItems.sort().join(',');
        
        if (!user.learningData.rejectedCombinations.includes(combination)) {
          user.learningData.rejectedCombinations.push(combination);
          
          // 限制拒絕組合的數量
          if (user.learningData.rejectedCombinations.length > 100) {
            user.learningData.rejectedCombinations = 
              user.learningData.rejectedCombinations.slice(-100);
          }
        }
      }
    }
  }

  // 生成個性化推薦權重
  async generateRecommendationWeights(userId) {
    try {
      const user = await User.findById(userId);
      if (!user || !user.learningData) {
        return this.getDefaultWeights();
      }

      const weights = {
        styleWeights: Object.fromEntries(user.learningData.stylePreferences || new Map()),
        colorWeights: Object.fromEntries(user.learningData.colorPreferences || new Map()),
        occasionWeights: Object.fromEntries(user.learningData.occasionPreferences || new Map()),
        rejectedCombinations: user.learningData.rejectedCombinations || []
      };

      return weights;
    } catch (error) {
      console.error('生成推薦權重失敗:', error);
      return this.getDefaultWeights();
    }
  }

  // 分析用戶行為模式
  async analyzeUserPatterns(userId, days = 30) {
    try {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      const behaviors = await UserBehavior.find({
        userId,
        createdAt: { $gte: startDate }
      }).sort({ createdAt: -1 });

      const patterns = {
        mostActiveTime: this.analyzeMostActiveTime(behaviors),
        preferredActions: this.analyzePreferredActions(behaviors),
        sessionPatterns: this.analyzeSessionPatterns(behaviors),
        engagementLevel: this.calculateEngagementLevel(behaviors),
        decisionSpeed: this.analyzeDecisionSpeed(behaviors)
      };

      return patterns;
    } catch (error) {
      console.error('分析用戶模式失敗:', error);
      return null;
    }
  }

  // 生成個性化風格報告
  async generateStyleReport(userId) {
    try {
      const user = await User.findById(userId);
      const patterns = await this.analyzeUserPatterns(userId, 90); // 90天數據
      
      if (!user || !user.learningData) {
        return this.getDefaultStyleReport();
      }

      const stylePrefs = Object.fromEntries(user.learningData.stylePreferences || new Map());
      const colorPrefs = Object.fromEntries(user.learningData.colorPreferences || new Map());
      
      // 排序偏好
      const topStyles = Object.entries(stylePrefs)
        .sort(([,a], [,b]) => b - a)
        .slice(0, 3)
        .map(([style, score]) => ({ style, score }));
        
      const topColors = Object.entries(colorPrefs)
        .sort(([,a], [,b]) => b - a)
        .slice(0, 5)
        .map(([color, score]) => ({ color, score }));

      // 獲取穿著統計
      const wearStats = await this.getWearStatistics(userId);

      const report = {
        userId,
        generatedAt: new Date(),
        period: '過去90天',
        topStyles,
        topColors,
        wearStatistics: wearStats,
        behaviorPatterns: patterns,
        recommendations: this.generatePersonalizedRecommendations(topStyles, topColors),
        insights: this.generateInsights(user, topStyles, topColors, wearStats)
      };

      return report;
    } catch (error) {
      console.error('生成風格報告失敗:', error);
      return this.getDefaultStyleReport();
    }
  }

  // 輔助方法
  getMostFrequent(arr) {
    const frequency = {};
    arr.forEach(item => {
      frequency[item] = (frequency[item] || 0) + 1;
    });
    
    return Object.keys(frequency).reduce((a, b) => 
      frequency[a] > frequency[b] ? a : b, null
    );
  }

  analyzeMostActiveTime(behaviors) {
    const hourCounts = {};
    behaviors.forEach(b => {
      const hour = new Date(b.createdAt).getHours();
      hourCounts[hour] = (hourCounts[hour] || 0) + 1;
    });
    
    const mostActiveHour = Object.keys(hourCounts).reduce((a, b) => 
      hourCounts[a] > hourCounts[b] ? a : b, '12'
    );
    
    return parseInt(mostActiveHour);
  }

  analyzePreferredActions(behaviors) {
    const actionCounts = {};
    behaviors.forEach(b => {
      actionCounts[b.action] = (actionCounts[b.action] || 0) + 1;
    });
    
    return Object.entries(actionCounts)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 5)
      .map(([action, count]) => ({ action, count }));
  }

  analyzeSessionPatterns(behaviors) {
    // 簡化的會話分析
    const sessions = {};
    behaviors.forEach(b => {
      const sessionId = b.context?.sessionId || 'unknown';
      if (!sessions[sessionId]) {
        sessions[sessionId] = [];
      }
      sessions[sessionId].push(b);
    });
    
    const sessionLengths = Object.values(sessions).map(s => s.length);
    const avgSessionLength = sessionLengths.reduce((a, b) => a + b, 0) / sessionLengths.length || 0;
    
    return {
      totalSessions: Object.keys(sessions).length,
      averageSessionLength: Math.round(avgSessionLength)
    };
  }

  calculateEngagementLevel(behaviors) {
    const engagementActions = ['like_outfit', 'save_outfit', 'wear_clothing', 'upload_clothing'];
    const engagementCount = behaviors.filter(b => engagementActions.includes(b.action)).length;
    
    return behaviors.length > 0 ? (engagementCount / behaviors.length) : 0;
  }

  analyzeDecisionSpeed(behaviors) {
    // 簡化的決策速度分析
    const decisionActions = ['like_outfit', 'dislike_outfit', 'save_outfit'];
    const decisionBehaviors = behaviors.filter(b => decisionActions.includes(b.action));
    
    if (decisionBehaviors.length === 0) return 'normal';
    
    const avgTimeSpent = decisionBehaviors
      .filter(b => b.metadata?.timeSpent)
      .reduce((sum, b) => sum + b.metadata.timeSpent, 0) / decisionBehaviors.length;
    
    if (avgTimeSpent < 5) return 'fast';
    if (avgTimeSpent > 15) return 'slow';
    return 'normal';
  }

  async getWearStatistics(userId) {
    const clothes = await Clothing.find({ userId });
    
    const totalClothes = clothes.length;
    const totalWears = clothes.reduce((sum, c) => sum + (c.wearCount || 0), 0);
    const avgWearCount = totalClothes > 0 ? totalWears / totalClothes : 0;
    
    const mostWorn = clothes.reduce((max, c) => 
      (c.wearCount || 0) > (max.wearCount || 0) ? c : max, clothes[0]
    );
    
    return {
      totalClothes,
      totalWears,
      averageWearCount: Math.round(avgWearCount * 10) / 10,
      mostWornItem: mostWorn ? {
        id: mostWorn._id,
        category: mostWorn.category,
        subCategory: mostWorn.subCategory,
        wearCount: mostWorn.wearCount || 0
      } : null
    };
  }

  generatePersonalizedRecommendations(topStyles, topColors) {
    const recommendations = [];
    
    if (topStyles.length > 0) {
      recommendations.push(`你最喜歡的風格是「${topStyles[0].style}」，建議多嘗試這種風格的搭配`);
    }
    
    if (topColors.length > 0) {
      recommendations.push(`你偏愛「${topColors[0].color}」，可以嘗試與其他顏色的搭配`);
    }
    
    return recommendations;
  }

  generateInsights(user, topStyles, topColors, wearStats) {
    const insights = [];
    
    if (wearStats.averageWearCount < 2) {
      insights.push('你的衣物利用率較低，建議嘗試更多穿搭組合');
    }
    
    if (topStyles.length > 0 && topStyles[0].score > 3) {
      insights.push(`你對「${topStyles[0].style}」風格有強烈偏好`);
    }
    
    if (topColors.length > 2) {
      insights.push('你的顏色偏好比較多樣化，這很棒！');
    }
    
    return insights;
  }

  getDefaultWeights() {
    return {
      styleWeights: {},
      colorWeights: {},
      occasionWeights: {},
      rejectedCombinations: []
    };
  }

  getDefaultStyleReport() {
    return {
      userId: null,
      generatedAt: new Date(),
      period: '暫無數據',
      topStyles: [],
      topColors: [],
      wearStatistics: {
        totalClothes: 0,
        totalWears: 0,
        averageWearCount: 0,
        mostWornItem: null
      },
      behaviorPatterns: null,
      recommendations: ['開始使用應用來獲得個性化建議'],
      insights: ['需要更多數據來生成個性化洞察']
    };
  }
}

module.exports = new LearningService();
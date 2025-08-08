const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();

// 健康檢查端點
router.get('/', async (req, res) => {
  try {
    const healthCheck = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      environment: process.env.NODE_ENV || 'development',
      version: process.env.npm_package_version || '1.0.0',
      services: {}
    };

    // 檢查數據庫連接
    try {
      const dbState = mongoose.connection.readyState;
      healthCheck.services.database = {
        status: dbState === 1 ? 'connected' : 'disconnected',
        readyState: dbState
      };
    } catch (error) {
      healthCheck.services.database = {
        status: 'error',
        error: error.message
      };
    }

    // 檢查內存使用
    const memUsage = process.memoryUsage();
    healthCheck.memory = {
      rss: Math.round(memUsage.rss / 1024 / 1024) + ' MB',
      heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024) + ' MB',
      heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024) + ' MB',
      external: Math.round(memUsage.external / 1024 / 1024) + ' MB'
    };

    // 檢查 AI 服務狀態（含最新指標）
    try {
      const aiService = require('../services/aiService');
      const metrics = aiService.getMetrics ? aiService.getMetrics() : null;
      healthCheck.services.ai = {
        status: 'available',
        preferredService: aiService.preferredAI,
        hasGeminiKey: !!process.env.GEMINI_API_KEY,
        hasOpenAIKey: !!process.env.OPENAI_API_KEY,
        totalAnalyses: metrics?.totalAnalyses || 0,
        lastAnalysis: metrics?.last || null
      };
    } catch (error) {
      healthCheck.services.ai = {
        status: 'error',
        error: error.message
      };
    }

    // 如果所有服務都正常，返回 200
    const allServicesHealthy = Object.values(healthCheck.services)
      .every(service => service.status === 'connected' || service.status === 'available');

    if (allServicesHealthy) {
      res.status(200).json(healthCheck);
    } else {
      healthCheck.status = 'degraded';
      res.status(503).json(healthCheck);
    }

  } catch (error) {
    res.status(500).json({
      status: 'error',
      timestamp: new Date().toISOString(),
      error: error.message
    });
  }
});

// 詳細健康檢查
router.get('/detailed', async (req, res) => {
  try {
    const detailedCheck = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      environment: process.env.NODE_ENV || 'development',
      version: process.env.npm_package_version || '1.0.0',
      system: {
        platform: process.platform,
        arch: process.arch,
        nodeVersion: process.version,
        pid: process.pid
      },
      services: {},
      metrics: {}
    };

    // 數據庫詳細檢查
    try {
      const dbState = mongoose.connection.readyState;
      const dbStats = await mongoose.connection.db.stats();
      
      detailedCheck.services.database = {
        status: dbState === 1 ? 'connected' : 'disconnected',
        readyState: dbState,
        host: mongoose.connection.host,
        port: mongoose.connection.port,
        name: mongoose.connection.name,
        collections: dbStats.collections,
        dataSize: Math.round(dbStats.dataSize / 1024 / 1024) + ' MB',
        storageSize: Math.round(dbStats.storageSize / 1024 / 1024) + ' MB'
      };
    } catch (error) {
      detailedCheck.services.database = {
        status: 'error',
        error: error.message
      };
    }

    // 內存和 CPU 指標
    const memUsage = process.memoryUsage();
    detailedCheck.metrics.memory = {
      rss: memUsage.rss,
      heapTotal: memUsage.heapTotal,
      heapUsed: memUsage.heapUsed,
      external: memUsage.external,
      heapUsedPercentage: Math.round((memUsage.heapUsed / memUsage.heapTotal) * 100)
    };

    // CPU 使用率
    const cpuUsage = process.cpuUsage();
    detailedCheck.metrics.cpu = {
      user: cpuUsage.user,
      system: cpuUsage.system
    };

    // 事件循環延遲
    const start = process.hrtime.bigint();
    setImmediate(() => {
      const delta = process.hrtime.bigint() - start;
      detailedCheck.metrics.eventLoopDelay = Number(delta / BigInt(1000000)) + ' ms';
    });

    res.json(detailedCheck);

  } catch (error) {
    res.status(500).json({
      status: 'error',
      timestamp: new Date().toISOString(),
      error: error.message
    });
  }
});

// 就緒檢查
router.get('/ready', async (req, res) => {
  try {
    // 檢查關鍵服務是否就緒
    const checks = [];

    // 數據庫就緒檢查
    checks.push(new Promise((resolve) => {
      const dbState = mongoose.connection.readyState;
      resolve({
        service: 'database',
        ready: dbState === 1,
        details: { readyState: dbState }
      });
    }));

    // AI 服務就緒檢查
    checks.push(new Promise((resolve) => {
      const hasApiKey = !!(process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY);
      resolve({
        service: 'ai',
        ready: hasApiKey,
        details: { hasApiKey }
      });
    }));

    const results = await Promise.all(checks);
    const allReady = results.every(result => result.ready);

    const response = {
      ready: allReady,
      timestamp: new Date().toISOString(),
      checks: results
    };

    res.status(allReady ? 200 : 503).json(response);

  } catch (error) {
    res.status(500).json({
      ready: false,
      timestamp: new Date().toISOString(),
      error: error.message
    });
  }
});

// 存活檢查
router.get('/live', (req, res) => {
  res.status(200).json({
    alive: true,
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

module.exports = router;
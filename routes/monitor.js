const express = require('express');
const router = express.Router();
const { logger } = require('../middleware/monitor');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');

// 獲取系統狀態
router.get('/status', async (req, res) => {
  try {
    const memoryUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();
    const uptime = process.uptime();
    const loadAvg = os.loadavg();
    
    res.json({
      memory: {
        rss: `${Math.round(memoryUsage.rss / 1024 / 1024)}MB`,
        heapTotal: `${Math.round(memoryUsage.heapTotal / 1024 / 1024)}MB`,
        heapUsed: `${Math.round(memoryUsage.heapUsed / 1024 / 1024)}MB`,
        external: `${Math.round(memoryUsage.external / 1024 / 1024)}MB`
      },
      cpu: {
        user: `${Math.round(cpuUsage.user / 1000)}ms`,
        system: `${Math.round(cpuUsage.system / 1000)}ms`,
        loadAvg: loadAvg.map(load => load.toFixed(2))
      },
      uptime: {
        seconds: Math.round(uptime),
        formatted: formatUptime(uptime)
      },
      system: {
        platform: os.platform(),
        release: os.release(),
        hostname: os.hostname(),
        totalMemory: `${Math.round(os.totalmem() / 1024 / 1024)}MB`,
        freeMemory: `${Math.round(os.freemem() / 1024 / 1024)}MB`,
        cpus: os.cpus().length
      }
    });
  } catch (error) {
    res.status(500).json({ error: '獲取系統狀態失敗' });
  }
});

// 獲取日誌內容
router.get('/logs', async (req, res) => {
  try {
    const { type = 'combined', lines = 100 } = req.query;
    const logFile = path.join('logs', `${type}.log`);
    
    const content = await fs.readFile(logFile, 'utf8');
    const logLines = content.split('\n')
      .filter(line => line.trim())
      .slice(-lines)
      .map(line => {
        try {
          return JSON.parse(line);
        } catch {
          return { message: line };
        }
      });
    
    res.json(logLines);
  } catch (error) {
    res.status(500).json({ error: '獲取日誌失敗' });
  }
});

// 獲取錯誤統計
router.get('/errors', async (req, res) => {
  try {
    const { days = 7 } = req.query;
    const logFile = path.join('logs', 'error.log');
    
    const content = await fs.readFile(logFile, 'utf8');
    const errorLines = content.split('\n')
      .filter(line => line.trim())
      .map(line => {
        try {
          return JSON.parse(line);
        } catch {
          return { message: line };
        }
      });
    
    // 按日期分組統計錯誤
    const errorStats = errorLines.reduce((stats, log) => {
      const date = new Date(log.timestamp).toISOString().split('T')[0];
      if (!stats[date]) {
        stats[date] = {
          count: 0,
          errors: {}
        };
      }
      stats[date].count++;
      
      const errorType = log.error || '未知錯誤';
      if (!stats[date].errors[errorType]) {
        stats[date].errors[errorType] = 0;
      }
      stats[date].errors[errorType]++;
      
      return stats;
    }, {});
    
    res.json(errorStats);
  } catch (error) {
    res.status(500).json({ error: '獲取錯誤統計失敗' });
  }
});

// 獲取 API 效能統計
router.get('/performance', async (req, res) => {
  try {
    const { days = 7 } = req.query;
    const logFile = path.join('logs', 'combined.log');
    
    const content = await fs.readFile(logFile, 'utf8');
    const perfLines = content.split('\n')
      .filter(line => line.trim())
      .filter(line => line.includes('效能監控'))
      .map(line => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(log => log !== null);
    
    // 按 API 路徑分組統計效能
    const perfStats = perfLines.reduce((stats, log) => {
      const path = log.path;
      if (!stats[path]) {
        stats[path] = {
          count: 0,
          totalDuration: 0,
          maxDuration: 0,
          minDuration: Infinity,
          avgDuration: 0
        };
      }
      
      const duration = parseInt(log.duration);
      stats[path].count++;
      stats[path].totalDuration += duration;
      stats[path].maxDuration = Math.max(stats[path].maxDuration, duration);
      stats[path].minDuration = Math.min(stats[path].minDuration, duration);
      stats[path].avgDuration = Math.round(stats[path].totalDuration / stats[path].count);
      
      return stats;
    }, {});
    
    res.json(perfStats);
  } catch (error) {
    res.status(500).json({ error: '獲取效能統計失敗' });
  }
});

// /api/monitor/stats
router.get('/stats', async (req, res) => {
  try {
    const memoryUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();

    // 讀取最近的日誌
    let logs = [];
    try {
      const logFile = path.join('logs', 'combined.log');
      const content = await fs.readFile(logFile, 'utf8');
      logs = content.split('\n')
        .filter(line => line.trim())
        .slice(-50)
        .map(line => {
          try {
            return JSON.parse(line);
          } catch {
            return { message: line, level: 'info' };
          }
        });
    } catch (e) {
      // 忽略日誌讀取錯誤
    }

    res.json({
      memoryUsage: memoryUsage.heapUsed,
      cpuUsage: Math.round(cpuUsage.user / 10000),
      activeConnections: 0,
      logs
    });
  } catch (error) {
    res.status(500).json({ error: '獲取 stats 失敗' });
  }
});

// 格式化運行時間
function formatUptime(seconds) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  
  return `${days}天 ${hours}小時 ${minutes}分鐘 ${secs}秒`;
}

module.exports = router; 
const winston = require('winston');
const { createLogger, format, transports } = winston;
const path = require('path');
const nodemailer = require('nodemailer');
const axios = require('axios');
require('winston-daily-rotate-file');

// 配置常量
const CONFIG = {
  SMTP: {
    host: process.env.SMTP_HOST || 'smtp.example.com',
    port: parseInt(process.env.SMTP_PORT) || 465,
    secure: true,
    auth: {
      user: process.env.SMTP_USER || 'your-email@example.com',
      pass: process.env.SMTP_PASS || 'your-password'
    }
  },
  ALERT_EMAIL: process.env.ALERT_EMAIL || 'admin@example.com',
  DINGTALK_WEBHOOK: process.env.DINGTALK_WEBHOOK,
  THRESHOLDS: {
    MEMORY: parseInt(process.env.MEMORY_WARNING_THRESHOLD) || 500,
    DB_CONNECTIONS: parseInt(process.env.DB_CONNECTION_WARNING_THRESHOLD) || 10,
    API_RESPONSE: parseInt(process.env.API_RESPONSE_WARNING_THRESHOLD) || 1000,
    API_P95: parseInt(process.env.API_P95_WARNING_THRESHOLD) || 500,
    OVERDUE_LOANS: parseInt(process.env.OVERDUE_LOANS_WARNING_THRESHOLD) || 100
  }
};

// 配置日誌記錄器
const logger = createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: format.combine(
    format.timestamp({
      format: 'YYYY-MM-DD HH:mm:ss'
    }),
    format.errors({ stack: true }),
    format.splat(),
    format.json()
  ),
  defaultMeta: { service: 'loan-system' },
  transports: [
    // 錯誤日誌
    new transports.DailyRotateFile({
      filename: path.join('logs', 'error-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      level: 'error',
      maxSize: process.env.LOG_MAX_SIZE || '20m',
      maxFiles: process.env.LOG_MAX_FILES || '14d',
      zippedArchive: true,
      format: format.combine(
        format.timestamp(),
        format.json()
      )
    }),
    // 所有日誌
    new transports.DailyRotateFile({
      filename: path.join('logs', 'combined-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      maxSize: process.env.LOG_MAX_SIZE || '20m',
      maxFiles: process.env.LOG_MAX_FILES || '14d',
      zippedArchive: true,
      format: format.combine(
        format.timestamp(),
        format.json()
      )
    }),
    // 性能日誌
    new transports.DailyRotateFile({
      filename: path.join('logs', 'performance-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      maxSize: process.env.LOG_MAX_SIZE || '20m',
      maxFiles: process.env.LOG_MAX_FILES || '14d',
      zippedArchive: true,
      format: format.combine(
        format.timestamp(),
        format.json()
      )
    }),
    // 開發環境控制台輸出
    new transports.Console({
      format: format.combine(
        format.colorize(),
        format.simple()
      )
    })
  ]
});

// 配置郵件發送器
let mailTransporter;
try {
  mailTransporter = nodemailer.createTransport(CONFIG.SMTP);
} catch (error) {
  logger.warn('郵件發送器初始化失敗', { error: error.message });
}

// 告警通知函數
const sendAlert = async (level, message, details) => {
  // 郵件通知
  if (mailTransporter && CONFIG.ALERT_EMAIL) {
    try {
      await mailTransporter.sendMail({
        from: CONFIG.SMTP.auth.user,
        to: CONFIG.ALERT_EMAIL,
        subject: `[${level}] 系統告警通知`,
        html: `
          <h2>系統告警通知</h2>
          <p><strong>級別：</strong>${level}</p>
          <p><strong>訊息：</strong>${message}</p>
          <p><strong>詳情：</strong></p>
          <pre>${JSON.stringify(details, null, 2)}</pre>
        `
      });
    } catch (error) {
      logger.error('發送郵件告警失敗', { error: error.message });
    }
  }
  
  // 釘釘通知
  if (CONFIG.DINGTALK_WEBHOOK) {
    try {
      await axios.post(CONFIG.DINGTALK_WEBHOOK, {
        msgtype: 'markdown',
        markdown: {
          title: `[${level}] 系統告警通知`,
          text: `
            ### 系統告警通知
            **級別：**${level}
            **訊息：**${message}
            **詳情：**
            \`\`\`json
            ${JSON.stringify(details, null, 2)}
            \`\`\`
          `
        }
      });
    } catch (error) {
      logger.error('發送釘釘告警失敗', { error: error.message });
    }
  }
};

// 錯誤處理中間件
const errorHandler = (err, req, res, next) => {
  logger.error('系統錯誤', {
    error: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
    body: req.body,
    query: req.query,
    params: req.params,
    ip: req.ip
  });

  // 發送錯誤告警
  sendAlert('ERROR', '系統發生錯誤', {
    error: err.message,
    path: req.path,
    method: req.method
  });

  res.status(500).json({
    error: '系統錯誤，請稍後再試',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
};

// 請求日誌中間件
const requestLogger = (req, res, next) => {
  const start = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    
    logger.info('API 請求', {
      method: req.method,
      path: req.path,
      status: res.statusCode,
      duration: `${duration}ms`,
      ip: req.ip,
      userAgent: req.get('user-agent')
    });
  });
  
  next();
};

// 性能監控中間件
const performanceMonitor = (req, res, next) => {
  const start = Date.now();
  const startMemory = process.memoryUsage();
  const startCpu = process.cpuUsage();
  
  // 初始化性能指標
  if (!global.performanceMetrics) {
    global.performanceMetrics = {
      responseTimes: {},
      resourceUsage: {
        memory: [],
        cpu: []
      },
      lastUpdate: Date.now()
    };
  }
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    const endMemory = process.memoryUsage();
    const endCpu = process.cpuUsage();
    
    // 計算資源使用差異
    const memoryDiff = {
      rss: endMemory.rss - startMemory.rss,
      heapTotal: endMemory.heapTotal - startMemory.heapTotal,
      heapUsed: endMemory.heapUsed - startMemory.heapUsed
    };
    
    const cpuDiff = {
      user: endCpu.user - startCpu.user,
      system: endCpu.system - startCpu.system
    };
    
    // 更新響應時間統計
    const path = req.path;
    if (!global.performanceMetrics.responseTimes[path]) {
      global.performanceMetrics.responseTimes[path] = {
        count: 0,
        total: 0,
        min: Infinity,
        max: 0,
        p95: 0,
        p99: 0,
        times: []
      };
    }
    
    const metrics = global.performanceMetrics.responseTimes[path];
    metrics.count++;
    metrics.total += duration;
    metrics.min = Math.min(metrics.min, duration);
    metrics.max = Math.max(metrics.max, duration);
    metrics.times.push(duration);
    
    // 計算百分位數
    if (metrics.times.length > 100) {
      metrics.times.sort((a, b) => a - b);
      metrics.p95 = metrics.times[Math.floor(metrics.times.length * 0.95)];
      metrics.p99 = metrics.times[Math.floor(metrics.times.length * 0.99)];
      metrics.times = metrics.times.slice(-100); // 只保留最近100個數據
    }
    
    // 更新資源使用趨勢
    const now = Date.now();
    if (now - global.performanceMetrics.lastUpdate >= 60000) { // 每分鐘更新一次
      global.performanceMetrics.resourceUsage.memory.push({
        timestamp: now,
        rss: endMemory.rss,
        heapUsed: endMemory.heapUsed
      });
      
      global.performanceMetrics.resourceUsage.cpu.push({
        timestamp: now,
        user: endCpu.user,
        system: endCpu.system
      });
      
      // 只保留最近24小時的數據
      const oneDayAgo = now - 24 * 60 * 60 * 1000;
      global.performanceMetrics.resourceUsage.memory = global.performanceMetrics.resourceUsage.memory
        .filter(m => m.timestamp > oneDayAgo);
      global.performanceMetrics.resourceUsage.cpu = global.performanceMetrics.resourceUsage.cpu
        .filter(c => c.timestamp > oneDayAgo);
      
      global.performanceMetrics.lastUpdate = now;
    }
    
    logger.info('效能監控', {
      method: req.method,
      path: req.path,
      duration: `${duration}ms`,
      memory: memoryDiff,
      cpu: cpuDiff,
      metrics: {
        count: metrics.count,
        avg: Math.round(metrics.total / metrics.count),
        min: metrics.min,
        max: metrics.max,
        p95: metrics.p95,
        p99: metrics.p99
      }
    });
    
    // 性能警告
    if (duration > CONFIG.THRESHOLDS.API_RESPONSE) {
      const details = {
        method: req.method,
        path: req.path,
        duration: `${duration}ms`,
        threshold: `${CONFIG.THRESHOLDS.API_RESPONSE}ms`
      };
      logger.warn('API 響應時間過長', details);
      sendAlert('WARNING', 'API 響應時間過長', details);
    }
    
    if (metrics.p95 > CONFIG.THRESHOLDS.API_P95) {
      const details = {
        path: req.path,
        p95: `${metrics.p95}ms`,
        threshold: `${CONFIG.THRESHOLDS.API_P95}ms`
      };
      logger.warn('API P95 響應時間過高', details);
      sendAlert('WARNING', 'API P95 響應時間過高', details);
    }
  });
  
  next();
};

// 資料驗證中間件
const validate = (schema) => {
  return (req, res, next) => {
    const { error } = schema.validate(req.body);
    if (error) {
      logger.warn('資料驗證失敗', {
        path: req.path,
        method: req.method,
        error: error.details[0].message,
        body: req.body
      });
      
      return res.status(400).json({
        error: '資料驗證失敗',
        message: error.details[0].message
      });
    }
    next();
  };
};

// 系統狀態監控
const systemMonitor = () => {
  setInterval(() => {
    const memoryUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();
    
    // 新增數據庫連接狀態監控
    const dbStatus = {
      connections: global.dbPool ? global.dbPool.totalCount : 0,
      idle: global.dbPool ? global.dbPool.idleCount : 0,
      waiting: global.dbPool ? global.dbPool.waitingCount : 0
    };
    
    // 新增業務指標監控
    const businessMetrics = {
      activeCustomers: global.activeCustomers || 0,
      pendingPayments: global.pendingPayments || 0,
      overdueLoans: global.overdueLoans || 0
    };
    
    logger.info('系統狀態', {
      memory: {
        rss: `${Math.round(memoryUsage.rss / 1024 / 1024)}MB`,
        heapTotal: `${Math.round(memoryUsage.heapTotal / 1024 / 1024)}MB`,
        heapUsed: `${Math.round(memoryUsage.heapUsed / 1024 / 1024)}MB`
      },
      cpu: {
        user: `${Math.round(cpuUsage.user / 1000)}ms`,
        system: `${Math.round(cpuUsage.system / 1000)}ms`
      },
      uptime: `${Math.round(process.uptime())}s`,
      database: dbStatus,
      business: businessMetrics
    });
    
    // 記憶體使用警告
    if (memoryUsage.heapUsed > CONFIG.THRESHOLDS.MEMORY * 1024 * 1024) {
      const details = {
        heapUsed: `${Math.round(memoryUsage.heapUsed / 1024 / 1024)}MB`
      };
      logger.warn('記憶體使用過高', details);
      sendAlert('WARNING', '記憶體使用過高', details);
    }
    
    // 數據庫連接警告
    if (dbStatus.waiting > CONFIG.THRESHOLDS.DB_CONNECTIONS) {
      const details = {
        waiting: dbStatus.waiting,
        total: dbStatus.connections
      };
      logger.warn('數據庫連接等待過多', details);
      sendAlert('WARNING', '數據庫連接等待過多', details);
    }
    
    // 業務指標警告
    if (businessMetrics.overdueLoans > CONFIG.THRESHOLDS.OVERDUE_LOANS) {
      const details = {
        count: businessMetrics.overdueLoans
      };
      logger.warn('逾期貸款數量過多', details);
      sendAlert('WARNING', '逾期貸款數量過多', details);
    }
  }, 60000); // 每分鐘檢查一次
};

// 啟動系統監控
systemMonitor();

// 日誌清理函數
const cleanupLogs = async () => {
  const fs = require('fs').promises;
  const path = require('path');
  
  try {
    const logsDir = path.join(__dirname, '..', 'logs');
    
    // 檢查logs目錄是否存在
    try {
      await fs.access(logsDir);
    } catch (error) {
      logger.warn('logs目錄不存在，跳過清理', { logsDir });
      return;
    }
    
    const files = await fs.readdir(logsDir);
    
    // 只處理日誌文件
    const logFilePatterns = [
      /^error-.*\.log$/,
      /^combined-.*\.log$/,
      /^performance-.*\.log$/,
      /^operation\.log$/
    ];
    
    const now = Date.now();
    const maxAge = 30 * 24 * 60 * 60 * 1000; // 30天
    
    for (const file of files) {
      // 檢查是否為日誌文件
      const isLogFile = logFilePatterns.some(pattern => pattern.test(file));
      if (!isLogFile) {
        logger.debug('跳過非日誌文件', { file });
        continue;
      }
      
      const filePath = path.join(logsDir, file);
      
      try {
        const stats = await fs.stat(filePath);
        
        // 刪除超過30天的日誌文件
        if (now - stats.mtime.getTime() > maxAge) {
          await fs.unlink(filePath);
          logger.info('刪除過期日誌文件', { file, age: Math.round((now - stats.mtime.getTime()) / (24 * 60 * 60 * 1000)) + '天' });
        } else {
          logger.debug('日誌文件未過期，保留', { file, age: Math.round((now - stats.mtime.getTime()) / (24 * 60 * 60 * 1000)) + '天' });
        }
      } catch (error) {
        logger.error('處理日誌文件時發生錯誤', { file, error: error.message });
      }
    }
  } catch (error) {
    logger.error('日誌清理失敗', { error: error.message });
  }
};

// 定期執行日誌清理 - 已完全禁用
// 為了保護數據安全，已完全禁用自動清理功能
logger.info('日誌清理功能已完全禁用，不會自動刪除任何文件');
// 如果需要清理，請手動執行或通過管理界面操作

module.exports = {
  errorHandler,
  requestLogger,
  performanceMonitor,
  validate,
  logger
}; 
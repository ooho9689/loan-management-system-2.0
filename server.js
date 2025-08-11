const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const multer = require('multer');
const path = require('path');
const winston = require('winston');
const { createLogger, format, transports } = winston;
const fs = require('fs');

// 配置日志记录器
const logger = createLogger({
  format: format.combine(
    format.timestamp(),
    format.colorize(),
    format.printf(({ timestamp, level, message, ...meta }) => {
      return `${timestamp} [${level}]: ${message} ${Object.keys(meta).length ? JSON.stringify(meta, null, 2) : ''}`;
    })
  ),
  transports: [
    new transports.File({ 
      filename: 'logs/error.log', 
      level: 'error',
      format: format.combine(
        format.timestamp(),
        format.json()
      )
    }),
    new transports.File({ 
      filename: 'logs/combined.log',
      format: format.combine(
        format.timestamp(),
        format.json()
      )
    })
  ]
});

// 在開發環境下添加控制台輸出
if (process.env.NODE_ENV !== 'production') {
  logger.add(new transports.Console({
    format: format.combine(
      format.colorize(),
      format.simple()
    )
  }));
}

// 添加請求日誌中間件
const requestLogger = (req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.info('API請求', {
      method: req.method,
      url: req.url,
      status: res.statusCode,
      duration: `${duration}ms`,
      ip: req.ip
    });
  });
  next();
};

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(__dirname));
app.use(requestLogger);

// 註冊路由
const salesRouter = require('./routes/sales');
const customersRouter = require('./routes/customers');
const dashboardRouter = require('./routes/dashboard');
const paymentsRouter = require('./routes/payments');
const insightsRouter = require('./routes/insights');
const exportRouter = require('./routes/export');
const fixRouter = require('./routes/fix');
const monitorRouter = require('./routes/monitor');
const logsRouter = require('./routes/logs');

app.use('/api', salesRouter);
app.use('/api', customersRouter);
app.use('/api', dashboardRouter);
app.use('/api', paymentsRouter);
app.use('/api', insightsRouter);
app.use('/api', exportRouter);
app.use('/api', fixRouter);
app.use('/api', monitorRouter);
app.use('/api', logsRouter);

// 配置文件上传
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/')
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9)
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname))
  }
});

const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024 // 限制5MB
  }
});

// 错误处理中间件
app.use((err, req, res, next) => {
  logger.error('服务器错误:', err);
  res.status(500).json({ 
    error: '服务器内部错误',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// 上傳附件
app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      logger.warn('文件上传失败: 未上传文件');
      return res.status(400).json({ error: '未上傳檔案' });
    }

    const { customerId, type } = req.body;
    if (!customerId || !type) {
      logger.warn('文件上传失败: 缺少必要参数', { customerId, type });
      return res.status(400).json({ error: '缺少必要參數' });
    }

    const originalFilename = req.file.originalname;
    const filePath = req.file.path;

    const updateField = {
      'id_front': 'id_front_filename',
      'id_back': 'id_back_filename',
      'water_bill': 'water_bill_filename',
      'contract': 'contract_filename'
    }[type];

    if (!updateField) {
      logger.warn('文件上传失败: 无效的文件类型', { type });
      return res.status(400).json({ error: '無效的檔案類型' });
    }

    await db.run(`UPDATE customers SET ${type} = ?, ${updateField} = ? WHERE id = ?`, 
      [filePath, originalFilename, customerId]);

    logger.info('文件上传成功', { customerId, type, originalFilename });
    res.json({ 
      success: true, 
      filePath,
      originalFilename
    });
  } catch (error) {
    logger.error('文件上传错误:', error);
    res.status(500).json({ error: '上傳檔案失敗' });
  }
});

// 下載附件
app.get('/api/download/:customerId/:type', async (req, res) => {
  try {
    const { customerId, type } = req.params;
    const customer = await db.get('SELECT * FROM customers WHERE id = ?', [customerId]);
    
    if (!customer) {
      logger.warn('文件下载失败: 找不到客户', { customerId });
      return res.status(404).json({ error: '找不到客戶資料' });
    }

    const filePath = customer[type];
    const filenameField = {
      'id_front': 'id_front_filename',
      'id_back': 'id_back_filename',
      'water_bill': 'water_bill_filename',
      'contract': 'contract_filename'
    }[type];

    if (!filePath || !filenameField) {
      logger.warn('文件下载失败: 找不到文件', { customerId, type });
      return res.status(404).json({ error: '找不到檔案' });
    }

    const originalFilename = customer[filenameField] || 'download';
    logger.info('文件下载成功', { customerId, type, originalFilename });
    res.download(filePath, originalFilename);
  } catch (error) {
    logger.error('文件下载错误:', error);
    res.status(500).json({ error: '下載檔案失敗' });
  }
});

// 新增客戶
app.post('/api/customers', async (req, res) => {
  try {
    const { 
      name, 
      phone, 
      address, 
      id_number, 
      phone_model, 
      start_date, 
      end_date, 
      monthly_payment, 
      total_amount, 
      status 
    } = req.body;

    // 数据验证
    if (!name || !phone || !id_number || !phone_model || !start_date || !monthly_payment) {
      logger.warn('新增客户失败: 缺少必要参数', { 
        name, phone, id_number, phone_model, start_date, monthly_payment 
      });
      return res.status(400).json({ error: '缺少必要參數' });
    }

    // 验证手机号格式
    if (!/^09\d{8}$/.test(phone)) {
      logger.warn('新增客户失败: 手机号格式错误', { phone });
      return res.status(400).json({ error: '手機號碼格式錯誤' });
    }

    // 验证身份证号格式
    if (!/^[A-Z][12]\d{8}$/.test(id_number)) {
      logger.warn('新增客户失败: 身份证号格式错误', { id_number });
      return res.status(400).json({ error: '身分證字號格式錯誤' });
    }

    const result = await db.run(
      `INSERT INTO customers (
        name, phone, address, id_number, phone_model, 
        start_date, end_date, monthly_payment, total_amount, status,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      [name, phone, address, id_number, phone_model, start_date, end_date, 
       monthly_payment, total_amount, status || 'active']
    );
    
    logger.info('新增客户成功', { 
      customerId: result.lastID,
      name,
      phone,
      id_number
    });

    res.json({ 
      id: result.lastID,
      message: '客戶新增成功'
    });
  } catch (error) {
    logger.error('新增客户错误:', error);
    res.status(500).json({ error: '新增客戶失敗' });
  }
});

// 更新客戶
app.put('/api/customers/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { 
      name, phone, address, id_number, phone_model,
      start_date, end_date, monthly_payment, total_amount, status
    } = req.body;

    // 检查客户是否存在
    const customer = await db.get('SELECT * FROM customers WHERE id = ?', [id]);
    if (!customer) {
      logger.warn('更新客户失败: 找不到客户', { id });
      return res.status(404).json({ error: '找不到客戶資料' });
    }

    // 数据验证
    if (phone && !/^09\d{8}$/.test(phone)) {
      logger.warn('更新客户失败: 手机号格式错误', { id, phone });
      return res.status(400).json({ error: '手機號碼格式錯誤' });
    }

    if (id_number && !/^[A-Z][12]\d{8}$/.test(id_number)) {
      logger.warn('更新客户失败: 身份证号格式错误', { id, id_number });
      return res.status(400).json({ error: '身分證字號格式錯誤' });
    }

    await db.run(
      `UPDATE customers SET 
        name = COALESCE(?, name),
        phone = COALESCE(?, phone),
        address = COALESCE(?, address),
        id_number = COALESCE(?, id_number),
        phone_model = COALESCE(?, phone_model),
        start_date = COALESCE(?, start_date),
        end_date = COALESCE(?, end_date),
        monthly_payment = COALESCE(?, monthly_payment),
        total_amount = COALESCE(?, total_amount),
        status = COALESCE(?, status),
        updated_at = datetime('now')
      WHERE id = ?`,
      [name, phone, address, id_number, phone_model, start_date, end_date,
       monthly_payment, total_amount, status, id]
    );

    logger.info('更新客户成功', { id });
    res.json({ 
      success: true,
      message: '客戶資料更新成功'
    });
  } catch (error) {
    logger.error('更新客户错误:', error);
    res.status(500).json({ error: '更新客戶失敗' });
  }
});

// 連線數統計
let activeConnections = 0;

// 啟動服務器
const PORT = process.env.PORT || 3001;
const server = app.listen(PORT, () => {
  logger.info(`服務器已啟動，監聽端口 ${PORT}`);
});
server.on('connection', () => activeConnections++);
server.on('close', () => activeConnections--);

// 監控API
app.get('/api/monitor/stats', async (req, res) => {
  try {
    const stats = {
      memoryUsage: process.memoryUsage().heapUsed,
      cpuUsage: process.cpuUsage(),
      activeConnections,
      logs: []
    };

    // 讀取最近的日誌
    const logFiles = ['logs/combined.log', 'logs/error.log'];
    for (const file of logFiles) {
      try {
        const logContent = await fs.promises.readFile(file, 'utf8');
        const logLines = logContent.split('\n')
          .filter(line => line.trim())
          .slice(-50)
          .map(line => {
            try {
              return JSON.parse(line);
            } catch {
              return { message: line, level: 'info' };
            }
          });
        stats.logs.push(...logLines);
      } catch (error) {
        logger.error('讀取日誌文件失敗:', error);
      }
    }

    res.json(stats);
  } catch (error) {
    logger.error('獲取監控數據失敗:', error);
    res.status(500).json({ error: '獲取監控數據失敗' });
  }
});

// 優雅關閉
process.on('SIGTERM', () => {
  logger.info('收到 SIGTERM 信號，準備關閉服務器');
  server.close(() => {
    logger.info('服務器已關閉');
    process.exit(0);
  });
}); 
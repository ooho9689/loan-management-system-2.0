const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');
const multer = require('multer');

const app = express();

// 上傳目錄設定
const upload = multer({
  dest: path.join(__dirname, 'uploads'),
  limits: { fileSize: 10 * 1024 * 1024 }
});

// 中間件
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(__dirname));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// 根路由 - 提供主頁面
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// 掛載路由
app.use('/api/customers', require('./routes/customers'));
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api/insights', require('./routes/insights'));
app.use('/api/sales', require('./routes/sales'));
app.use('/api/logs', require('./routes/logs'));
app.use('/api/export', require('./routes/export'));
app.use('/api/fix', require('./routes/fix'));
app.use('/api/payments', require('./routes/payments'));
const monitorRouter = require('./routes/monitor');
app.use('/api/monitor', monitorRouter);

// 錯誤處理
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: '服務器錯誤' });
});

// 啟動服務器
const port = process.env.PORT || 3001;
app.listen(port, () => {
  console.log(`服務器運行在 http://localhost:${port}`);
});

module.exports = app; 
const express = require('express');
const router = express.Router();
const { readLogs } = require('../services/logService');

// 查詢操作日誌（支援多條件查詢）
router.get('/', async (req, res) => {
  try {
    let logs = await readLogs();
    // 多條件查詢
    const { start, end, action, type, user, customerId, customerName, keyword } = req.query;
    if (start) {
      const startDate = new Date(start);
      logs = logs.filter(l => new Date(l.timestamp) >= startDate);
    }
    if (end) {
      const endDate = new Date(end);
      logs = logs.filter(l => new Date(l.timestamp) <= endDate);
    }
    if (action) logs = logs.filter(l => l.action && l.action.includes(action));
    if (type) logs = logs.filter(l => l.detail && l.detail.type && l.detail.type.includes(type));
    if (user) logs = logs.filter(l => l.user && l.user.includes(user));
    if (customerId) logs = logs.filter(l => l.customerId && l.customerId.includes(customerId));
    if (customerName) logs = logs.filter(l => l.customerName && l.customerName.includes(customerName));
    if (keyword) {
      const kw = keyword.toLowerCase();
      logs = logs.filter(l =>
        (l.action && l.action.toLowerCase().includes(kw)) ||
        (l.user && l.user.toLowerCase().includes(kw)) ||
        (l.customerId && l.customerId.toLowerCase().includes(kw)) ||
        (l.customerName && l.customerName.toLowerCase().includes(kw)) ||
        (l.detail && JSON.stringify(l.detail).toLowerCase().includes(kw))
      );
    }
    res.json({ logs });
  } catch (e) {
    res.json({ logs: [] });
  }
});

module.exports = router; 
const express = require('express');
const router = express.Router();
const { readData, writeData } = require('../services/dataService');
const { logAction } = require('../services/logService');

// 新增繳款
router.post('/:id', async (req, res) => {
  try {
    const data = await readData();
    const customer = data.customers.find(c => c.id === req.params.id);
    if (!customer) return res.status(404).json({ error: '找不到客戶' });
    if (!customer.payments) customer.payments = [];
    const amount = Number(req.body.amount);
    const note = req.body.note || '';
    const paymentDate = req.body.date ? new Date(req.body.date) : new Date();
    const period = req.body.period ? Number(req.body.period) : undefined;
    if (!amount || amount <= 0) return res.status(400).json({ error: '金額錯誤' });
    const payment = { date: paymentDate.toISOString(), amount, note };
    if (period) payment.period = period;
    customer.payments.push(payment);
    await writeData(data);
    await logAction({
      action: '繳款',
      user: req.user?.name || 'admin',
      customerId: customer.id,
      customerName: customer.name,
      detail: { payment }
    });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: '新增繳款失敗' });
  }
});

// 查詢繳款紀錄
router.get('/:id', async (req, res) => {
  try {
    const data = await readData();
    const customer = data.customers.find(c => c.id === req.params.id);
    if (!customer) return res.status(404).json({ error: '找不到客戶' });
    res.json({ payments: customer.payments || [] });
  } catch (error) {
    res.status(500).json({ error: '查詢繳款紀錄失敗' });
  }
});

// 刪除繳款紀錄
router.delete('/:id/:index', async (req, res) => {
  try {
    const data = await readData();
    const customer = data.customers.find(c => c.id == req.params.id);
    if (!customer) return res.status(404).json({ success: false, error: '查無客戶' });
    const idx = parseInt(req.params.index);
    if (isNaN(idx) || idx < 0 || idx >= (customer.payments?.length || 0)) {
      return res.status(400).json({ success: false, error: '無效的繳款紀錄索引' });
    }
    const removed = customer.payments[idx];
    customer.payments.splice(idx, 1);
    await writeData(data);
    await logAction({
      action: '刪除繳款紀錄',
      user: req.user?.name || 'admin',
      customerId: customer.id,
      customerName: customer.name,
      detail: { removed }
    });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: '刪除失敗' });
  }
});

// 更新繳款日期
router.put('/:id/:index', async (req, res) => {
  try {
    const data = await readData();
    const customer = data.customers.find(c => c.id === req.params.id);
    if (!customer) {
      return res.status(404).json({ error: '找不到客戶' });
    }
    const index = parseInt(req.params.index);
    if (isNaN(index) || index < 0 || index >= customer.payments.length) {
      return res.status(400).json({ error: '無效的繳款紀錄索引' });
    }
    const payment = customer.payments[index];
    // 更新欄位
    let oldDate = payment.date;
    let oldAmount = payment.amount;
    let oldNote = payment.note;
    if (req.body.date) {
      const newDate = new Date(req.body.date);
      if (isNaN(newDate.getTime())) {
        return res.status(400).json({ error: '無效的日期格式' });
      }
      payment.date = newDate.toISOString();
    }
    if (req.body.amount !== undefined) {
      payment.amount = Number(req.body.amount);
    }
    if (req.body.note !== undefined) {
      payment.note = req.body.note;
    }
    // 重新排序繳款紀錄
    customer.payments.sort((a, b) => new Date(a.date) - new Date(b.date));
    await writeData(data);
    await logAction({
      action: '更新繳款紀錄',
      user: req.user?.name || 'admin',
      customerId: customer.id,
      customerName: customer.name,
      detail: {
        paymentIndex: index,
        oldDate,
        newDate: payment.date,
        amount: payment.amount,
        note: payment.note
      }
    });
    res.json({ success: true, payments: customer.payments });
  } catch (error) {
    res.status(500).json({ error: '更新繳款紀錄失敗' });
  }
});

// period override
router.patch('/:id/period-overrides', async (req, res) => {
  try {
    const { id } = req.params;
    const { period, start, due } = req.body;
    if (!period || !due) return res.json({ success: false, error: '缺少期數或日期' });
    const data = await readData();
    const customer = data.customers.find(c => c.id == id);
    if (!customer) return res.json({ success: false, error: '查無客戶' });
    if (!Array.isArray(customer.periodOverrides)) customer.periodOverrides = [];
    // 檢查是否已存在此期
    const idx = customer.periodOverrides.findIndex(po => po.period == period);
    if (idx >= 0) {
      customer.periodOverrides[idx].due = due;
      if (start) customer.periodOverrides[idx].start = start;
    } else {
      customer.periodOverrides.push({ period, due, ...(start ? { start } : {}) });
    }
    await writeData(data);
    res.json({ success: true });
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});

module.exports = router; 
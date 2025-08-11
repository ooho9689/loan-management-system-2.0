const express = require('express');
const router = express.Router();
const { readSales, writeSales } = require('../services/salesService');

// 取得所有設備
router.get('/', async (req, res) => {
  try {
    const sales = await readSales();
    res.json({ sales });
  } catch (e) {
    res.status(500).json({ error: '取得設備失敗' });
  }
});

// 新增設備
router.post('/', async (req, res) => {
  try {
    const sales = await readSales();
    const { name, appleAccount, applePassword, phone, findPhone } = req.body;
    if (!name || !appleAccount || !applePassword || !phone) return res.status(400).json({ error: '欄位不得為空' });
    const newSales = {
      id: Date.now().toString(),
      name,
      appleAccount,
      applePassword,
      phone,
      findPhone: findPhone || '',
      passwordLogs: [{ date: new Date().toISOString(), password: applePassword }]
    };
    sales.push(newSales);
    await writeSales(sales);
    res.json({ success: true, sales: newSales });
  } catch (e) {
    res.status(500).json({ error: '新增設備失敗' });
  }
});

// 編輯設備
router.put('/:id', async (req, res) => {
  try {
    const sales = await readSales();
    const s = sales.find(x => x.id === req.params.id);
    if (!s) return res.status(404).json({ error: '找不到設備' });
    const { name, appleAccount, applePassword, phone, findPhone } = req.body;
    if (name) s.name = name;
    if (appleAccount) s.appleAccount = appleAccount;
    if (phone) s.phone = phone;
    if (findPhone !== undefined) s.findPhone = findPhone;
    if (applePassword && applePassword !== s.applePassword) {
      s.applePassword = applePassword;
      if (!s.passwordLogs) s.passwordLogs = [];
      s.passwordLogs.push({ date: new Date().toISOString(), password: applePassword });
    }
    await writeSales(sales);
    res.json({ success: true, sales: s });
  } catch (e) {
    res.status(500).json({ error: '編輯設備失敗' });
  }
});

// 刪除設備
router.delete('/:id', async (req, res) => {
  try {
    const sales = await readSales();
    const idx = sales.findIndex(x => x.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: '找不到設備' });
    sales.splice(idx, 1);
    await writeSales(sales);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: '刪除設備失敗' });
  }
});

module.exports = router; 
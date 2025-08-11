const express = require('express');
const router = express.Router();
const { readData, writeData, listBackups, restoreData, createBackup } = require('../services/dataService');
const { logAction } = require('../services/logService');

// 一鍵修正資料
router.post('/data', async (req, res) => {
  try {
    const data = await readData();
    const seen = new Set();
    const fixed = [];
    for (const c of data.customers) {
      let id = c.id || c._id || Date.now().toString() + Math.random();
      if (seen.has(id)) continue;
      seen.add(id);
      const clean = { ...c, id };
      delete clean._id;
      fixed.push(clean);
    }
    await writeData({ customers: fixed });
    res.json({ success: true, count: fixed.length });
  } catch (error) {
    res.status(500).json({ error: '資料修正失敗' });
  }
});

// 一鍵補齊所有客戶 createdAt 欄位
router.post('/created-at', async (req, res) => {
  try {
    const data = await readData();
    let count = 0;
    for (const c of data.customers) {
      if (!c.createdAt) {
        c.createdAt = c.contractDate || new Date().toISOString();
        count++;
      }
    }
    await writeData(data);
    res.json({ success: true, count });
  } catch (e) {
    res.status(500).json({ error: '補齊 createdAt 失敗' });
  }
});

// 一鍵產生跨月份測試客戶
router.post('/generate-test-customers', async (req, res) => {
  try {
    const data = await readData();
    const now = new Date();
    const baseNames = ['王小明','李小華','陳大同','林美麗','張三','李四','王五','趙六','孫七','周八','吳九','鄭十'];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const name = baseNames[11-i] || `測試${i}`;
      const createdAt = d.toISOString();
      const contractDate = d.toISOString().slice(0,10);
      data.customers.push({
        id: Date.now().toString() + Math.random(),
        name,
        idNumber: `A${(10+i).toString().padStart(8,'0')}`,
        phone: `09${(100000000+i).toString().slice(0,8)}`,
        model: 'iPhone 14',
        imei: (''+Math.floor(100000000000000 + Math.random()*900000000000000)),
        serialNumber: `SN${i}${Date.now()%10000}`,
        screenPassword: '',
        address: '台北市測試路1號',
        currentAddress: '台北市測試路1號',
        contractDate,
        salePrice: 10000 + i*1000,
        rent: 2000 + i*100,
        bank: '台灣銀行',
        bankAccountName: name,
        bankAccountNumber: `00012345${i}`,
        status: 'renting',
        createdAt,
        idFront: 'test.png',
        idBack: 'test.png',
        billPhoto: 'test.png',
        contractPdf: 'test.pdf',
        payments: [
          { date: d.toISOString(), amount: 2000 + i*100 }
        ]
      });
    }
    await writeData(data);
    res.json({ success: true, count: 12 });
  } catch (e) {
    res.status(500).json({ error: '產生測試客戶失敗' });
  }
});

// 列出所有備份
router.get('/backups', async (req, res) => {
  try {
    const backups = await listBackups();
    res.json({ 
      success: true, 
      backups: backups.map(file => ({
        filename: file,
        date: file.replace('data-backup-', '').replace('.json', '').replace(/-/g, ':').replace('T', ' ').replace('Z', '')
      }))
    });
  } catch (error) {
    res.status(500).json({ success: false, error: '獲取備份列表失敗' });
  }
});

// 手動創建備份
router.post('/backup', async (req, res) => {
  try {
    await createBackup();
    await logAction({
      action: '手動創建備份',
      user: req.user?.name || 'admin',
      detail: { timestamp: new Date().toISOString() }
    });
    res.json({ success: true, message: '備份創建成功' });
  } catch (error) {
    res.status(500).json({ success: false, error: '創建備份失敗' });
  }
});

// 恢復數據
router.post('/restore/:filename', async (req, res) => {
  try {
    const { filename } = req.params;
    const success = await restoreData(filename);
    
    if (success) {
      await logAction({
        action: '恢復數據',
        user: req.user?.name || 'admin',
        detail: { backupFile: filename }
      });
      res.json({ success: true, message: '數據恢復成功' });
    } else {
      res.status(500).json({ success: false, error: '數據恢復失敗' });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: '數據恢復失敗' });
  }
});

// 檢查數據完整性
router.get('/check', async (req, res) => {
  try {
    const fs = require('fs').promises;
    const path = require('path');
    
    const dataFile = path.join(__dirname, '../data.json');
    const backupDir = path.join(__dirname, '../backups');
    
    const checks = {
      dataFileExists: false,
      dataFileSize: 0,
      backupDirExists: false,
      backupCount: 0,
      lastBackup: null
    };
    
    try {
      const stats = await fs.stat(dataFile);
      checks.dataFileExists = true;
      checks.dataFileSize = stats.size;
    } catch (error) {
      checks.dataFileExists = false;
    }
    
    try {
      await fs.access(backupDir);
      checks.backupDirExists = true;
      const backups = await listBackups();
      checks.backupCount = backups.length;
      checks.lastBackup = backups[0] || null;
    } catch (error) {
      checks.backupDirExists = false;
    }
    
    res.json({ success: true, checks });
  } catch (error) {
    res.status(500).json({ success: false, error: '檢查數據完整性失敗' });
  }
});

module.exports = router; 
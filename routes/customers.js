const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const { readData, writeData } = require('../services/dataService');
const { validateCustomer } = require('../utils/validate');
const fs = require('fs');
const { logAction } = require('../services/logService');

const upload = multer({
  dest: path.join(__dirname, '../uploads'),
  limits: { fileSize: 10 * 1024 * 1024 }
});

const logPath = path.join(__dirname, '../logs/operation.log');
function appendLog(logObj) {
  fs.appendFileSync(logPath, JSON.stringify(logObj) + '\n');
}

// 新增客戶（含檔案上傳）
router.post('/', upload.fields([
  { name: 'idFront', maxCount: 1 },
  { name: 'idBack', maxCount: 1 },
  { name: 'billPhoto', maxCount: 1 },
  { name: 'contractPdf', maxCount: 1 }
]), async (req, res) => {
  try {
    const data = await readData();
    const body = req.body;
    const files = req.files;
    
    console.log('收到新增客戶請求:', {
      body: body,
      files: files ? Object.keys(files) : '無檔案'
    });
    
    const errorMsg = validateCustomer(body, files);
    if (errorMsg) {
      console.log('客戶新增驗證失敗:', errorMsg);
      return res.status(400).json({ success: false, message: errorMsg });
    }
    
    const newCustomer = {
      id: Date.now().toString(),
      ...body,
      salesId: body.salesId || '',
      status: 'renting',
      createdAt: new Date().toISOString(),
      idFront: files.idFront ? files.idFront[0].filename : '',
      idBack: files.idBack ? files.idBack[0].filename : '',
      billPhoto: files.billPhoto ? files.billPhoto[0].filename : '',
      contractPdf: files.contractPdf ? files.contractPdf[0].filename : '',
      payments: [],
      birthday: body.birthday || '',
      occupation: body.occupation || '',
      source: body.source || '',
      emergencyContactName: body.emergencyContactName || '',
      emergencyContactPhone: body.emergencyContactPhone || '',
      firstDealDate: new Date().toISOString().slice(0,10),
      dealCount: 1,
      isNameMatch: (body.name && body.bankAccountName) ? (body.name === body.bankAccountName) : true
    };
    
    console.log('準備新增客戶:', {
      id: newCustomer.id,
      name: newCustomer.name,
      phone: newCustomer.phone
    });
    
    data.customers.push(newCustomer);
    await writeData(data);
    
    console.log('客戶新增成功:', newCustomer.id);
    
    await logAction({
      action: '新增客戶',
      user: req.user?.name || 'admin',
      customerId: newCustomer.id,
      customerName: newCustomer.name,
      detail: { ...newCustomer }
    });
    
    res.json({ success: true, customer: newCustomer });
  } catch (error) {
    console.error('新增客戶時發生錯誤:', error);
    res.status(500).json({ success: false, message: '新增客戶失敗: ' + error.message });
  }
});

// 取得所有客戶
router.get('/', async (req, res) => {
  try {
    const data = await readData();
    res.json({ customers: data.customers });
  } catch (error) {
    res.status(500).json({ error: '獲取客戶列表失敗' });
  }
});

// PUT 編輯客戶
router.put('/:id', upload.fields([
  { name: 'idFront', maxCount: 1 },
  { name: 'idBack', maxCount: 1 },
  { name: 'billPhoto', maxCount: 1 },
  { name: 'contractPdf', maxCount: 1 }
]), async (req, res) => {
  try {
    const data = await readData();
    const customer = data.customers.find(c => c.id === req.params.id);
    if (!customer) {
      return res.status(404).json({ error: '找不到客戶' });
    }
    Object.assign(customer, req.body);
    if (req.body.salesId !== undefined) customer.salesId = req.body.salesId;
    let fileOps = [];
    if (req.files.idFront) { customer.idFront = req.files.idFront[0].filename; fileOps.push({type:'idFront',file:req.files.idFront[0].originalname}); }
    if (req.files.idBack) { customer.idBack = req.files.idBack[0].filename; fileOps.push({type:'idBack',file:req.files.idBack[0].originalname}); }
    if (req.files.billPhoto) { customer.billPhoto = req.files.billPhoto[0].filename; fileOps.push({type:'billPhoto',file:req.files.billPhoto[0].originalname}); }
    if (req.files.contractPdf) { customer.contractPdf = req.files.contractPdf[0].filename; fileOps.push({type:'contractPdf',file:req.files.contractPdf[0].originalname}); }
    await writeData(data);
    await logAction({
      action: '編輯客戶',
      user: req.user?.name || 'admin',
      customerId: customer.id,
      customerName: customer.name,
      detail: { ...req.body, fileOps }
    });
    res.json({ success: true, customer });
  } catch (error) {
    res.status(500).json({ error: '編輯客戶失敗' });
  }
});

// 刪除客戶
router.delete('/:id', async (req, res) => {
  try {
    const data = await readData();
    const idx = data.customers.findIndex(c => c.id === req.params.id);
    if (idx === -1) {
      return res.status(404).json({ error: '找不到客戶' });
    }
    const deleted = data.customers[idx];
    data.customers.splice(idx, 1);
    await writeData(data);
    await logAction({
      action: '刪除客戶',
      user: req.user?.name || 'admin',
      customerId: deleted.id,
      customerName: deleted.name,
      detail: { ...deleted }
    });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: '刪除客戶失敗' });
  }
});

// 客戶狀態修改（結清/已買回）
router.patch('/:id/status', async (req, res) => {
  try {
    const data = await readData();
    const customer = data.customers.find(c => c.id === req.params.id);
    if (!customer) return res.status(404).json({ error: '找不到客戶' });
    
    const oldStatus = customer.status;
    customer.status = req.body.status || 'buyback';
    
    // 如果狀態變更為已買回，自動添加買回價金作為付款記錄
    if (customer.status === 'buyback' && oldStatus !== 'buyback') {
      const today = new Date().toISOString().split('T')[0];
      const buybackPayment = {
        date: today,
        amount: customer.salePrice,
        type: 'buyback',
        note: '買回價金'
      };
      
      if (!customer.payments) {
        customer.payments = [];
      }
      customer.payments.push(buybackPayment);
    }
    
    await writeData(data);
    await logAction({
      action: '修改狀態',
      user: req.user?.name || 'admin',
      customerId: customer.id,
      customerName: customer.name,
      detail: { oldStatus, newStatus: customer.status }
    });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: '修改狀態失敗' });
  }
});

// 取得單一客戶的繳款紀錄
router.get('/:id/payments', async (req, res) => {
  try {
    const data = await readData();
    const customer = data.customers.find(c => c.id === req.params.id);
    if (!customer) {
      return res.status(404).json({ error: '找不到客戶' });
    }
    res.json({ payments: customer.payments || [] });
  } catch (error) {
    res.status(500).json({ error: '取得繳款紀錄失敗' });
  }
});

// 新增繳款紀錄
router.post('/:id/payments', async (req, res) => {
  try {
    const data = await readData();
    const customer = data.customers.find(c => c.id === req.params.id);
    if (!customer) {
      return res.status(404).json({ error: '找不到客戶' });
    }

    const { amount, date, note } = req.body;
    
    if (!amount || isNaN(amount) || amount <= 0) {
      return res.status(400).json({ error: '請輸入有效的繳款金額' });
    }

    if (!date) {
      return res.status(400).json({ error: '請選擇繳款日期' });
    }

    if (!customer.payments) {
      customer.payments = [];
    }

    const payment = {
      date: new Date(date).toISOString(),
      amount: Number(amount),
      note: note || ''
    };

    customer.payments.push(payment);
    
    // 按日期排序繳款紀錄
    customer.payments.sort((a, b) => new Date(a.date) - new Date(b.date));

    await writeData(data);
    await logAction({
      action: '新增繳款',
      user: req.user?.name || 'admin',
      customerId: customer.id,
      customerName: customer.name,
      detail: { payment }
    });

    res.json({ success: true, payment });
  } catch (error) {
    console.error('新增繳款失敗:', error);
    res.status(500).json({ error: '新增繳款失敗' });
  }
});

// 刪除指定附件
router.delete('/:id/file/:type', async (req, res) => {
  try {
    const data = await readData();
    const customer = data.customers.find(c => c.id === req.params.id);
    if (!customer) return res.status(404).json({ success: false, error: '找不到客戶' });
    const type = req.params.type;
    const fileField = {
      idFront: 'idFront',
      idBack: 'idBack',
      billPhoto: 'billPhoto',
      contractPdf: 'contractPdf'
    }[type];
    if (!fileField) return res.status(400).json({ success: false, error: '無效的檔案類型' });
    const filename = customer[fileField];
    if (filename) {
      const filePath = require('path').join(__dirname, '../uploads', filename);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      customer[fileField] = '';
      await writeData(data);
      // 新增日誌
      appendLog({
        timestamp: new Date().toISOString(),
        user: req.user ? req.user.username : 'unknown',
        action: 'delete_file',
        customerId: req.params.id,
        fileType: type,
        fileName: filename,
        ip: req.ip
      });
      return res.json({ success: true });
    } else {
      return res.status(400).json({ success: false, error: '沒有檔案可刪除' });
    }
  } catch (e) {
    res.status(500).json({ success: false, error: '刪除檔案失敗' });
  }
});

module.exports = router; 
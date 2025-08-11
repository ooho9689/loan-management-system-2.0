const express = require('express');
const router = express.Router();
const { readData } = require('../services/dataService');
const { generateAccountTable, generateAccountStats } = require('../services/accountService');
const ExcelJS = require('exceljs');

// 帳表 JSON 預覽
router.get('/table', async (req, res) => {
  try {
    const table = await generateAccountTable();
    const stats = await generateAccountStats();
    
    res.json({ 
      table,
      stats,
      headers: {
        id: '客戶ID',
        name: '姓名',
        phone: '電話',
        model: '手機型號',
        contractDate: '合約日期',
        rent: '租金',
        cycle: '週期(天)',
        salePrice: '買賣價金',
        currentPeriod: '當前期數',
        shouldPay: '應繳總額',
        totalPaid: '已繳總額',
        currentPeriodPaid: '本期已繳',
        currentPeriodRemain: '本期未繳',
        nextDueDate: '下次應繳日',
        profit: '損益',
        overdueDays: '逾期天數',
        status: '狀態',
        statusText: '狀態說明',
        payments: '繳款紀錄'
      }
    });
  } catch (error) {
    res.status(500).json({ error: '取得帳表失敗' });
  }
});

// 帳表統計
router.get('/stats', async (req, res) => {
  try {
    const stats = await generateAccountStats();
    res.json({ stats });
  } catch (error) {
    res.status(500).json({ error: '取得帳表統計失敗' });
  }
});

// 匯出 Excel
router.get('/excel', async (req, res) => {
  try {
    const table = await generateAccountTable();
    const stats = await generateAccountStats();
    
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('客戶帳務');

    // 設定欄位寬度
    sheet.columns = [
      { header: '客戶ID', key: 'id', width: 15 },
      { header: '姓名', key: 'name', width: 12 },
      { header: '電話', key: 'phone', width: 15 },
      { header: '手機型號', key: 'model', width: 20 },
      { header: '合約日期', key: 'contractDate', width: 12 },
      { header: '租金', key: 'rent', width: 10 },
      { header: '週期(天)', key: 'cycle', width: 10 },
      { header: '買賣價金', key: 'salePrice', width: 12 },
      { header: '當前期數', key: 'currentPeriod', width: 10 },
      { header: '應繳總額', key: 'shouldPay', width: 12 },
      { header: '已繳總額', key: 'totalPaid', width: 12 },
      { header: '本期已繳', key: 'currentPeriodPaid', width: 12 },
      { header: '本期未繳', key: 'currentPeriodRemain', width: 12 },
      { header: '下次應繳日', key: 'nextDueDate', width: 12 },
      { header: '損益', key: 'profit', width: 10 },
      { header: '逾期天數', key: 'overdueDays', width: 10 },
      { header: '狀態', key: 'statusText', width: 10 },
      { header: '繳款紀錄', key: 'payments', width: 50 }
    ];

    // 設定表頭樣式
    sheet.getRow(1).font = { bold: true };
    sheet.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' };
    sheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E0E0' }
    };

    // 設定數字格式
    const numberColumns = ['rent', 'cycle', 'salePrice', 'currentPeriod', 'shouldPay', 'totalPaid', 'currentPeriodPaid', 'currentPeriodRemain', 'profit', 'overdueDays'];
    numberColumns.forEach(col => {
      sheet.getColumn(col).numFmt = '#,##0';
    });

    // 設定日期格式
    const dateColumns = ['contractDate', 'nextDueDate'];
    dateColumns.forEach(col => {
      sheet.getColumn(col).numFmt = 'yyyy/mm/dd';
    });

    // 新增資料
    table.forEach(row => {
      // 格式化繳款紀錄
      const paymentsStr = row.payments.map(p => `${p.date}-${p.amount}${p.note ? `(${p.note})` : ''}`).join('; ');
      
      const excelRow = sheet.addRow({
        id: row.id,
        name: row.name,
        phone: row.phone,
        model: row.model,
        contractDate: row.contractDate,
        rent: row.rent,
        cycle: row.cycle,
        salePrice: row.salePrice,
        currentPeriod: row.currentPeriod,
        shouldPay: row.shouldPay,
        totalPaid: row.totalPaid,
        currentPeriodPaid: row.currentPeriodPaid,
        currentPeriodRemain: row.currentPeriodRemain,
        nextDueDate: row.nextDueDate,
        profit: row.profit,
        overdueDays: row.overdueDays,
        statusText: row.statusText,
        payments: paymentsStr
      });

      // 設定逾期標記顏色
      if (row.isOverdue) {
        excelRow.font = { color: { argb: 'FFFF0000' } };
      }

      // 設定損益顏色
      if (row.profit < 0) {
        excelRow.getCell('profit').font = { color: { argb: 'FFFF0000' } };
      } else if (row.profit > 0) {
        excelRow.getCell('profit').font = { color: { argb: 'FF008000' } };
      }
    });

    // 凍結表頭
    sheet.views = [
      { state: 'frozen', xSplit: 0, ySplit: 1 }
    ];

    // 添加統計摘要工作表
    const summarySheet = workbook.addWorksheet('統計摘要');
    summarySheet.columns = [
      { header: '項目', key: 'item', width: 20 },
      { header: '數量', key: 'count', width: 15 },
      { header: '百分比', key: 'percentage', width: 15 },
      { header: '金額', key: 'amount', width: 20 }
    ];

    summarySheet.getRow(1).font = { bold: true };
    summarySheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E0E0' }
    };

    summarySheet.addRow({ item: '總客戶數', count: stats.total, percentage: '100%', amount: '' });
    summarySheet.addRow({ item: '正常客戶', count: stats.normal, percentage: `${stats.normalRate}%`, amount: '' });
    summarySheet.addRow({ item: '逾期客戶', count: stats.overdue, percentage: `${stats.overdueRate}%`, amount: '' });
    summarySheet.addRow({ item: '呆帳客戶', count: stats.locked, percentage: `${stats.lockedRate}%`, amount: '' });
    summarySheet.addRow({ item: '已買回客戶', count: stats.buyback, percentage: `${stats.buybackRate}%`, amount: '' });
    summarySheet.addRow({ item: '結清客戶', count: stats.completed, percentage: `${stats.completedRate}%`, amount: '' });
    summarySheet.addRow({ item: '', count: '', percentage: '', amount: '' });
    summarySheet.addRow({ item: '應繳總額', count: '', percentage: '', amount: stats.totalShouldPay });
    summarySheet.addRow({ item: '已繳總額', count: '', percentage: '', amount: stats.totalPaid });
    summarySheet.addRow({ item: '總損益', count: '', percentage: '', amount: stats.totalProfit });
    summarySheet.addRow({ item: '逾期金額', count: '', percentage: '', amount: stats.totalOverdueAmount });
    summarySheet.addRow({ item: '回收率', count: '', percentage: `${stats.recoveryRate}%`, amount: '' });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=account_statement.xlsx');
    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    res.status(500).json({ error: '匯出 Excel 失敗' });
  }
});

module.exports = router; 
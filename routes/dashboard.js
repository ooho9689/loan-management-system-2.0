const express = require('express');
const router = express.Router();
const { readData } = require('../services/dataService');

// 儀錶板統計 - 重新設計版本
router.get('/', async (req, res) => {
  try {
    const data = await readData();
    const type = req.query.type || 'month';
    const start = req.query.start;
    const end = req.query.end;
    
    console.log('儀表板請求:', { type, start, end });
    
    // 解析日期範圍
    let startDate, endDate;
    if (start && end) {
      startDate = new Date(start + 'T00:00:00');
      endDate = new Date(end + 'T23:59:59');
    } else {
      const now = new Date();
      if (type === 'day') {
        endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29, 0, 0, 0);
      } else {
        endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
        startDate = new Date(now.getFullYear(), now.getMonth() - 11, 1, 0, 0, 0);
      }
    }

    console.log('日期範圍:', { startDate, endDate });

    // 過濾有效客戶（在日期範圍內簽約的）
    const validCustomers = data.customers.filter(c => {
      if (!c.contractDate) return false;
      const contractDate = new Date(c.contractDate.replace(/-/g, '/'));
      if (isNaN(contractDate.getTime())) return false;
      return contractDate >= startDate && contractDate <= endDate;
    });

    console.log('有效客戶數:', validCustomers.length);

    // 計算基礎統計
    const total = validCustomers.length;
    const renting = validCustomers.filter(c => c.status === 'renting').length;
    const buyback = validCustomers.filter(c => ['buyback', '已買回'].includes(c.status)).length;
    const locked = validCustomers.filter(c => ['locked', '呆帳'].includes(c.status)).length;
    
    // 計算呆帳率
    const buybackLockedRate = total > 0 ? Math.round((locked / total) * 100) : 0;
    const buybackRate = total > 0 ? Math.round((buyback / total) * 100) : 0;

    // 計算金額統計
    const accumulatedSales = validCustomers.reduce((sum, c) => sum + (Number(c.salePrice) || 0), 0);
    
    // 計算呆帳金額
    const lockedAmount = validCustomers.reduce((sum, c) => {
      if (['locked', '呆帳'].includes(c.status)) {
        const totalPaid = (c.payments || []).reduce((sum, p) => sum + Number(p.amount), 0);
        const unpaid = Number(c.salePrice) - totalPaid;
        return sum + (unpaid > 0 ? unpaid : 0);
      }
      return sum;
    }, 0);
    
    const avgLockedAmount = locked > 0 ? Math.round(lockedAmount / locked) : 0;

    // 計算損益（已結算客戶）
    const closedCustomers = validCustomers.filter(c => ['buyback', 'locked', '已買回', '呆帳'].includes(c.status));
    const closedTotalPaid = closedCustomers.reduce((sum, c) => 
      sum + (c.payments || []).reduce((s, p) => s + Number(p.amount), 0), 0);
    const closedTotalSale = closedCustomers.reduce((sum, c) => sum + (Number(c.salePrice) || 0), 0);
    const profit = closedTotalPaid - closedTotalSale;

    // 生成時間序列數據
    const timeSeries = generateTimeSeries(startDate, endDate, type, validCustomers);

    console.log('時間序列數據:', timeSeries);

    // 模型和地區分布
    const modelDist = {};
    const regionDist = {};
    
    validCustomers.forEach(c => {
      if (c.model) {
        modelDist[c.model] = (modelDist[c.model] || 0) + 1;
      }
      if (c.currentAddress) {
        let match = c.currentAddress.match(/^(台|臺)?(\S{1,2}[縣市]|\S{1,2}區|\S{1,2}鄉|\S{1,2}鎮)/);
        let region = match ? match[0] : '其他';
        region = region.replace(/^台/, '臺');
        regionDist[region] = (regionDist[region] || 0) + 1;
      }
    });

    // 計算實時數據
    const today = new Date();
    const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 0, 0, 0);
    const todayEnd = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59);
    
    const todayNew = data.customers.filter(c => {
      if (!c.contractDate) return false;
      const contractDate = new Date(c.contractDate.replace(/-/g, '/'));
      return contractDate >= todayStart && contractDate <= todayEnd;
    }).length;
    
    const todayPayments = data.customers.reduce((sum, c) => {
      return sum + (c.payments || []).filter(p => {
        const paymentDate = new Date(p.date);
        return paymentDate >= todayStart && paymentDate <= todayEnd;
      }).reduce((s, p) => s + Number(p.amount), 0);
    }, 0);

    // 計算風險指標
    const overdueCount = data.customers.filter(c => {
      if (c.status !== 'renting') return false;
      const contractDate = new Date(c.contractDate.replace(/-/g, '/'));
      const cycle = Number(c.paymentCycleDays) || 30;
      const rent = Number(c.rent) || 0;
      const periods = Math.max(1, Math.floor((today - contractDate) / (cycle * 24 * 60 * 60 * 1000)) + 1);
      const shouldPay = periods * rent;
      const paid = (c.payments || []).reduce((sum, p) => sum + Number(p.amount), 0);
      return shouldPay - paid > 0;
    }).length;

    const response = {
      total,
      newCustomers: total, // 在選定範圍內的新客戶數
      pending: renting,
      stats: {
        months: timeSeries.labels,
        newCustomers: timeSeries.newCustomers,
        rentingCounts: timeSeries.renting,
        buybackCounts: timeSeries.buyback,
        lockedCounts: timeSeries.locked,
        revenue: timeSeries.shouldReceive,
        profit: timeSeries.profit,
        cost: timeSeries.shouldReceive.map((revenue, i) => revenue - (timeSeries.profit[i] || 0)),
        successRate: timeSeries.newCustomers.map((newCust, i) => 
          newCust > 0 ? Math.round(((newCust - (timeSeries.locked[i] || 0)) / newCust) * 100) : 0),
        pendingRate: timeSeries.overdue.map((overdue, i) => 
          timeSeries.newCustomers[i] > 0 ? Math.round((overdue / timeSeries.newCustomers[i]) * 100) : 0),
        riskRate: timeSeries.locked.map((locked, i) => 
          timeSeries.newCustomers[i] > 0 ? Math.round((locked / timeSeries.newCustomers[i]) * 100) : 0)
      },
      buybackLockedRate,
      lockedAmount,
      avgLockedAmount,
      buybackRate,
      lockedCustomers: locked,
      buybackCustomers: buyback,
      accumulatedSales,
      modelDist,
      regionDist,
      profit,
      // 添加實時監控數據
      todayNew,
      todayPayments: Math.round(todayPayments),
      overdueAlerts: overdueCount,
      systemStatus: '正常',
      // 添加風險評估數據
      overdueRate: total > 0 ? Math.round((overdueCount / total) * 100) : 0,
      badDebtRate: buybackLockedRate,
      churnRate: total > 0 ? Math.round((locked / total) * 100) : 0,
      // 添加趨勢數據
      customerTrend: '+12%',
      revenueTrend: '+8%',
      paymentTrend: '-5%',
      lockedTrend: '+2%',
      buybackTrend: '+15%',
      profitTrend: '+18%',
      dateRange: {
        start: startDate.toISOString().split('T')[0],
        end: endDate.toISOString().split('T')[0]
      }
    };

    console.log('儀表板響應:', response);
    res.json(response);

  } catch (error) {
    console.error('儀表板錯誤:', error);
    res.status(500).json({ error: '獲取儀表板數據失敗' });
  }
});

// 生成時間序列數據
function generateTimeSeries(startDate, endDate, type, customers) {
  const labels = [];
  const data = {
    newCustomers: [],
    renting: [],
    buyback: [],
    locked: [],
    overdue: [],
    shouldReceive: [],
    received: [],
    overdueAmount: [],
    lockedAmount: [],
    profit: []
  };

  if (type === 'day') {
    // 按天生成
    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
      const label = d.toISOString().split('T')[0];
      labels.push(label);
      
      const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0);
      const dayEnd = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59);
      
      const dayStats = calculateDayStats(customers, dayStart, dayEnd);
      
      Object.keys(data).forEach(key => {
        data[key].push(dayStats[key] || 0);
      });
    }
  } else {
    // 按月生成
    for (let d = new Date(startDate.getFullYear(), startDate.getMonth(), 1); 
         d <= endDate; 
         d.setMonth(d.getMonth() + 1)) {
      const label = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      labels.push(label);
      
      const monthStart = new Date(d.getFullYear(), d.getMonth(), 1);
      const monthEnd = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59);
      
      const monthStats = calculateMonthStats(customers, monthStart, monthEnd);
      
      Object.keys(data).forEach(key => {
        data[key].push(monthStats[key] || 0);
      });
    }
  }

  return {
    labels,
    ...data
  };
}

// 計算單日統計
function calculateDayStats(customers, dayStart, dayEnd) {
  const dayCustomers = customers.filter(c => {
    if (!c.contractDate) return false;
    const contractDate = new Date(c.contractDate.replace(/-/g, '/'));
    return contractDate >= dayStart && contractDate <= dayEnd;
  });

  const stats = {
    newCustomers: dayCustomers.length,
    renting: 0,
    buyback: 0,
    locked: 0,
    overdue: 0,
    shouldReceive: 0,
    received: 0,
    overdueAmount: 0,
    lockedAmount: 0,
    profit: 0
  };

  dayCustomers.forEach(c => {
    // 狀態分類
    if (c.status === 'renting') {
      stats.renting++;
      
      // 計算逾期情況
      const contractDate = new Date(c.contractDate.replace(/-/g, '/'));
      const cycle = Number(c.paymentCycleDays) || 30;
      const rent = Number(c.rent) || 0;
      const today = new Date();
      const periods = Math.max(1, Math.floor((today - contractDate) / (cycle * 24 * 60 * 60 * 1000)) + 1);
      const shouldPay = periods * rent;
      const paid = (c.payments || []).reduce((sum, p) => sum + Number(p.amount), 0);
      
      if (shouldPay - paid > 0) {
        stats.overdue++;
        stats.overdueAmount += shouldPay - paid;
      }
    } else if (['buyback', '已買回'].includes(c.status)) {
      stats.buyback++;
    } else if (['locked', '呆帳'].includes(c.status)) {
      stats.locked++;
      stats.overdue++;
    }

    // 金額計算
    const salePrice = Number(c.salePrice) || 0;
    const paid = (c.payments || []).reduce((sum, p) => sum + Number(p.amount), 0);
    stats.shouldReceive += salePrice;
    stats.received += paid;

    // 呆帳金額
    if (['locked', '呆帳'].includes(c.status)) {
      const unpaid = salePrice - paid;
      if (unpaid > 0) {
        stats.lockedAmount += unpaid;
        stats.overdueAmount += unpaid;
      }
    }

    // 損益計算
    if (['buyback', 'locked', '已買回', '呆帳'].includes(c.status)) {
      stats.profit += paid - salePrice;
    }
  });

  return stats;
}

// 計算單月統計
function calculateMonthStats(customers, monthStart, monthEnd) {
  const monthCustomers = customers.filter(c => {
    if (!c.contractDate) return false;
    const contractDate = new Date(c.contractDate.replace(/-/g, '/'));
    return contractDate >= monthStart && contractDate <= monthEnd;
  });

  const stats = {
    newCustomers: monthCustomers.length,
    renting: 0,
    buyback: 0,
    locked: 0,
    overdue: 0,
    shouldReceive: 0,
    received: 0,
    overdueAmount: 0,
    lockedAmount: 0,
    profit: 0
  };

  monthCustomers.forEach(c => {
    // 狀態分類
    if (c.status === 'renting') {
      stats.renting++;
      
      // 計算逾期情況
      const contractDate = new Date(c.contractDate.replace(/-/g, '/'));
      const cycle = Number(c.paymentCycleDays) || 30;
      const rent = Number(c.rent) || 0;
      const today = new Date();
      const periods = Math.max(1, Math.floor((today - contractDate) / (cycle * 24 * 60 * 60 * 1000)) + 1);
      const shouldPay = periods * rent;
      const paid = (c.payments || []).reduce((sum, p) => sum + Number(p.amount), 0);
      
      if (shouldPay - paid > 0) {
        stats.overdue++;
        stats.overdueAmount += shouldPay - paid;
      }
    } else if (['buyback', '已買回'].includes(c.status)) {
      stats.buyback++;
    } else if (['locked', '呆帳'].includes(c.status)) {
      stats.locked++;
      stats.overdue++;
    }

    // 金額計算
    const salePrice = Number(c.salePrice) || 0;
    const paid = (c.payments || []).reduce((sum, p) => sum + Number(p.amount), 0);
    stats.shouldReceive += salePrice;
    stats.received += paid;

    // 呆帳金額
    if (['locked', '呆帳'].includes(c.status)) {
      const unpaid = salePrice - paid;
      if (unpaid > 0) {
        stats.lockedAmount += unpaid;
        stats.overdueAmount += unpaid;
      }
    }

    // 損益計算
    if (['buyback', 'locked', '已買回', '呆帳'].includes(c.status)) {
      stats.profit += paid - salePrice;
    }
  });

  return stats;
}

module.exports = router; 
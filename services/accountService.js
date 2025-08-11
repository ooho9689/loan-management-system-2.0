const { readData } = require('./dataService');

// 帳務狀態枚舉
const ACCOUNT_STATUS = {
  NORMAL: 'normal',           // 正常
  OVERDUE: 'overdue',         // 逾期
  LOCKED: 'locked',           // 呆帳
  BUYBACK: 'buyback',         // 已買回
  COMPLETED: 'completed'      // 結清
};

// 計算客戶帳務狀態
function calculateAccountStatus(customer) {
  const { status, contractDate, paymentCycleDays, rent, payments = [] } = customer;
  
  // 已買回或呆帳狀態
  if (status === 'buyback' || status === 'locked') {
    return status === 'buyback' ? ACCOUNT_STATUS.BUYBACK : ACCOUNT_STATUS.LOCKED;
  }
  
  // 計算租賃週期
  const contract = new Date(contractDate);
  const today = new Date();
  const cycle = Number(paymentCycleDays) || 30;
  
  // 計算應繳期數
  const daysSinceContract = Math.floor((today - contract) / (24 * 60 * 60 * 1000));
  const currentPeriod = Math.floor(daysSinceContract / cycle) + 1;
  
  // 計算應繳總額
  const shouldPay = currentPeriod * Number(rent);
  const totalPaid = payments.reduce((sum, p) => sum + Number(p.amount), 0);
  
  // 判斷是否逾期
  if (shouldPay > totalPaid) {
    return ACCOUNT_STATUS.OVERDUE;
  }
  
  // 判斷是否結清（已繳清買賣價金）
  const salePrice = Number(customer.salePrice) || 0;
  if (totalPaid >= salePrice) {
    return ACCOUNT_STATUS.COMPLETED;
  }
  
  return ACCOUNT_STATUS.NORMAL;
}

// 計算帳務摘要
function calculateAccountSummary(customer) {
  const { contractDate, paymentCycleDays, rent, payments = [], salePrice } = customer;
  const cycle = Number(paymentCycleDays) || 30;
  const contract = new Date(contractDate);
  const today = new Date();
  
  // 計算週期資訊
  const daysSinceContract = Math.floor((today - contract) / (24 * 60 * 60 * 1000));
  const currentPeriod = Math.floor(daysSinceContract / cycle) + 1;
  const nextPeriod = currentPeriod + 1;
  
  // 計算應繳金額
  const shouldPay = currentPeriod * Number(rent);
  const totalPaid = payments.reduce((sum, p) => sum + Number(p.amount), 0);
  const currentPeriodPaid = calculateCurrentPeriodPaid(customer);
  const currentPeriodRemain = Number(rent) - currentPeriodPaid;
  
  // 計算下次應繳日
  const nextDueDate = calculateNextDueDate(customer);
  
  // 計算損益
  const profit = totalPaid - Number(salePrice);
  
  // 計算逾期天數
  const overdueDays = calculateOverdueDays(customer);
  
  return {
    currentPeriod,
    nextPeriod,
    shouldPay,
    totalPaid,
    currentPeriodPaid,
    currentPeriodRemain,
    nextDueDate,
    profit,
    overdueDays,
    status: calculateAccountStatus(customer)
  };
}

// 計算本期已繳金額
function calculateCurrentPeriodPaid(customer) {
  const { contractDate, paymentCycleDays, rent, payments = [] } = customer;
  const cycle = Number(paymentCycleDays) || 30;
  const contract = new Date(contractDate);
  
  // 計算本期開始日
  const daysSinceContract = Math.floor((new Date() - contract) / (24 * 60 * 60 * 1000));
  const currentPeriod = Math.floor(daysSinceContract / cycle) + 1;
  const periodStart = new Date(contract);
  periodStart.setDate(periodStart.getDate() + (currentPeriod - 1) * cycle);
  
  // 計算本期結束日
  const periodEnd = new Date(periodStart);
  periodEnd.setDate(periodEnd.getDate() + cycle - 1);
  
  // 計算本期繳款
  return payments
    .filter(p => {
      const paymentDate = new Date(p.date);
      return paymentDate >= periodStart && paymentDate <= periodEnd;
    })
    .reduce((sum, p) => sum + Number(p.amount), 0);
}

// 計算下次應繳日
function calculateNextDueDate(customer) {
  const { contractDate, paymentCycleDays, payments = [] } = customer;
  const cycle = Number(paymentCycleDays) || 30;
  const contract = new Date(contractDate);
  
  // 找到最後一次繳款日期
  if (payments.length > 0) {
    const sortedPayments = [...payments].sort((a, b) => new Date(b.date) - new Date(a.date));
    const lastPayment = new Date(sortedPayments[0].date);
    const nextDue = new Date(lastPayment);
    nextDue.setDate(nextDue.getDate() + cycle);
    return nextDue;
  }
  
  // 如果沒有繳款紀錄，從合約日開始計算
  const nextDue = new Date(contract);
  nextDue.setDate(nextDue.getDate() + cycle);
  return nextDue;
}

// 計算逾期天數
function calculateOverdueDays(customer) {
  const nextDue = calculateNextDueDate(customer);
  const today = new Date();
  const overdueDays = Math.floor((today - nextDue) / (24 * 60 * 60 * 1000));
  return overdueDays > 0 ? overdueDays : 0;
}

// 生成帳表數據
async function generateAccountTable() {
  const data = await readData();
  
  return data.customers.map(customer => {
    const summary = calculateAccountSummary(customer);
    const { payments = [] } = customer;
    
    // 格式化繳款紀錄
    const formattedPayments = payments
      .sort((a, b) => new Date(a.date) - new Date(b.date))
      .map(p => ({
        date: new Date(p.date).toLocaleDateString(),
        amount: Number(p.amount),
        note: p.note || ''
      }));
    
    return {
      id: customer.id,
      name: customer.name,
      phone: customer.phone,
      model: customer.model,
      contractDate: customer.contractDate,
      rent: Number(customer.rent),
      cycle: Number(customer.paymentCycleDays) || 30,
      salePrice: Number(customer.salePrice),
      currentPeriod: summary.currentPeriod,
      shouldPay: summary.shouldPay,
      totalPaid: summary.totalPaid,
      currentPeriodPaid: summary.currentPeriodPaid,
      currentPeriodRemain: summary.currentPeriodRemain,
      nextDueDate: summary.nextDueDate.toLocaleDateString(),
      profit: summary.profit,
      overdueDays: summary.overdueDays,
      status: summary.status,
      statusText: getStatusText(summary.status),
      payments: formattedPayments,
      isOverdue: summary.status === ACCOUNT_STATUS.OVERDUE || summary.status === ACCOUNT_STATUS.LOCKED
    };
  });
}

// 獲取狀態文字
function getStatusText(status) {
  const statusMap = {
    [ACCOUNT_STATUS.NORMAL]: '正常',
    [ACCOUNT_STATUS.OVERDUE]: '逾期',
    [ACCOUNT_STATUS.LOCKED]: '呆帳',
    [ACCOUNT_STATUS.BUYBACK]: '已買回',
    [ACCOUNT_STATUS.COMPLETED]: '結清'
  };
  return statusMap[status] || '未知';
}

// 生成帳表統計
async function generateAccountStats() {
  const table = await generateAccountTable();
  
  const stats = {
    total: table.length,
    normal: table.filter(t => t.status === ACCOUNT_STATUS.NORMAL).length,
    overdue: table.filter(t => t.status === ACCOUNT_STATUS.OVERDUE).length,
    locked: table.filter(t => t.status === ACCOUNT_STATUS.LOCKED).length,
    buyback: table.filter(t => t.status === ACCOUNT_STATUS.BUYBACK).length,
    completed: table.filter(t => t.status === ACCOUNT_STATUS.COMPLETED).length,
    totalShouldPay: table.reduce((sum, t) => sum + t.shouldPay, 0),
    totalPaid: table.reduce((sum, t) => sum + t.totalPaid, 0),
    totalProfit: table.reduce((sum, t) => sum + t.profit, 0),
    totalOverdueAmount: table
      .filter(t => t.isOverdue)
      .reduce((sum, t) => sum + (t.shouldPay - t.totalPaid), 0)
  };
  
  // 計算百分比
  stats.normalRate = Math.round((stats.normal / stats.total) * 100);
  stats.overdueRate = Math.round((stats.overdue / stats.total) * 100);
  stats.lockedRate = Math.round((stats.locked / stats.total) * 100);
  stats.buybackRate = Math.round((stats.buyback / stats.total) * 100);
  stats.completedRate = Math.round((stats.completed / stats.total) * 100);
  stats.recoveryRate = Math.round((stats.totalPaid / stats.totalShouldPay) * 100);
  
  return stats;
}

module.exports = {
  ACCOUNT_STATUS,
  calculateAccountStatus,
  calculateAccountSummary,
  generateAccountTable,
  generateAccountStats,
  getStatusText
}; 
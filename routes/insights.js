const express = require('express');
const router = express.Router();
const { readData } = require('../services/dataService');

// 工具：取得每期狀態（for 回收分析）
function getPeriodsStatus(customer) {
  const contractDate = new Date(customer.contractDate);
  const today = new Date();
  const cycle = Number(customer.paymentCycleDays) || 30;
  const rent = Number(customer.rent);
  const payments = (customer.payments || []).map(p => ({...p, date: new Date(p.date), amount: Number(p.amount), period: p.period}));
  payments.sort((a,b) => a.date-b.date);
  const periodOverrides = Array.isArray(customer.periodOverrides) ? customer.periodOverrides : [];
  let periods = [];
  let periodStart = new Date(contractDate);
  let periodEnd;
  let usedPaymentIdx = new Set();
  let periodIdx = 0;
  while (true) {
    const override = periodOverrides.find(po => po.period === periodIdx + 1);
    if (override && override.start) {
      periodStart = new Date(override.start);
    } else if (periodIdx === 0) {
      periodStart = new Date(contractDate);
    } else {
      periodStart = new Date(periodEnd);
      periodStart.setDate(periodStart.getDate() + 1);
    }
    if (override && override.due) {
      periodEnd = new Date(override.due);
      periodEnd.setHours(23,59,59,999);
    } else {
      periodEnd = new Date(periodStart);
      periodEnd.setDate(periodEnd.getDate() + cycle - 1);
      periodEnd.setHours(23,59,59,999);
    }
    if (periodStart > today && periodStart > new Date()) break;
    let paid = 0;
    payments.forEach((p, idx) => {
      if (p.period === periodIdx + 1) {
        paid += p.amount;
        usedPaymentIdx.add(idx);
      }
    });
    if (paid === 0) {
      payments.forEach((p, idx) => {
        if (!p.period && !usedPaymentIdx.has(idx)) {
          const pd = new Date(p.date.getFullYear(), p.date.getMonth(), p.date.getDate());
          const ps = new Date(periodStart.getFullYear(), periodStart.getMonth(), periodStart.getDate());
          const pe = new Date(periodEnd.getFullYear(), periodEnd.getMonth(), periodEnd.getDate());
          if (pd >= ps && pd <= pe) {
            paid += p.amount;
            usedPaymentIdx.add(idx);
          }
        }
      });
    }
    let isPaid = paid >= rent;
    periods.push({
      start: new Date(periodStart),
      end: new Date(periodEnd),
      paid,
      isPaid
    });
    periodIdx++;
  }
  return { periods };
}

// 風險評分常數
const RISK_WEIGHTS = {
  CONTRACT_AMOUNT: {
    LOW: { threshold: 10000, score: 10 },
    MEDIUM: { threshold: 20000, score: 20 },
    HIGH: { threshold: Infinity, score: 30 }
  },
  PAYMENT_HISTORY: {
    EXCELLENT: { threshold: 12, score: -50 },  // 12次以上準時付款
    GOOD: { threshold: 6, score: -30 },        // 6-11次準時付款
    FAIR: { threshold: 3, score: -20 },        // 3-5次準時付款
    POOR: { threshold: 0, score: 0 }           // 3次以下
  },
  PREVIOUS_BAD_DEBT: 100,                      // 有前次呆帳紀錄
  AREA_RISK: 30,                               // 高風險地區
  UNSTABLE_OCCUPATION: {
    HIGH: { occupations: ['無填寫', '臨時工', '自營戶', '自由業'], score: 50 },
    MEDIUM: { occupations: ['服務業', '餐飲業', '零售業'], score: 30 },
    LOW: { occupations: ['公務員', '教師', '醫師', '工程師'], score: 20 }
  },
  DEVICE_VALUE: {
    LOW: { threshold: 15000, score: 10 },
    MEDIUM: { threshold: 25000, score: 25 },
    HIGH: { threshold: Infinity, score: 40 }
  }
};

// 計算風險分數
function calculateRiskScore(customer, areaRiskMap) {
  let score = 0;
  
  // 1. 合約金額風險
  const amount = Number(customer.salePrice) || 0;
  if (amount <= RISK_WEIGHTS.CONTRACT_AMOUNT.LOW.threshold) {
    score += RISK_WEIGHTS.CONTRACT_AMOUNT.LOW.score;
  } else if (amount <= RISK_WEIGHTS.CONTRACT_AMOUNT.MEDIUM.threshold) {
    score += RISK_WEIGHTS.CONTRACT_AMOUNT.MEDIUM.score;
  } else {
    score += RISK_WEIGHTS.CONTRACT_AMOUNT.HIGH.score;
  }

  // 2. 歷史準時付款次數
  const onTimePayments = (customer.payments || []).filter(p => {
    const paymentDate = new Date(p.date);
    const { periods } = getPeriodsStatus(customer);
    const period = periods.find(per => 
      paymentDate >= per.start && paymentDate <= per.end
    );
    return period && period.isPaid;
  }).length;

  if (onTimePayments >= RISK_WEIGHTS.PAYMENT_HISTORY.EXCELLENT.threshold) {
    score += RISK_WEIGHTS.PAYMENT_HISTORY.EXCELLENT.score;
  } else if (onTimePayments >= RISK_WEIGHTS.PAYMENT_HISTORY.GOOD.threshold) {
    score += RISK_WEIGHTS.PAYMENT_HISTORY.GOOD.score;
  } else if (onTimePayments >= RISK_WEIGHTS.PAYMENT_HISTORY.FAIR.threshold) {
    score += RISK_WEIGHTS.PAYMENT_HISTORY.FAIR.score;
  } else {
    score += RISK_WEIGHTS.PAYMENT_HISTORY.POOR.score;
  }

  // 3. 前次呆帳紀錄
  if (customer.status === 'locked') {
    score += RISK_WEIGHTS.PREVIOUS_BAD_DEBT;
  }

  // 4. 地區風險
  const city = customer.address?.slice(0, 3) || '';
  if (areaRiskMap[city] && areaRiskMap[city].rate > 0.15) { // 15%以上呆帳率視為高風險地區
    score += RISK_WEIGHTS.AREA_RISK;
  }

  // 5. 職業風險
  const occupation = customer.occupation || '無填寫';
  if (RISK_WEIGHTS.UNSTABLE_OCCUPATION.HIGH.occupations.includes(occupation)) {
    score += RISK_WEIGHTS.UNSTABLE_OCCUPATION.HIGH.score;
  } else if (RISK_WEIGHTS.UNSTABLE_OCCUPATION.MEDIUM.occupations.includes(occupation)) {
    score += RISK_WEIGHTS.UNSTABLE_OCCUPATION.MEDIUM.score;
  } else if (RISK_WEIGHTS.UNSTABLE_OCCUPATION.LOW.occupations.includes(occupation)) {
    score += RISK_WEIGHTS.UNSTABLE_OCCUPATION.LOW.score;
  }

  // 6. 機型價值風險
  const deviceValue = Number(customer.deviceValue) || amount;
  if (deviceValue <= RISK_WEIGHTS.DEVICE_VALUE.LOW.threshold) {
    score += RISK_WEIGHTS.DEVICE_VALUE.LOW.score;
  } else if (deviceValue <= RISK_WEIGHTS.DEVICE_VALUE.MEDIUM.threshold) {
    score += RISK_WEIGHTS.DEVICE_VALUE.MEDIUM.score;
  } else {
    score += RISK_WEIGHTS.DEVICE_VALUE.HIGH.score;
  }

  // 確保分數在 0-100 之間
  return Math.max(0, Math.min(100, score));
}

// 數據分析建議
router.get('/', async (req, res) => {
  try {
    const data = await readData();
    // 統計指標
    const total = data.customers.length;
    const lockedCount = data.customers.filter(c => ['locked', '呆帳'].includes(c.status)).length;
    const buybackCount = data.customers.filter(c => ['buyback', '已買回'].includes(c.status)).length;
    const rentingCount = data.customers.filter(c => c.status === 'renting').length;
    const totalSale = data.customers.reduce((sum, c) => sum + (Number(c.salePrice) || 0), 0);
    const totalPaid = data.customers.reduce((sum, c) => sum + (c.payments||[]).reduce((s,p)=>s+Number(p.amount),0), 0);
    const overdueCount = data.customers.filter(c => {
      if (['locked', '呆帳'].includes(c.status)) return true;
      if (c.status === 'renting') {
        const contract = new Date(c.contractDate);
        const cycle = Number(c.paymentCycleDays)||30;
        const rent = Number(c.rent)||0;
        const today = new Date();
        let periods = Math.floor((today - contract) / (cycle * 24 * 60 * 60 * 1000)) + 1;
        if (periods < 1) periods = 1;
        const shouldPay = periods * rent;
        const paid = (c.payments||[]).reduce((sum,p)=>sum+Number(p.amount),0);
        return shouldPay - paid > 0;
      }
      return false;
    }).length;
    // 近三月新增客戶
    const now = new Date();
    const last3Months = [];
    for (let i = 2; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const label = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
      last3Months.push(label);
    }
    const newCustomersByMonth = last3Months.map(label =>
      data.customers.filter(c => c.contractDate && c.contractDate.startsWith(label)).length
    );
    // 進階指標
    const highAmount = 15000;
    const stablePeriods = 3;
    const highAmountCount = data.customers.filter(c => Number(c.salePrice) >= highAmount).length;
    const stableCount = data.customers.filter(c => {
      const payments = (c.payments||[]).map(p => ({...p, date: new Date(p.date)}));
      payments.sort((a,b) => a.date-b.date);
      const contractDate = new Date(c.contractDate);
      const cycle = Number(c.paymentCycleDays)||30;
      let periods = [];
      let periodStart = new Date(contractDate);
      let periodEnd;
      for (let i = 0; i < stablePeriods; i++) {
        periodEnd = new Date(periodStart);
        periodEnd.setDate(periodEnd.getDate() + cycle - 1);
        const paid = payments.filter(p => p.date >= periodStart && p.date <= periodEnd).reduce((sum, p) => sum + Number(p.amount), 0);
        if (paid < Number(c.rent)) return false;
        periodStart = new Date(periodEnd);
        periodStart.setDate(periodStart.getDate() + 1);
      }
      return true;
    }).length;
    // 指標計算
    const lockedRate = total ? Math.round(lockedCount / total * 100) : 0;
    const overdueRate = total ? Math.round(overdueCount / total * 100) : 0;
    const recoveryRate = totalSale ? Math.round(totalPaid / totalSale * 100) : 0;
    const buybackRate = total ? Math.round(buybackCount / total * 100) : 0;
    const highAmountRate = total ? Math.round(highAmountCount / total * 100) : 0;
    const stableRate = total ? Math.round(stableCount / total * 100) : 0;
    // 動態建議
    const suggestions = [];
    if (lockedRate >= 30) {
      suggestions.push(`⚠️ 目前您的呆帳率高達 ${lockedRate}% ，這是非常危險的訊號。我建議您立即檢討放款政策，並加強高風險客戶的審核與催收。建議：1. 立即暫停高風險客戶放款 2. 設立專責催收人員 3. 定期檢討審核標準 4. 導入第三方徵信服務 5. 建立逾期客戶黑名單。`);
    } else if (lockedRate >= 15) {
      suggestions.push(`您的呆帳率偏高（${lockedRate}%），建議近期內減少放款額度，並強化催收流程。建議：1. 提高審核門檻 2. 導入第三方徵信服務 3. 建立逾期客戶黑名單 4. 定期教育設備風險意識 5. 強化合約條款保護。`);
    } else if (lockedRate >= 8) {
      suggestions.push(`呆帳率略高（${lockedRate}%），可適度調整審核標準，降低未來風險。建議：1. 定期教育設備風險意識 2. 強化合約條款保護 3. 設立早鳥繳款獎勵 4. 對逾期客戶啟動分期協商 5. 定期發送繳款提醒簡訊。`);
    } else {
      suggestions.push(`呆帳率控制良好（${lockedRate}%），請持續保持審慎的放款策略。建議：可考慮逐步擴大優質客戶放款額度，並推動會員推薦獎勵，擴大優質客戶群。`);
    }
    if (recoveryRate < 70) {
      suggestions.push(`回收率僅 ${recoveryRate}% ，現金流壓力較大。建議：1. 設立早鳥繳款獎勵 2. 對逾期客戶啟動分期協商 3. 定期發送繳款提醒簡訊 4. 優化催收話術 5. 導入自動化催收系統。`);
    } else if (recoveryRate < 85) {
      suggestions.push(`回收率 ${recoveryRate}% ，尚有提升空間。建議：1. 優化催收話術 2. 導入自動化催收系統 3. 針對高風險客戶提前預警 4. 定期檢討催收成效 5. 導入自動提醒系統。`);
    } else if (recoveryRate >= 95) {
      suggestions.push(`回收率高達 ${recoveryRate}% ，現金流非常健康。建議：可考慮推動會員推薦獎勵，擴大優質客戶群，並定期舉辦客戶回饋活動，建立VIP客戶群。`);
    }
    if (overdueRate >= 30) {
      suggestions.push(`逾期率高達 ${overdueRate}% ，請加強客戶篩選與催收流程。建議：1. 設立逾期專案小組 2. 對逾期客戶分級管理 3. 強化合約違約條款 4. 定期檢討催收成效 5. 導入自動提醒系統。`);
    } else if (overdueRate >= 15) {
      suggestions.push(`逾期率偏高（${overdueRate}%），可檢討催收流程。建議：1. 定期檢討催收成效 2. 導入自動提醒系統 3. 設立早鳥繳款獎勵 4. 對逾期客戶啟動分期協商 5. 定期發送繳款提醒簡訊。`);
    } else {
      suggestions.push(`逾期率控制良好。建議：可將經驗分享給團隊，提升整體催收效率，並定期舉辦客戶回饋活動，建立VIP客戶群。`);
    }
    if (buybackRate > 60) {
      suggestions.push(`已買回客戶比例高（${buybackRate}%），可考慮推出續租或升級方案，提升客戶終身價值。建議：1. 推出續租優惠 2. 設計升級換機專案 3. 建立會員分級制度 4. 定期舉辦客戶回饋活動 5. 推薦獎勵計畫。`);
    } else if (buybackRate < 20) {
      suggestions.push(`已買回比例偏低（${buybackRate}%），可檢討合約設計或推動買回誘因。建議：1. 增加買回折扣 2. 推動到期提醒 3. 強化設備買回獎金 4. 定期舉辦客戶回饋活動 5. 推薦獎勵計畫。`);
    }
    if (highAmountRate < 10) {
      suggestions.push(`高額合約客戶比例偏低（${highAmountRate}%），可考慮提升單客價值或推高階產品。建議：1. 推出高階機型專案 2. 分期升級方案 3. 強化高額客戶專屬服務 4. 定期舉辦客戶回饋活動 5. 推薦獎勵計畫。`);
    } else if (highAmountRate > 40) {
      suggestions.push(`高額合約客戶比例高（${highAmountRate}%），請注意風險控管。建議：1. 強化高額客戶徵信 2. 設立高額合約審核機制 3. 定期教育設備風險意識 4. 強化合約條款保護 5. 導入第三方徵信服務。`);
    }
    if (stableRate > 50) {
      suggestions.push(`穩定客戶比例高（${stableRate}%），請持續維護良好客戶關係。建議：1. 定期舉辦客戶回饋活動 2. 推薦獎勵計畫 3. 建立VIP客戶群 4. 推出續租優惠 5. 設計升級換機專案。`);
    } else if (stableRate < 10) {
      suggestions.push(`穩定客戶比例偏低（${stableRate}%），可加強客戶教育與服務。建議：1. 強化新客戶教育 2. 提供專屬客服 3. 定期追蹤客戶滿意度 4. 定期舉辦客戶回饋活動 5. 推薦獎勵計畫。`);
    }
    if (newCustomersByMonth[2] < newCustomersByMonth[1] && newCustomersByMonth[1] < newCustomersByMonth[0]) {
      suggestions.push(`⚠️ 新增客戶數連續三月下滑，建議加強行銷推廣或檢討產品策略。建議：1. 舉辦線上抽獎活動 2. 推出老客戶推薦新客戶獎勵 3. 強化社群行銷 4. 分析成長來源 5. 加大有效行銷預算。`);
    } else if (newCustomersByMonth[2] > newCustomersByMonth[1] && newCustomersByMonth[1] > newCustomersByMonth[0]) {
      suggestions.push(`🎉 新增客戶數連續三月成長，行銷策略奏效，請持續努力！建議：1. 分析成長來源 2. 加大有效行銷預算 3. 持續追蹤成效 4. 舉辦線上抽獎活動 5. 推出老客戶推薦新客戶獎勵。`);
    } else {
      suggestions.push('目前各項指標正常，請持續保持！建議：定期檢討各項指標，預防潛在風險，並定期舉辦客戶回饋活動，建立VIP客戶群。');
    }
    // AI 助理風格自然語言摘要
    let summary = '';
    if (lockedRate >= 30) {
      summary += `⚠️ 目前您的呆帳率高達 ${lockedRate}% ，這是非常危險的訊號。我建議您立即檢討放款政策，並加強高風險客戶的審核與催收。可考慮暫停高風險放款、設立催收專員、導入第三方徵信服務。`;
    } else if (lockedRate >= 15) {
      summary += `您的呆帳率偏高（${lockedRate}%），建議近期內減少放款額度，並強化催收流程。可導入第三方徵信、建立黑名單、定期教育設備風險意識。`;
    } else if (lockedRate >= 8) {
      summary += `呆帳率略高（${lockedRate}%），可適度調整審核標準，降低未來風險。可定期教育設備風險意識、設立早鳥繳款獎勵、對逾期客戶啟動分期協商。`;
    } else {
      summary += `呆帳率控制良好（${lockedRate}%），請持續保持審慎的放款策略。可逐步擴大優質客戶放款額度，並推動會員推薦獎勵，擴大優質客戶群。`;
    }
    if (recoveryRate < 70) {
      summary += ` 回收率僅 ${recoveryRate}% ，現金流壓力較大。建議設立早鳥繳款獎勵、分期協商、優化催收話術、導入自動化催收系統。`;
    } else if (recoveryRate < 85) {
      summary += ` 回收率 ${recoveryRate}% ，尚有提升空間。可優化催收話術、導入自動化催收、定期檢討催收成效、導入自動提醒系統。`;
    } else if (recoveryRate >= 95) {
      summary += ` 回收率高達 ${recoveryRate}% ，現金流非常健康，值得肯定！可推動會員推薦獎勵，並定期舉辦客戶回饋活動，建立VIP客戶群。`;
    }
    if (overdueRate >= 30) {
      summary += ` 逾期率高達 ${overdueRate}% ，請加強客戶篩選與催收流程，避免呆帳進一步惡化。可設立逾期專案小組、對逾期客戶分級管理、強化合約違約條款。`;
    } else if (overdueRate >= 15) {
      summary += ` 逾期率偏高（${overdueRate}%），可檢討催收流程。可定期檢討催收成效、導入自動提醒系統、設立早鳥繳款獎勵。`;
    } else {
      summary += ` 逾期率控制良好。可將經驗分享給團隊，提升整體催收效率，並定期舉辦客戶回饋活動，建立VIP客戶群。`;
    }
    if (buybackRate > 60) {
      summary += ` 已買回客戶比例高（${buybackRate}%），可考慮推出續租或升級方案，提升客戶終身價值。可設計升級換機專案、建立會員分級制度、定期舉辦客戶回饋活動。`;
    } else if (buybackRate < 20) {
      summary += ` 已買回比例偏低（${buybackRate}%），可檢討合約設計或推動買回誘因。可增加買回折扣、推動到期提醒、強化設備買回獎金。`;
    }
    if (highAmountRate < 10) {
      summary += ` 高額合約客戶比例偏低（${highAmountRate}%），可考慮提升單客價值或推高階產品。可推出高階機型專案、分期升級方案、強化高額客戶專屬服務。`;
    } else if (highAmountRate > 40) {
      summary += ` 高額合約客戶比例高（${highAmountRate}%），請注意風險控管。可設立高額合約審核機制、定期教育設備風險意識、強化合約條款保護。`;
    }
    if (stableRate > 50) {
      summary += ` 穩定客戶比例高（${stableRate}%），請持續維護良好客戶關係。可舉辦客戶回饋活動、推薦獎勵計畫、建立VIP客戶群。`;
    } else if (stableRate < 10) {
      summary += ` 穩定客戶比例偏低（${stableRate}%），可加強客戶教育與服務。可提供專屬客服、定期追蹤客戶滿意度、定期舉辦客戶回饋活動。`;
    }
    if (newCustomersByMonth[2] < newCustomersByMonth[1] && newCustomersByMonth[1] < newCustomersByMonth[0]) {
      summary += ` ⚠️ 新增客戶數連續三月下滑，建議加強行銷推廣或檢討產品策略。可舉辦線上抽獎活動、推出老客戶推薦新客戶獎勵、強化社群行銷。`;
    } else if (newCustomersByMonth[2] > newCustomersByMonth[1] && newCustomersByMonth[1] > newCustomersByMonth[0]) {
      summary += ` 🎉 新增客戶數連續三月成長，行銷策略奏效，請持續努力！可加大有效行銷預算、分析成長來源、持續追蹤成效。`;
    }
    if (!summary) summary = '目前各項指標正常，請持續保持！建議：定期檢討各項指標，預防潛在風險，並定期舉辦客戶回饋活動，建立VIP客戶群。';

    res.json({
      lockedRate,
      overdueRate,
      recoveryRate,
      buybackRate,
      highAmountRate,
      stableRate,
      newCustomersByMonth,
      summary,
      suggestions
    });
  } catch (e) {
    res.status(500).json({ suggestions: ['數據分析失敗，請稍後再試'] });
  }
});

// 智能分析 API
router.get('/smart', async (req, res) => {
  const data = await readData();
  const customers = data.customers || [];

  // 1. 地區呆帳率
  const areaStats = {};
  customers.forEach(c => {
    const city = c.address?.slice(0, 3) || '';
    if (!areaStats[city]) areaStats[city] = { total: 0, locked: 0 };
    areaStats[city].total++;
    if (c.status === 'locked') areaStats[city].locked++;
  });
  const areaRates = Object.entries(areaStats).map(([city, stat]) => ({
    city,
    total: stat.total,
    locked: stat.locked,
    rate: stat.total ? (stat.locked / stat.total) : 0
  })).sort((a, b) => b.rate - a.rate);

  // 2. 姓名戶名不一致
  const notMatch = customers.filter(c => c.name && c.bankAccountName && c.name !== c.bankAccountName);
  const notMatchRate = customers.length ? notMatch.length / customers.length : 0;
  const notMatchLockedRate = notMatch.length ? notMatch.filter(c => c.status === 'locked').length / notMatch.length : 0;

  // 3. 來源/職業/設備呆帳率
  function groupRate(field) {
    const stats = {};
    customers.forEach(c => {
      const key = c[field] || '未填';
      if (!stats[key]) stats[key] = { total: 0, locked: 0 };
      stats[key].total++;
      if (c.status === 'locked') stats[key].locked++;
    });
    return Object.entries(stats).map(([k, v]) => ({
      key: k,
      total: v.total,
      locked: v.locked,
      rate: v.total ? (v.locked / v.total) : 0
    })).sort((a, b) => b.rate - a.rate);
  }
  const sourceRates = groupRate('source');
  const occupationRates = groupRate('occupation');
  const salesRates = groupRate('salesId');

  // 4. 重複客戶偵測
  const idMap = {}, phoneMap = {}, accountMap = {};
  customers.forEach(c => {
    if (c.idNumber) idMap[c.idNumber] = (idMap[c.idNumber] || 0) + 1;
    if (c.phone) phoneMap[c.phone] = (phoneMap[c.phone] || 0) + 1;
    if (c.bankAccountNumber) accountMap[c.bankAccountNumber] = (accountMap[c.bankAccountNumber] || 0) + 1;
  });
  const duplicate = {
    idNumber: Object.entries(idMap).filter(([k, v]) => v > 1).map(([k]) => k),
    phone: Object.entries(phoneMap).filter(([k, v]) => v > 1).map(([k]) => k),
    bankAccountNumber: Object.entries(accountMap).filter(([k, v]) => v > 1).map(([k]) => k)
  };

  // 智能分析建議
  const smartSuggestions = [];
  // 地區呆帳率前3名
  if (areaRates.length > 0) {
    const topAreas = areaRates.slice(0, 3).filter(a => a.rate > 0.08);
    if (topAreas.length > 0) {
      smartSuggestions.push('【高風險地區排名】');
      topAreas.forEach((a, i) => {
        smartSuggestions.push(`${i+1}. ${a.city} 呆帳率 ${(a.rate*100).toFixed(1)}%（${a.locked}/${a.total}人），建議加強該地區審核與催收。`);
      });
    }
  }
  // 來源呆帳率前3名
  if (sourceRates.length > 0) {
    const topSources = sourceRates.slice(0, 3).filter(s => s.rate > 0.08);
    if (topSources.length > 0) {
      smartSuggestions.push('【高風險來源排名】');
      topSources.forEach((s, i) => {
        smartSuggestions.push(`${i+1}. 來源「${s.key}」呆帳率 ${(s.rate*100).toFixed(1)}%（${s.locked}/${s.total}人），建議檢討該來源的行銷與審核策略。`);
      });
    }
  }
  // 職業呆帳率前3名
  if (occupationRates.length > 0) {
    const topOccs = occupationRates.slice(0, 3).filter(o => o.rate > 0.08);
    if (topOccs.length > 0) {
      smartSuggestions.push('【高風險職業排名】');
      topOccs.forEach((o, i) => {
        smartSuggestions.push(`${i+1}. 職業「${o.key}」呆帳率 ${(o.rate*100).toFixed(1)}%（${o.locked}/${o.total}人），建議針對該職業加強審核。`);
      });
    }
  }
  // 設備呆帳率前3名
  if (salesRates.length > 0) {
    const topSales = salesRates.slice(0, 3).filter(s => s.rate > 0.08);
    if (topSales.length > 0) {
      smartSuggestions.push('【高風險設備排名】');
      topSales.forEach((s, i) => {
        smartSuggestions.push(`${i+1}. 設備「${s.key}」名下客戶呆帳率 ${(s.rate*100).toFixed(1)}%（${s.locked}/${s.total}人），建議檢討該設備的審核與管理。`);
      });
    }
  }
  // 姓名戶名不一致
  if (notMatch.rate > 0.1) {
    smartSuggestions.push(`⚠️ 有 ${(notMatch.rate*100).toFixed(1)}% 客戶姓名與銀行戶名不一致，建議加強身份核對，降低詐騙與呆帳風險。`);
  }
  // 重複客戶
  if (duplicate.idNumber.length > 0 || duplicate.phone.length > 0 || duplicate.bankAccountNumber.length > 0) {
    smartSuggestions.push(`⚠️ 偵測到重複客戶（身分證/手機/帳號），建議加強人工審核，避免詐騙與呆帳風險。`);
  }
  if (smartSuggestions.length === 0) {
    smartSuggestions.push('目前無明顯異常，請持續關注各項指標。');
  }

  // 年齡層分群
  function getAge(birthday) {
    if (!birthday) return null;
    const birth = new Date(birthday);
    if (isNaN(birth)) return null;
    const now = new Date();
    let age = now.getFullYear() - birth.getFullYear();
    if (now.getMonth() < birth.getMonth() || (now.getMonth() === birth.getMonth() && now.getDate() < birth.getDate())) age--;
    return age;
  }
  const ageGroups = {'20-29':0,'30-39':0,'40-49':0,'50-59':0,'60+':0};
  const ageStats = {'20-29':{total:0,locked:0},'30-39':{total:0,locked:0},'40-49':{total:0,locked:0},'50-59':{total:0,locked:0},'60+':{total:0,locked:0}};
  customers.forEach(c => {
    const age = getAge(c.birthday);
    let group = null;
    if (age !== null) {
      if (age >= 20 && age <= 29) group = '20-29';
      else if (age >= 30 && age <= 39) group = '30-39';
      else if (age >= 40 && age <= 49) group = '40-49';
      else if (age >= 50 && age <= 59) group = '50-59';
      else if (age >= 60) group = '60+';
      if (group) {
        ageGroups[group]++;
        ageStats[group].total++;
        if (c.status === 'locked') ageStats[group].locked++;
      }
    }
  });
  const ageRates = Object.entries(ageStats).map(([k,v])=>({group:k,total:v.total,locked:v.locked,rate:v.total?v.locked/v.total:0})).filter(a=>a.total>0).sort((a,b)=>b.rate-a.rate);
  // 首次成交年/月分布
  const yearStats = {}, monthStats = {};
  customers.forEach(c => {
    if (c.contractDate) {
      const y = c.contractDate.slice(0,4);
      const m = c.contractDate.slice(0,7);
      if (!yearStats[y]) yearStats[y]={total:0,locked:0};
      if (!monthStats[m]) monthStats[m]={total:0,locked:0};
      yearStats[y].total++;
      monthStats[m].total++;
      if (c.status==='locked') { yearStats[y].locked++; monthStats[m].locked++; }
    }
  });
  const yearRates = Object.entries(yearStats).map(([k,v])=>({year:k,total:v.total,locked:v.locked,rate:v.total?v.locked/v.total:0})).sort((a,b)=>b.year-a.year);
  const monthRates = Object.entries(monthStats).map(([k,v])=>({month:k,total:v.total,locked:v.locked,rate:v.total?v.locked/v.total:0})).sort((a,b)=>b.month.localeCompare(a.month));
  // 合約金額區間
  const priceRanges = {'0-9999':{total:0,locked:0},'10000-19999':{total:0,locked:0},'20000+':{total:0,locked:0}};
  customers.forEach(c => {
    const price = Number(c.salePrice)||0;
    let range = null;
    if (price <= 9999) range = '0-9999';
    else if (price <= 19999) range = '10000-19999';
    else range = '20000+';
    priceRanges[range].total++;
    if (c.status==='locked') priceRanges[range].locked++;
  });
  const priceRates = Object.entries(priceRanges).map(([k,v])=>({range:k,total:v.total,locked:v.locked,rate:v.total?v.locked/v.total:0})).sort((a,b)=>b.rate-a.rate);
  // 來源細分類
  const sourceDetailStats = {};
  customers.forEach(c => {
    const src = (c.source||'未填').trim();
    if (!sourceDetailStats[src]) sourceDetailStats[src]={total:0,locked:0};
    sourceDetailStats[src].total++;
    if (c.status==='locked') sourceDetailStats[src].locked++;
  });
  const sourceDetailRates = Object.entries(sourceDetailStats).map(([k,v])=>({key:k,total:v.total,locked:v.locked,rate:v.total?v.locked/v.total:0})).sort((a,b)=>b.rate-a.rate);
  // 回購率
  const dealCountStats = {once:0,repeat:0,repeatLocked:0};
  customers.forEach(c => {
    const cnt = Number(c.dealCount)||1;
    if (cnt>1) { dealCountStats.repeat++; if (c.status==='locked') dealCountStats.repeatLocked++; }
    else dealCountStats.once++;
  });
  const repeatRate = (dealCountStats.repeat/(dealCountStats.once+dealCountStats.repeat))||0;
  const repeatLockedRate = dealCountStats.repeat?dealCountStats.repeatLocked/dealCountStats.repeat:0;
  // 緊急聯絡人電話重複
  const contactPhoneMap = {};
  customers.forEach(c => {
    if (c.emergencyContactPhone) contactPhoneMap[c.emergencyContactPhone] = (contactPhoneMap[c.emergencyContactPhone]||0)+1;
  });
  const duplicateContactPhones = Object.entries(contactPhoneMap).filter(([k,v])=>v>1).map(([k])=>k);
  // 合約週期長短
  const cycleStats = {};
  customers.forEach(c => {
    const cycle = Number(c.paymentCycleDays)||30;
    const key = cycle<=30?'≤30天':(cycle<=60?'31-60天':'61天以上');
    if (!cycleStats[key]) cycleStats[key]={total:0,locked:0};
    cycleStats[key].total++;
    if (c.status==='locked') cycleStats[key].locked++;
  });
  const cycleRates = Object.entries(cycleStats).map(([k,v])=>({cycle:k,total:v.total,locked:v.locked,rate:v.total?v.locked/v.total:0})).sort((a,b)=>b.rate-a.rate);

  // === 設備回收流程效率模組 ===
  // 只統計已買回/結清客戶
  function getBuybackDate(c) {
    if (!c.payments || c.payments.length === 0) return null;
    // 取最後一筆繳款日期
    return c.payments[c.payments.length - 1].date ? new Date(c.payments[c.payments.length - 1].date) : null;
  }
  function getFirstOverdueDate(c) {
    // 取第一個逾期期數的期末日+1天
    const { periods } = getPeriodsStatus(c);
    for (let i = 0; i < periods.length; i++) {
      if (!periods[i].isPaid && periods[i].end < new Date()) {
        const d = new Date(periods[i].end);
        d.setDate(d.getDate() + 1);
        return d;
      }
    }
    return null;
  }
  const buybackCustomers = customers.filter(c => c.status === 'buyback' && c.payments && c.payments.length > 0);
  let totalDays = 0, count = 0;
  buybackCustomers.forEach(c => {
    const buybackDate = getBuybackDate(c);
    const overdueDate = getFirstOverdueDate(c);
    if (buybackDate && overdueDate && buybackDate > overdueDate) {
      const days = Math.ceil((buybackDate - overdueDate) / (1000*60*60*24));
      totalDays += days;
      count++;
      c._recoveryDays = days;
    } else {
      c._recoveryDays = null;
    }
  });
  const avgRecoveryDays = count ? (totalDays / count) : 0;
  // 地區回收平均時長
  const areaRecovery = {};
  buybackCustomers.forEach(c => {
    const city = c.address ? c.address.slice(0,3) : '未知';
    if (!areaRecovery[city]) areaRecovery[city] = {total:0, sum:0, list:[]};
    if (c._recoveryDays) {
      areaRecovery[city].total++;
      areaRecovery[city].sum += c._recoveryDays;
      areaRecovery[city].list.push(c._recoveryDays);
    }
  });
  const areaRecoveryArr = Object.entries(areaRecovery).map(([city, v])=>({city, avg: v.total ? v.sum/v.total : 0, total: v.total})).filter(a=>a.total>0).sort((a,b)=>b.avg-a.avg);
  // 年齡層回收效率
  const ageRecovery = {'20-29':[], '30-39':[], '40-49':[], '50-59':[], '60+':[]};
  buybackCustomers.forEach(c => {
    const age = getAge(c.birthday);
    let group = null;
    if (age !== null) {
      if (age >= 20 && age <= 29) group = '20-29';
      else if (age >= 30 && age <= 39) group = '30-39';
      else if (age >= 40 && age <= 49) group = '40-49';
      else if (age >= 50 && age <= 59) group = '50-59';
      else if (age >= 60) group = '60+';
      if (group && c._recoveryDays) ageRecovery[group].push(c._recoveryDays);
    }
  });
  const ageRecoveryArr = Object.entries(ageRecovery).map(([k,v])=>({group:k,avg:v.length?v.reduce((a,b)=>a+b,0)/v.length:0,total:v.length})).filter(a=>a.total>0).sort((a,b)=>b.avg-a.avg);
  // 職業回收效率
  const occRecovery = {};
  buybackCustomers.forEach(c => {
    const occ = c.occupation||'未填';
    if (!occRecovery[occ]) occRecovery[occ]=[];
    if (c._recoveryDays) occRecovery[occ].push(c._recoveryDays);
  });
  const occRecoveryArr = Object.entries(occRecovery).map(([k,v])=>({occupation:k,avg:v.length?v.reduce((a,b)=>a+b,0)/v.length:0,total:v.length})).filter(a=>a.total>0).sort((a,b)=>b.avg-a.avg);
  // 設備回收效率
  const salesRecovery = {};
  buybackCustomers.forEach(c => {
    const sales = c.salesId||'未填';
    if (!salesRecovery[sales]) salesRecovery[sales]=[];
    if (c._recoveryDays) salesRecovery[sales].push(c._recoveryDays);
  });
  const salesRecoveryArr = Object.entries(salesRecovery).map(([k,v])=>({salesId:k,avg:v.length?v.reduce((a,b)=>a+b,0)/v.length:0,total:v.length})).filter(a=>a.total>0).sort((a,b)=>b.avg-a.avg);

  // === 智能建議 ===
  smartSuggestions.push(`【平均回收時長】全體平均 ${avgRecoveryDays.toFixed(1)} 天，${avgRecoveryDays>7?'⚠️ 已超過7天，建議檢討催收流程':'效率良好'}`);
  if (areaRecoveryArr.length>0) {
    smartSuggestions.push('【地區回收平均時長排名】');
    areaRecoveryArr.slice(0,3).forEach((a,i)=>{
      smartSuggestions.push(`${i+1}. ${a.city} 平均 ${a.avg.toFixed(1)} 天` + (a.avg>10?' ⚠️ 請加強該區催收與LINE通知':'') );
    });
  }
  if (ageRecoveryArr.length>0) {
    smartSuggestions.push('【年齡層回收效率排名】');
    ageRecoveryArr.slice(0,3).forEach((a,i)=>{
      smartSuggestions.push(`${i+1}. 年齡層${a.group} 平均 ${a.avg.toFixed(1)} 天`);
    });
  }
  if (occRecoveryArr.length>0) {
    smartSuggestions.push('【職業回收效率排名】');
    occRecoveryArr.slice(0,3).forEach((o,i)=>{
      smartSuggestions.push(`${i+1}. 職業「${o.occupation}」平均 ${o.avg.toFixed(1)} 天`);
    });
  }
  if (salesRecoveryArr.length>0) {
    smartSuggestions.push('【設備回收效率排名】');
    salesRecoveryArr.slice(0,3).forEach((s,i)=>{
      smartSuggestions.push(`${i+1}. 設備ID「${s.salesId}」平均 ${s.avg.toFixed(1)} 天` + (s.avg>10?' ⚠️ 需定期輔導':'') );
    });
  }

  res.json({
    areaRates,
    notMatch: {
      count: notMatch.length,
      rate: notMatchRate,
      lockedRate: notMatchLockedRate,
      list: notMatch.map(c => ({ id: c.id, name: c.name, bankAccountName: c.bankAccountName, status: c.status }))
    },
    sourceRates,
    occupationRates,
    salesRates,
    duplicate,
    smartSuggestions
  });
});

// 風險評分 API
router.get('/risk-score', async (req, res) => {
  try {
    const data = await readData();
    const customers = data.customers || [];

    // 計算各地區風險
    const areaRiskMap = {};
    customers.forEach(c => {
      const city = c.address?.slice(0, 3) || '';
      if (!areaRiskMap[city]) {
        areaRiskMap[city] = { total: 0, locked: 0 };
      }
      areaRiskMap[city].total++;
      if (c.status === 'locked') {
        areaRiskMap[city].locked++;
      }
    });
    Object.keys(areaRiskMap).forEach(city => {
      areaRiskMap[city].rate = areaRiskMap[city].locked / areaRiskMap[city].total;
    });

    // 計算每個客戶的風險分數
    const riskScores = customers.map(customer => {
      const score = calculateRiskScore(customer, areaRiskMap);
      return {
        id: customer.id,
        name: customer.name,
        score,
        riskLevel: score >= 60 ? '高風險' : (score >= 30 ? '中風險' : '低風險'),
        details: {
          contractAmount: Number(customer.salePrice) || 0,
          onTimePayments: (customer.payments || []).filter(p => {
            const paymentDate = new Date(p.date);
            const { periods } = getPeriodsStatus(customer);
            const period = periods.find(per => 
              paymentDate >= per.start && paymentDate <= per.end
            );
            return period && period.isPaid;
          }).length,
          hasPreviousBadDebt: customer.status === 'locked',
          area: customer.address?.slice(0, 3) || '',
          occupation: customer.occupation || '無填寫',
          deviceValue: Number(customer.deviceValue) || Number(customer.salePrice) || 0
        }
      };
    });

    // 風險分數統計
    const stats = {
      total: riskScores.length,
      highRisk: riskScores.filter(r => r.score >= 60).length,
      mediumRisk: riskScores.filter(r => r.score >= 30 && r.score < 60).length,
      lowRisk: riskScores.filter(r => r.score < 30).length,
      averageScore: riskScores.reduce((sum, r) => sum + r.score, 0) / riskScores.length
    };

    res.json({
      stats,
      riskScores: riskScores.sort((a, b) => b.score - a.score)
    });
  } catch (e) {
    res.status(500).json({ error: '風險評分計算失敗' });
  }
});

module.exports = router; 
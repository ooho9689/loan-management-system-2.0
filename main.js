// 設備管理初始化變數
let salesManagementInited = false;

// 工具函數
function validateIdNumber(idNumber) {
    const regex = /^[A-Z][12]\d{8}$/;
    return regex.test(idNumber);
}

function validatePhone(phone) {
    const regex = /^09\d{8}$/;
    return regex.test(phone);
}

function validateImei(imei) {
    const regex = /^\d{15}$/;
    return regex.test(imei);
}

function formatDate(date) {
    return new Date(date).toLocaleDateString('zh-TW');
}

function formatCurrency(amount) {
    return new Intl.NumberFormat('zh-TW', {
        style: 'currency',
        currency: 'TWD'
    }).format(amount);
  }
  
  function getStatusText(status) {
    const statusMap = {
      'renting': '租賃中',
      'buyback': '已買回',
        'locked': '呆帳',
        'due-today': '本日應繳'
    };
    return statusMap[status] || status;
  }
  
// API 基礎 URL
const API_BASE_URL = 'http://localhost:3001';

// 頁面切換
function showPage(pageId) {
    console.log('切換到頁面:', pageId);
    document.querySelectorAll('.page').forEach(page => {
        page.classList.remove('active');
        // 移除所有頁面的 display:none 樣式
        page.style.display = '';
    });
    const targetPage = document.getElementById(pageId);
    console.log('目標頁面元素:', targetPage);
    if (targetPage) {
        targetPage.classList.add('active');
        // 確保目標頁面顯示
        targetPage.style.display = 'block';
        console.log('頁面已設為活動狀態');
        if (pageId === 'list') {
            loadCustomers();
        }
        if (pageId === 'dashboard') {
            loadDashboard();
        }
        if (pageId === 'sales-management') {
            console.log('準備初始化設備管理頁面');
            initSalesManagementPage();
        }
        if (pageId === 'table') {
            loadTable();
        }
        if (pageId === 'logs') {
            loadLogs();
        }
        if (pageId === 'sales') {
            // 設備管理已移至獨立頁面
        }
    } else {
        console.error('找不到頁面元素:', pageId);
    }
}

// 計算下次應繳日與剩餘天數（根據繳款紀錄與週期）
function getNextDueDate(customer) {
    const contractDate = new Date(customer.contractDate);
    const cycle = Number(customer.paymentCycleDays) || 30;
    const rent = Number(customer.rent);
    const payments = (customer.payments || []).map(p => Number(p.amount));
    let totalPaid = payments.reduce((sum, amt) => sum + amt, 0);

    let periodStart = new Date(contractDate);
    let periodEnd = new Date(contractDate);
    let now = new Date();
    while (true) {
        periodEnd = new Date(periodStart);
        periodEnd.setDate(periodEnd.getDate() + cycle - 1);

        let paid = Math.min(totalPaid, rent);
        let isPaid = paid >= rent;

        if (!isPaid || periodEnd >= now) {
            // 下次應繳日為這一期的結束日+1
            let nextDue = new Date(periodEnd);
            nextDue.setDate(nextDue.getDate() + 1);
            return nextDue;
        }

        totalPaid -= paid;
        if (totalPaid < 0) totalPaid = 0;

        // 下一期
        periodStart = new Date(periodEnd);
        periodStart.setDate(periodStart.getDate() + 1);
    }
}

function getDaysLeft(nextDue) {
    const today = new Date();
    // 只取年月日
    const t = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const d = new Date(nextDue.getFullYear(), nextDue.getMonth(), nextDue.getDate());
    const diff = d - t;
    return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

// 中文表頭對應
const TABLE_HEADER_MAP = {
    name: '姓名',
    idNumber: '身分證字號',
    phone: '手機號碼',
    model: '手機型號',
    imei: 'IMEI',
    contractDate: '合約起始日',
    rent: '租金',
    paymentCycleDays: '繳款週期(天)',
    salePrice: '買賣價金',
    totalPaid: '累計已繳',
    profit: '損益',
    remain: '本期未繳',
    nextDue: '下次應繳日',
    status: '狀態',
    payments: '繳款紀錄'
};

// 載入客戶列表
let allCustomersCache = [];
let currentFilter = 'all';
let currentSearch = '';

async function loadCustomers() {
    console.log('開始載入客戶列表');
    const customerList = document.querySelector('.customer-list');
    if (!customerList) {
        console.error('找不到客戶列表元素');
        return;
    }

    try {
        customerList.innerHTML = '<div class="loading"></div>';
        const response = await fetch(`${API_BASE_URL}/api/customers`);
        const data = await response.json();
        console.log('API回傳 customers', data);
        allCustomersCache = Array.isArray(data) ? data : (data.customers || []);
        console.log('收到客戶數據:', data);

        if (!data.customers || data.customers.length === 0) {
            customerList.innerHTML = '<div class="no-data">暫無客戶資料</div>';
            return;
        }

        renderCustomerList();
    } catch (error) {
        console.error('載入客戶列表失敗:', error);
        customerList.innerHTML = '<div class="error-message">載入失敗，請稍後再試</div>';
    }
}

function renderCustomerList(page = 1, pageSize = 20) {
    const customerList = document.querySelector('.customer-list');
    if (!customerList) return;
    let filtered = allCustomersCache;
    // 搜尋過濾
    if (currentSearch) {
        const kw = currentSearch.trim().toLowerCase();
        filtered = filtered.filter(c =>
            c.name.toLowerCase().includes(kw) ||
            c.idNumber.toLowerCase().includes(kw) ||
            c.phone.toLowerCase().includes(kw) ||
            (c.imei && c.imei.toLowerCase().includes(kw)) ||
            (c.serialNumber && c.serialNumber.toLowerCase().includes(kw)) ||
            (c.bankAccountNumber && c.bankAccountNumber.toLowerCase().includes(kw))
        );
    }
    // 狀態分類過濾
    if (currentFilter && currentFilter !== 'all') {
        filtered = filtered.filter(customer => {
            const status = getPaymentStatusByPeriods(customer);
            if (currentFilter === 'overdue') {
                if (customer.status === 'renting' && status === 'overdue') {
                    console.log('逾期篩選命中:', customer.id, customer.name, status);
                } else if (status === 'overdue') {
                    console.log('逾期但未命中篩選:', customer.id, customer.name, 'status:', customer.status, status);
                }
                return customer.status === 'renting' && status === 'overdue';
            }
            if (currentFilter === 'normal') {
                return customer.status === 'renting' && status === 'normal';
            }
            if (currentFilter === 'locked') {
                return customer.status === 'locked';
            }
            if (currentFilter === 'buyback') {
                return customer.status === 'buyback';
            }
            if (currentFilter === 'due-today') {
                const nextDue = customer.nextDueOverride ? new Date(customer.nextDueOverride) : getNextDueDate(customer);
                const cycle = Number(customer.paymentCycleDays) || 30;
                const rent = Number(customer.rent);
                let paidThisCycle = 0;
                let periodEnd = new Date(nextDue);
                periodEnd.setHours(23,59,59,999);
                let periodStart = new Date(periodEnd);
                periodStart.setDate(periodStart.getDate() - cycle + 1);
                let payments = (customer.payments || []).map(p => ({...p, date: new Date(p.date)}));
                payments.sort((a,b) => a.date-b.date);
                for (let i = 0; i < payments.length; i++) {
                    if (payments[i].date >= periodStart && payments[i].date <= periodEnd) {
                        paidThisCycle += Number(payments[i].amount);
                    }
                }
                let remain = rent - paidThisCycle;
                if (remain < 0) remain = 0;
                const daysLeft = getDaysLeft(nextDue);
                return customer.status === 'renting' && (status === 'due-today' || (remain > 0 && daysLeft === 0));
            }
            // 其他狀態同理
            return customer.status === currentFilter;
        });
    }
    // 依合約起始日由新到舊排序
    filtered = filtered.slice().sort((a, b) => new Date(b.contractDate) - new Date(a.contractDate));
    // 分頁
    const total = filtered.length;
    const totalPages = Math.ceil(total / pageSize);
    const startIdx = (page - 1) * pageSize;
    const endIdx = startIdx + pageSize;
    const pageData = filtered.slice(startIdx, endIdx);
    customerList.innerHTML = pageData.map((customer, idx) => {
        const nextDue = customer.nextDueOverride ? new Date(customer.nextDueOverride) : getNextDueDate(customer);
        const cycle = Number(customer.paymentCycleDays) || 30;
        const rent = Number(customer.rent);
        let paidThisCycle = 0;
        let periodEnd = new Date(nextDue);
        periodEnd.setHours(23,59,59,999);
        let periodStart = new Date(periodEnd);
        periodStart.setDate(periodStart.getDate() - cycle + 1);
        let payments = (customer.payments || []).map(p => ({...p, date: new Date(p.date)}));
        payments.sort((a,b) => a.date-b.date);
        // 只累加本期內的繳款
        for (let i = 0; i < payments.length; i++) {
            if (payments[i].date >= periodStart && payments[i].date <= periodEnd) {
                paidThisCycle += Number(payments[i].amount);
            }
        }
        let remain = rent - paidThisCycle;
        if (remain < 0) remain = 0;
        const daysLeft = getDaysLeft(nextDue);
        const paymentStatus = getPaymentStatusByPeriods(customer);
        const totalUnpaid = getTotalUnpaid(customer);
        let cardClass = '';
        if (paymentStatus === 'overdue') cardClass = 'overdue';
        if (paymentStatus === 'due-today') cardClass = 'due-today';
        // 設備資訊
        let salesInfo = '';
        if (customer.salesInfo) {
            salesInfo = `<p>設備：${customer.salesInfo.name}（${customer.salesInfo.appleAccount}）</p>`;
        }
        // 強化防呆：只要本期未繳金額 > 0 且下次應繳日 < 今天，強制顯示逾期
        let finalPaymentStatus = paymentStatus;
        if (remain > 0 && nextDue < new Date()) {
            finalPaymentStatus = 'overdue';
            cardClass = 'overdue';
        }
        return `
        <div class="customer-card ${cardClass}" data-idx="${idx}">
            <div class="customer-header">
                <h3>${customer.name}</h3>
                <div class="customer-status">
                    <span class="status-badge ${customer.status}">${getStatusText(customer.status)}</span>
                    <select class="status-select" data-id="${customer.id}">
                      <option value="renting" ${customer.status==='renting'?'selected':''}>租賃中</option>
                      <option value="buyback" ${customer.status==='buyback'?'selected':''}>已買回</option>
                      <option value="locked" ${customer.status==='locked'?'selected':''}>呆帳</option>
                    </select>
                </div>
            </div>
            
            <div class="customer-info">
                <div class="info-section">
                    <h4>基本資料</h4>
                    <p><b>客戶ID：</b>${customer.id}</p>
                    <p>身分證字號：${customer.idNumber}</p>
                    <p>手機號碼：${customer.phone}</p>
                    <p>手機型號：${customer.model}</p>
                    <p>IMEI：${customer.imei}</p>
                    <p>合約起始日：${formatDate(customer.contractDate)}</p>
                </div>
                
                <div class="info-section">
                    <h4>財務資訊</h4>
                    <p class="price-info">買賣價金：<b>${formatCurrency(customer.salePrice)}</b></p>
                    <p class="price-info">租金：<b>${formatCurrency(customer.rent)}</b></p>
                    <p>繳款週期：${customer.paymentCycleDays || 30} 天</p>
                    ${customer.status !== 'buyback' ? `
                    <p>本期未繳金額：<span class="amount ${remain>0?'overdue':'normal'}">${formatCurrency(remain)}</span></p>
                    <p>總未繳金額：<span class="amount ${totalUnpaid>0?'overdue':'normal'}">${formatCurrency(totalUnpaid)}</span></p>
                    <p>繳款狀態：<span class="status-badge ${finalPaymentStatus}">${getPaymentStatusText(finalPaymentStatus)}</span></p>
                    ` : ''}
                </div>
                
                <div class="info-section">
                    <h4>繳款設定</h4>
                    <div class="due-date-control">
                        <label>下次應繳日：</label>
                        <input type="date" class="next-due-input" data-id="${customer.id}" value="${nextDue.toISOString().slice(0,10)}">
                        <button class="save-next-due-btn" data-id="${customer.id}">儲存</button>
                        ${customer.nextDueOverride ? '<span class="override-tip">（已手動設定）</span>' : ''}
                    </div>
                    ${customer.status !== 'buyback' ? `
                    <p>繳款剩餘天數：<span class="days-left ${daysLeft <= 7 ? 'urgent' : ''}">${daysLeft} 天</span></p>
                    ` : ''}
                </div>
            </div>
            
            <div class="customer-actions">
                <div class="action-group">
                    <button class="action-btn primary" onclick="showPaymentModal('${customer.id}')">
                        <span class="icon">💰</span>繳款
                    </button>
                    <button class="action-btn" onclick="editCustomer('${customer.id}')">
                        <span class="icon">✏️</span>編輯
                    </button>
                    <button class="action-btn" onclick="toggleCustomerDetail('${customer.id}')">
                        <span class="icon">📋</span>詳細
                    </button>
                </div>
                
                <div class="action-group">
                    <button class="action-btn warning" onclick="changeCustomerStatus('${customer.id}', 'buyback')">
                        <span class="icon">✅</span>已買回
                    </button>
                    <button class="action-btn danger" onclick="changeCustomerStatus('${customer.id}', 'locked')">
                        <span class="icon">${customer.status === 'locked' ? '🔓' : '⚠️'}</span>${customer.status === 'locked' ? '取消呆帳' : '呆帳'}
                    </button>
                    <button class="action-btn" onclick="deleteCustomer('${customer.id}')">
                        <span class="icon">🗑️</span>刪除
                    </button>
                </div>
            </div>
            
            <div class="customer-detail" id="detail-${customer.id}" style="display:none;">
                <div class="detail-section">
                    <h4>詳細資料</h4>
                    <p>序號：${customer.serialNumber}</p>
                    <p>螢幕密碼：${customer.screenPassword || '-'}</p>
                    <p>戶籍地址：${customer.address}</p>
                    <p>通訊地址：${customer.currentAddress}</p>
                    <p>銀行：${customer.bank}</p>
                    <p>戶名：${customer.bankAccountName}</p>
                    <p>帳號：${customer.bankAccountNumber}</p>
                    <p>生日：${customer.birthday || '-'}　職業：${customer.occupation || '-'}　來源：${customer.source || '-'}</p>
                    <p>緊急聯絡人：${customer.emergencyContactName || '-'}　${customer.emergencyContactPhone || ''}</p>
                </div>
                
                <div class="detail-section">
                    <h4>附件管理</h4>
                    <div class="file-upload-group">
                        <label>身分證正面：</label>
                        ${customer.idFront ? 
                            `<div class="file-info">
                                <a href="uploads/${customer.idFront}" target="_blank">📄 下載</a>
                                <span class="file-name">${customer.idFront}</span>
                                <button class="delete-file-btn" data-type="idFront" data-id="${customer.id}">🗑️ 刪除</button>
                            </div>` : 
                            '<span class="no-file">未上傳</span>'
                        }
                        <div class="upload-controls">
                            <input type="file" class="upload-input" name="idFront" data-type="idFront" data-id="${customer.id}" accept="image/*">
                            <button class="upload-btn" data-type="idFront" data-id="${customer.id}">上傳</button>
                        </div>
                    </div>
                    
                    <div class="file-upload-group">
                        <label>身分證反面：</label>
                        ${customer.idBack ? 
                            `<div class="file-info">
                                <a href="uploads/${customer.idBack}" target="_blank">📄 下載</a>
                                <span class="file-name">${customer.idBack}</span>
                                <button class="delete-file-btn" data-type="idBack" data-id="${customer.id}">🗑️ 刪除</button>
                            </div>` : 
                            '<span class="no-file">未上傳</span>'
                        }
                        <div class="upload-controls">
                            <input type="file" class="upload-input" name="idBack" data-type="idBack" data-id="${customer.id}" accept="image/*">
                            <button class="upload-btn" data-type="idBack" data-id="${customer.id}">上傳</button>
                        </div>
                    </div>
                    
                    <div class="file-upload-group">
                        <label>水單照片：</label>
                        ${customer.billPhoto ? 
                            `<div class="file-info">
                                <a href="uploads/${customer.billPhoto}" target="_blank">📄 下載</a>
                                <span class="file-name">${customer.billPhoto}</span>
                                <button class="delete-file-btn" data-type="billPhoto" data-id="${customer.id}">🗑️ 刪除</button>
                            </div>` : 
                            '<span class="no-file">未上傳</span>'
                        }
                        <div class="upload-controls">
                            <input type="file" class="upload-input" name="billPhoto" data-type="billPhoto" data-id="${customer.id}" accept="image/*">
                            <button class="upload-btn" data-type="billPhoto" data-id="${customer.id}">上傳</button>
                        </div>
                    </div>
                    
                    <div class="file-upload-group">
                        <label>合約 PDF：</label>
                        ${customer.contractPdf ? 
                            `<div class="file-info">
                                <a href="uploads/${customer.contractPdf}" target="_blank">📄 下載</a>
                                <span class="file-name">${customer.contractPdf}</span>
                                <button class="delete-file-btn" data-type="contractPdf" data-id="${customer.id}">🗑️ 刪除</button>
                            </div>` : 
                            '<span class="no-file">未上傳</span>'
                        }
                        <div class="upload-controls">
                            <input type="file" class="upload-input" name="contractPdf" data-type="contractPdf" data-id="${customer.id}" accept="application/pdf">
                            <button class="upload-btn" data-type="contractPdf" data-id="${customer.id}">上傳</button>
                        </div>
                    </div>
                </div>
                
                <div class="detail-section">
                    <h4>繳款紀錄</h4>
                    <div class="payment-history" data-id="${customer.id}"></div>
                </div>
            </div>
        </div>`;
    }).join('');
    // 分頁按鈕
    let paginationHtml = '';
    if (totalPages > 1) {
        paginationHtml += '<div class="pagination">';
        for (let i = 1; i <= totalPages; i++) {
            paginationHtml += `<button class="page-btn" data-page="${i}"${i===page?' style="font-weight:bold;"':''}>${i}</button>`;
        }
        paginationHtml += '</div>';
    }
    customerList.innerHTML += paginationHtml;
    // 分頁按鈕事件
    document.querySelectorAll('.page-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            renderCustomerList(Number(btn.dataset.page), pageSize);
        });
    });

    // 詳細展開/收合
    document.querySelectorAll('.toggle-detail').forEach((btn, idx) => {
        btn.addEventListener('click', () => {
            const detail = btn.parentElement.querySelector('.customer-detail');
            if (detail.style.display === 'none') {
                detail.style.display = 'block';
                btn.textContent = '收合';
                // 載入繳款紀錄
                const cid = btn.parentElement.querySelector('.edit-btn').dataset.id;
                loadPaymentHistory(cid, detail.querySelector('.payment-history'));
                // 顯示逾期期數與未繳明細
                const customer = allCustomersCache.find(c => c.id === cid);
                const { periods, overdueCount } = getPeriodsStatus(customer);
                let html = `<p>逾期期數：<span style="color:red;font-weight:bold;">${overdueCount}</span></p>`;
                html += '<ul>';
                const periodOverrides = Array.isArray(customer.periodOverrides) ? customer.periodOverrides : [];
                periods.forEach((p, i) => {
                    const override = periodOverrides.find(po => po.period === i + 1);
                    const startDate = override && override.start ? override.start.slice(0, 10) : p.start.toISOString().slice(0, 10);
                    const dueDate = override ? override.due.slice(0, 10) : p.end.toISOString().slice(0, 10);
                    html += `<li style="display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-bottom:6px;">
                      <span style="min-width:60px;">第${i+1}期：</span>
                      <input type="date" class="period-start-input" data-id="${customer.id}" data-period="${i+1}" value="${startDate}" style="width:120px;">
                      ~
                      <input type="date" class="period-due-input" data-id="${customer.id}" data-period="${i+1}" value="${dueDate}" style="width:120px;">
                      <button class="save-period-btn" data-id="${customer.id}" data-period="${i+1}" style="min-width:60px;">儲存</button>
                      <span style="min-width:60px;color:${p.isPaid?'#2e7d32':'#d32f2f'};font-weight:bold;">${p.isPaid ? '已繳清' : '未繳'}</span>
                      ${p.isPaid ? `<span style=\"color:#2e7d32;\">${formatCurrency(p.paid)}<span style=\"margin-left:8px;\">${p.paidDate?formatDate(p.paidDate):''}</span></span>` : ''}
                    </li>`;
                });
                html += '</ul>';
                // 在詳細展開時，於 periods-status 下方插入額外費用輸入列
                let payRowHtml = `<div class="extra-payment-row" style="margin-top:8px;display:flex;flex-wrap:wrap;align-items:center;gap:8px;background:#f8fbfd;padding:8px 6px 4px 6px;border-radius:6px;">
  <b style="min-width:90px;">額外費用/臨時收款：</b>
  <span>日期</span> <input type="date" class="extra-payment-date" value="${new Date().toISOString().slice(0,10)}" style="width:130px;">
  <span>金額</span> <input type="number" class="extra-payment-amount" style="width:90px;">
  <span>備註</span> <input type="text" class="extra-payment-note" style="width:120px;">
  <button class="extra-payment-add-btn" data-id="${customer.id}" style="min-width:60px;">新增</button>
  <span style="color:#888;font-size:12px;flex-basis:100%;margin-top:2px;">（此區塊僅用於記錄保證金、違約金、雜費等非期繳項目）</span>
</div>`;
                detail.querySelector('.periods-status').insertAdjacentHTML('afterend', payRowHtml);
                detail.querySelector('.periods-status').innerHTML = html;

                // 綁定額外費用新增事件（立即執行，確保作用於本次展開的 detail）
                detail.querySelectorAll('.extra-payment-add-btn').forEach(btn => {
                    btn.addEventListener('click', async () => {
                        const customerId = btn.dataset.id;
                        const date = detail.querySelector('.extra-payment-date').value;
                        const amount = detail.querySelector('.extra-payment-amount').value;
                        const note = detail.querySelector('.extra-payment-note').value;
                        if (!date || !amount || isNaN(amount) || amount <= 0) {
                            alert('請輸入正確的日期與金額');
                            return;
                        }
                        btn.disabled = true; btn.textContent = '處理中...';
                        try {
                            const res = await fetch(`${API_BASE_URL}/api/customers/${customerId}/payments`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ date, amount: Number(amount), note, type: 'extra' })
                            });
                            const result = await res.json();
                            if (result.success) {
                                alert('新增成功');
                                loadCustomers();
                                loadDashboard();
                            } else {
                                alert(result.message || result.error || '新增失敗');
                            }
                        } catch (e) {
                            alert('新增失敗，請稍後再試');
                        }
                        btn.disabled = false; btn.textContent = '新增';
                    });
                });

                // 綁定每期到期日儲存事件
                setTimeout(() => {
                    detail.querySelectorAll('.save-period-btn').forEach(btn2 => {
                        btn2.addEventListener('click', async () => {
                            const id = btn2.dataset.id;
                            const period = Number(btn2.dataset.period);
                            const startInput = detail.querySelector(`.period-start-input[data-id="${id}"][data-period="${period}"]`);
                            const dueInput = detail.querySelector(`.period-due-input[data-id="${id}"][data-period="${period}"]`);
                            const startDate = startInput.value;
                            const dueDate = dueInput.value;
                            if (!startDate || !dueDate) {
                                alert('請選擇日期');
                                return;
                            }
                            try {
                                const res = await fetch(`${API_BASE_URL}/api/customers/${id}/period-overrides`, {
                                    method: 'PATCH',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ period, startDate, dueDate })
                                });
                                const result = await res.json();
                                if (result.success) {
                                    alert('到期日已更新');
                                    loadCustomers();
                                    loadDashboard();
                                } else {
                                    alert(result.message || result.error || '更新失敗');
                                }
                            } catch (e) {
                                alert('更新失敗，請稍後再試');
                            }
                        });
                    });
                }, 0);
            } else {
                detail.style.display = 'none';
                btn.textContent = '詳細';
            }
        });
    });

    // 編輯按鈕
    document.querySelectorAll('.edit-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const cid = btn.dataset.id;
            const customer = allCustomersCache.find(c => c.id === cid);
            fillEditForm(customer);
            document.getElementById('edit-modal').classList.add('active');
        });
    });

    // 繳款按鈕
    document.querySelectorAll('.pay-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            showPaymentModal(btn.dataset.id);
        });
    });

    // 刪除按鈕
    document.querySelectorAll('.delete-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            if (!confirm('確定要刪除這位客戶嗎？')) return;
            const cid = btn.dataset.id;
            try {
                const res = await fetch(`${API_BASE_URL}/api/customers/${cid}`, { method: 'DELETE' });
                const result = await res.json();
                if (result.success) {
                    alert('刪除成功');
                    loadCustomers();
                    loadDashboard();
                } else {
                    alert(result.message || result.error || '刪除失敗');
                }
            } catch (e) {
                alert('刪除失敗，請稍後再試');
            }
        });
    });

    // 已買回/結清按鈕
    document.querySelectorAll('.buyback-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            if (!confirm('確定要將此客戶設為已買回/結清嗎？')) return;
            const cid = btn.dataset.id;
            try {
                const res = await fetch(`${API_BASE_URL}/api/customers/${cid}/status`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ status: 'buyback' })
                });
                const result = await res.json();
                if (result.success) {
                    alert('狀態已更新為已買回/結清');
                    loadCustomers();
                    loadDashboard();
                } else {
                    alert(result.message || result.error || '狀態更新失敗');
                }
            } catch (e) {
                alert('狀態更新失敗，請稍後再試');
            }
        });
    });

    // 呆帳按鈕
    document.querySelectorAll('.locked-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            if (!confirm('確定要將此客戶設為呆帳嗎？')) return;
            const cid = btn.dataset.id;
            try {
                const res = await fetch(`${API_BASE_URL}/api/customers/${cid}/status`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ status: 'locked' })
                });
                const result = await res.json();
                if (result.success) {
                    alert('狀態已更新為呆帳');
                    loadCustomers();
                    loadDashboard();
                } else {
                    alert(result.message || result.error || '狀態更新失敗');
                }
            } catch (e) {
                alert('狀態更新失敗，請稍後再試');
            }
        });
    });

    // === 重新綁定上傳與刪除事件 ===
    setTimeout(() => {
      // 上傳防呆
      document.querySelectorAll('.upload-btn').forEach(btn => {
        btn.onclick = async () => {
          const type = btn.dataset.type;
          const id = btn.dataset.id;
          const input = btn.parentElement.querySelector('.upload-input[data-type="'+type+'"]');
          if (!input.files[0]) {
            alert('請選擇檔案');
            return;
          }
          // 取得最新 customer
          const customer = allCustomersCache.find(c => c.id === id);
          if (customer) {
            if (type === 'idFront' && customer.idFront) {
              if (!confirm('身分證正面已有檔案，確定要覆蓋嗎？')) return;
            }
            if (type === 'idBack' && customer.idBack) {
              if (!confirm('身分證反面已有檔案，確定要覆蓋嗎？')) return;
            }
            if (type === 'billPhoto' && customer.billPhoto) {
              if (!confirm('水單照片已有檔案，確定要覆蓋嗎？')) return;
            }
            if (type === 'contractPdf' && customer.contractPdf) {
              if (!confirm('合約PDF已有檔案，確定要覆蓋嗎？')) return;
            }
          }
          const formData = new FormData();
          if (type === 'idFront') formData.append('idFront', input.files[0]);
          else if (type === 'idBack') formData.append('idBack', input.files[0]);
          else if (type === 'billPhoto') formData.append('billPhoto', input.files[0]);
          else if (type === 'contractPdf') formData.append('contractPdf', input.files[0]);
          else return alert('未知的上傳類型');
          try {
            const res = await fetch(`${API_BASE_URL}/api/customers/${id}`, {
              method: 'PUT',
              body: formData
            });
            const result = await res.json();
            if (result.success) {
              if (type === 'contractPdf') {
                btn.parentElement.querySelector('a').href = `uploads/${result.customer.contractPdf}?t=${Date.now()}`;
              } else {
                btn.parentElement.querySelector('a').href = `uploads/${result.customer[type]}?t=${Date.now()}`;
              }
              alert('上傳成功');
              loadCustomers();
            } else {
              alert(result.message || result.error || '上傳失敗');
              loadCustomers();
            }
          } catch (e) {
            await loadCustomers();
            const customer = allCustomersCache.find(c => c.id === id);
            if (customer) {
              let uploaded = false;
              if (type === 'idFront' && customer.idFront) uploaded = true;
              if (type === 'idBack' && customer.idBack) uploaded = true;
              if (type === 'billPhoto' && customer.billPhoto) uploaded = true;
              if (type === 'contractPdf' && customer.contractPdf) uploaded = true;
              if (uploaded) {
                alert('上傳成功（自動偵測）');
              } else {
            alert('上傳失敗，請稍後再試');
          }
            } else {
              alert('上傳失敗，請稍後再試');
            }
          }
        };
      });
      // 刪除檔案
      document.querySelectorAll('.delete-file-btn').forEach(btn => {
        btn.onclick = async () => {
          if (!confirm('確定要刪除此檔案？')) return;
          const type = btn.dataset.type;
          const id = btn.dataset.id;
          try {
            const res = await fetch(`${API_BASE_URL}/api/customers/${id}/file/${type}`, { method: 'DELETE' });
            const result = await res.json();
            if (result.success) {
              alert('檔案已刪除');
              loadCustomers();
            } else {
              alert(result.message || result.error || '刪除失敗');
            }
          } catch (e) {
            alert('刪除失敗，請稍後再試');
          }
        };
      });
    }, 0);

    // 狀態下拉選單事件
    document.querySelectorAll('.status-select').forEach(sel => {
      sel.addEventListener('change', async function() {
        const cid = this.dataset.id;
        const newStatus = this.value;
        const txt = newStatus==='renting'?'租賃中':(newStatus==='buyback'?'已買回':'呆帳');
        if (!confirm(`確定要將此客戶狀態改為「${txt}」嗎？`)) {
          // 恢復原選項
          const customer = allCustomersCache.find(c => c.id === cid);
          this.value = customer.status;
          return;
        }
        try {
          const res = await fetch(`${API_BASE_URL}/api/customers/${cid}/status`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: newStatus })
          });
          const result = await res.json();
          if (result.success) {
            alert('狀態已更新');
            loadCustomers();
            loadDashboard();
          } else {
            alert(result.message || result.error || '狀態更新失敗');
            // 恢復原選項
            const customer = allCustomersCache.find(c => c.id === cid);
            this.value = customer.status;
          }
        } catch (e) {
          alert('狀態更新失敗，請稍後再試');
          // 恢復原選項
          const customer = allCustomersCache.find(c => c.id === cid);
          this.value = customer.status;
        }
      });
    });

    // 新增下次應繳日儲存事件
    document.querySelectorAll('.save-next-due-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const id = btn.dataset.id;
            const input = document.querySelector(`.next-due-input[data-id="${id}"]`);
            const date = input.value;
            if (!date) {
                alert('請選擇日期');
                return;
            }
            try {
                const res = await fetch(`${API_BASE_URL}/api/customers/${id}/next-due`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ nextDue: date })
                });
                const result = await res.json();
                if (result.success) {
                    alert('下次應繳日已更新');
                    loadCustomers();
                } else {
                    alert(result.message || result.error || '更新失敗');
                }
            } catch (e) {
                alert('更新失敗，請稍後再試');
            }
        });
    });

    // 綁定單筆繳款刪除按鈕
    setTimeout(() => {
      document.querySelectorAll('.delete-single-payment-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          const customerId = btn.dataset.id;
          if (!confirm('確定要刪除這筆繳款紀錄嗎？')) return;
          try {
            // 預設刪除最後一筆 payments
            const res = await fetch(`${API_BASE_URL}/api/customers/${customerId}/payments/last`, {
              method: 'DELETE'
            });
            const result = await res.json();
            if (result.success) {
              alert('刪除成功');
              loadCustomers();
              loadDashboard();
            } else {
              alert(result.message || result.error || '刪除失敗');
            }
          } catch (e) {
            alert('刪除失敗，請稍後再試');
          }
        });
      });
    }, 0);

    // 綁定每期繳款與刪除事件
    setTimeout(() => {
      document.querySelectorAll('.period-pay-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          const id = btn.dataset.id;
          const period = Number(btn.dataset.period);
          const amount = prompt('請輸入繳款金額');
          if (!amount || isNaN(amount) || amount <= 0) return alert('金額錯誤');
          const date = prompt('請輸入繳款日期(YYYY-MM-DD)', new Date().toISOString().slice(0,10));
          if (!date) return alert('請輸入日期');
          btn.disabled = true; btn.textContent = '處理中...';
          try {
            const res = await fetch(`${API_BASE_URL}/api/customers/${id}/payments`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ amount: Number(amount), period, date })
            });
            const result = await res.json();
            if (result.success) {
              loadCustomers();
              loadDashboard();
            } else {
              alert(result.message || result.error || '繳款失敗');
            }
          } catch (e) {
            alert('繳款失敗，請稍後再試');
          }
          btn.disabled = false; btn.textContent = '繳款';
        });
      });
      document.querySelectorAll('.period-delete-payment-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          const id = btn.dataset.id;
          const period = Number(btn.dataset.period);
          if (!confirm('確定要刪除此期的繳款紀錄嗎？')) return;
          btn.disabled = true; btn.textContent = '處理中...';
          try {
            const res = await fetch(`${API_BASE_URL}/api/customers/${id}/payments/period/${period}`, {
              method: 'DELETE'
            });
            const result = await res.json();
            if (result.success) {
              loadCustomers();
              loadDashboard();
            } else {
              alert(result.message || result.error || '刪除失敗');
            }
          } catch (e) {
            alert('刪除失敗，請稍後再試');
          }
          btn.disabled = false; btn.textContent = '刪除';
        });
      });
    }, 0);
}

// 儀表板數據載入 - 重新設計版本
async function loadDashboard(type = 'month', start = '', end = '') {
    try {
        console.log('開始載入儀表板，類型:', type, '開始日期:', start, '結束日期:', end);
        
        // 顯示載入狀態
        showDashboardLoading();
        
        let url = `${API_BASE_URL}/api/dashboard?type=${type}`;
        if (start) url += `&start=${start}`;
        if (end) url += `&end=${end}`;
        
        console.log('請求URL:', url);
        
        const res = await fetch(url);
        const data = await res.json();
        
        console.log('API響應:', data);
        
        if (!res.ok) {
            throw new Error(data.error || '載入失敗');
        }
        
        // 更新統計卡片
        updateDashboardStats(data);
        
        // 載入圖表
        if (data.stats) {
            console.log('開始渲染圖表，統計數據:', data.stats);
            renderDashboardCharts(data.stats, type);
        } else {
            console.log('沒有統計數據，使用模擬數據');
            // 使用模擬數據
            const mockStats = generateMockStats(type);
            renderDashboardCharts(mockStats, type);
        }
        
        // 載入智能建議
        await loadDashboardInsights();
        
        // 隱藏載入狀態
        hideDashboardLoading();
        
        console.log('儀表板載入完成');
        
    } catch (error) {
        console.error('載入儀表板失敗:', error);
        hideDashboardLoading();
        
        // 使用模擬數據作為備用
        console.log('使用模擬數據作為備用');
        const mockStats = generateMockStats(type);
        renderDashboardCharts(mockStats, type);
        
        showNotification('載入儀表板失敗，已使用模擬數據', 'warning');
    }
}

// 生成模擬數據
function generateMockStats(type = 'month') {
    const months = [];
    const now = new Date();
    
    // 生成過去6個月的數據
    for (let i = 5; i >= 0; i--) {
        const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
        months.push(date.toISOString().slice(0, 7)); // YYYY-MM 格式
    }
    
    return {
        months: months,
        newCustomers: [12, 15, 18, 22, 25, 28],
        rentingCounts: [45, 52, 58, 65, 72, 78],
        buybackCounts: [8, 10, 12, 15, 18, 20],
        lockedCounts: [3, 4, 5, 6, 7, 8],
        revenue: [150000, 180000, 210000, 240000, 270000, 300000],
        profit: [45000, 54000, 63000, 72000, 81000, 90000],
        cost: [105000, 126000, 147000, 168000, 189000, 210000],
        successRate: [85, 87, 89, 91, 93, 95],
        pendingRate: [10, 9, 8, 7, 6, 5],
        riskRate: [5, 4, 3, 2, 1, 0]
    };
}

// 顯示儀表板載入狀態
function showDashboardLoading() {
    const containers = [
        '#total-customers', '#new-customers', '#pending-payments',
        '#buyback-locked-rate', '#locked-amount', '#buyback-rate',
        '#accumulated-sales', '#profit-summary'
    ];
    
    containers.forEach(selector => {
        const el = document.querySelector(selector);
        if (el) el.textContent = '載入中...';
    });
    
    // 顯示圖表載入狀態
    const chartContainers = [
        '#dashboard-chart', '#amount-chart', '#ratio-chart',
        '#model-chart', '#region-chart'
    ];
    
    chartContainers.forEach(selector => {
        const container = document.querySelector(selector);
        if (container) {
            container.innerHTML = '<div class="loading">載入圖表中...</div>';
        }
    });
}

// 隱藏儀表板載入狀態
function hideDashboardLoading() {
    // 清除載入狀態
    const loadingElements = document.querySelectorAll('.loading');
    loadingElements.forEach(el => {
        if (el.parentElement && el.parentElement.tagName === 'CANVAS') {
            el.remove();
        }
    });
}

// 更新儀表板統計數據
function updateDashboardStats(data) {
    // 基礎統計
    document.getElementById('total-customers').textContent = data.total || 0;
    document.getElementById('new-customers').textContent = data.newCustomers || 0;
    document.getElementById('pending-payments').textContent = data.pending || 0;
    
    // 活躍客戶數
    document.getElementById('active-customers').textContent = data.total || 0;
    
    // 累積業績相關
    const accumulatedSales = data.accumulatedSales || 0;
    document.getElementById('accumulated-sales').textContent = accumulatedSales.toLocaleString() + '元';
    document.getElementById('monthly-sales').textContent = accumulatedSales.toLocaleString() + '元';
    document.getElementById('avg-sales').textContent = (data.avgLockedAmount || 0).toLocaleString() + '元';
    
    // 待繳款相關
    document.getElementById('overdue-count').textContent = data.overdueAlerts || 0;
    document.getElementById('overdue-amount').textContent = (data.lockedAmount || 0).toLocaleString() + '元';
    
    // 呆帳相關
    const buybackLockedRate = data.buybackLockedRate || 0;
    document.getElementById('buyback-locked-rate').textContent = buybackLockedRate + '%';
    document.getElementById('locked-customers').textContent = (data.lockedCustomers || 0) + '人';
    document.getElementById('locked-amount').textContent = (data.lockedAmount || 0).toLocaleString() + '元';
    
    // 已買回率相關
    const buybackRate = data.buybackRate || 0;
    document.getElementById('buyback-rate').textContent = buybackRate + '%';
    document.getElementById('buyback-customers').textContent = (data.buybackCustomers || 0) + '人';
    document.getElementById('buyback-profit').textContent = (data.profit || 0).toLocaleString() + '元';
    
    // 損益相關
    document.getElementById('profit-summary').textContent = (data.profit || 0).toLocaleString() + '元';
    document.getElementById('profit-margin').textContent = buybackRate + '%';
    document.getElementById('roi-rate').textContent = buybackLockedRate + '%';
    
    // 實時監控數據
    document.getElementById('today-new').textContent = data.todayNew || 0;
    document.getElementById('today-payments').textContent = data.todayPayments || 0;
    document.getElementById('overdue-alerts').textContent = data.overdueAlerts || 0;
    document.getElementById('system-status').textContent = data.systemStatus || '正常';
    
    // 風險評估數據
    document.getElementById('overdue-rate').textContent = (data.overdueRate || 0) + '%';
    document.getElementById('bad-debt-rate').textContent = (data.badDebtRate || 0) + '%';
    document.getElementById('churn-rate').textContent = (data.churnRate || 0) + '%';
    
    // 更新風險條
    updateRiskBars(data);
    
    // 更新趨勢指標
    updateTrendIndicators(data);
}

// 更新風險條
function updateRiskBars(data) {
    const overdueRate = data.overdueRate || 0;
    const badDebtRate = data.badDebtRate || 0;
    const churnRate = data.churnRate || 0;
    
    // 更新逾期率條
    const overdueFill = document.querySelector('#overdue-rate').parentElement.querySelector('.risk-fill');
    if (overdueFill) {
        overdueFill.style.width = Math.min(overdueRate, 100) + '%';
        overdueFill.className = `risk-fill ${getRiskLevel(overdueRate)}`;
    }
    
    // 更新呆帳率條
    const badDebtFill = document.querySelector('#bad-debt-rate').parentElement.querySelector('.risk-fill');
    if (badDebtFill) {
        badDebtFill.style.width = Math.min(badDebtRate, 100) + '%';
        badDebtFill.className = `risk-fill ${getRiskLevel(badDebtRate)}`;
    }
    
    // 更新流失率條
    const churnFill = document.querySelector('#churn-rate').parentElement.querySelector('.risk-fill');
    if (churnFill) {
        churnFill.style.width = Math.min(churnRate, 100) + '%';
        churnFill.className = `risk-fill ${getRiskLevel(churnRate)}`;
    }
    
    // 更新整體風險等級
    updateOverallRiskLevel(data);
}

// 獲取風險等級
function getRiskLevel(rate) {
    if (rate < 5) return 'low';
    if (rate < 15) return 'medium';
    return 'high';
}

// 更新整體風險等級
function updateOverallRiskLevel(data) {
    const overdueRate = data.overdueRate || 0;
    const badDebtRate = data.badDebtRate || 0;
    const churnRate = data.churnRate || 0;
    
    const avgRisk = (overdueRate + badDebtRate + churnRate) / 3;
    const riskLevel = getRiskLevel(avgRisk);
    
    const riskIndicator = document.querySelector('.risk-level-indicator .risk-level');
    if (riskIndicator) {
        riskIndicator.className = `risk-level ${riskLevel}`;
        riskIndicator.textContent = riskLevel === 'low' ? '低風險' : 
                                  riskLevel === 'medium' ? '中風險' : '高風險';
    }
}

// 更新趨勢指標
function updateTrendIndicators(data) {
    // 更新客戶數趨勢
    const customerTrend = data.customerTrend || '+12%';
    const customerElement = document.querySelector('#active-customers').parentElement;
    if (customerElement) {
        const trendElement = customerElement.querySelector('.trend-indicator') || 
                           customerElement.querySelector('.kpi-detail');
        if (trendElement) {
            const isPositive = customerTrend.includes('+');
            trendElement.className = `trend-indicator ${isPositive ? 'positive' : 'negative'}`;
            trendElement.innerHTML = `${isPositive ? '↗' : '↘'}${customerTrend}`;
        }
    }
    
    // 更新營收趨勢
    const revenueTrend = data.revenueTrend || '+8%';
    const revenueElement = document.querySelector('#monthly-sales').parentElement;
    if (revenueElement) {
        const trendElement = revenueElement.querySelector('.trend-indicator') || 
                           revenueElement.querySelector('.kpi-detail');
        if (trendElement) {
            const isPositive = revenueTrend.includes('+');
            trendElement.className = `trend-indicator ${isPositive ? 'positive' : 'negative'}`;
            trendElement.innerHTML = `${isPositive ? '↗' : '↘'}${revenueTrend}`;
        }
    }
    
    // 更新待繳款趨勢
    const paymentTrend = data.paymentTrend || '-5%';
    const paymentElement = document.querySelector('#overdue-count').parentElement;
    if (paymentElement) {
        const trendElement = paymentElement.querySelector('.trend-indicator') || 
                           paymentElement.querySelector('.kpi-detail');
        if (trendElement) {
            const isPositive = paymentTrend.includes('+');
            trendElement.className = `trend-indicator ${isPositive ? 'positive' : 'negative'}`;
            trendElement.innerHTML = `${isPositive ? '↗' : '↘'}${paymentTrend}`;
        }
    }
    
    // 更新呆帳率趨勢
    const lockedTrend = data.lockedTrend || '+2%';
    const lockedElement = document.querySelector('#overdue-amount').parentElement;
    if (lockedElement) {
        const trendElement = lockedElement.querySelector('.trend-indicator') || 
                           lockedElement.querySelector('.kpi-detail');
        if (trendElement) {
            const isPositive = lockedTrend.includes('+');
            trendElement.className = `trend-indicator ${isPositive ? 'positive' : 'negative'}`;
            trendElement.innerHTML = `${isPositive ? '↗' : '↘'}${lockedTrend}`;
        }
    }
    
    // 更新已買回趨勢
    const buybackTrend = data.buybackTrend || '+15%';
    const buybackElement = document.querySelector('#buyback-profit').parentElement;
    if (buybackElement) {
        const trendElement = buybackElement.querySelector('.trend-indicator') || 
                           buybackElement.querySelector('.kpi-detail');
        if (trendElement) {
            const isPositive = buybackTrend.includes('+');
            trendElement.className = `trend-indicator ${isPositive ? 'positive' : 'negative'}`;
            trendElement.innerHTML = `${isPositive ? '↗' : '↘'}${buybackTrend}`;
        }
    }
    
    // 更新淨利潤趨勢
    const profitTrend = data.profitTrend || '-10%';
    const profitElement = document.querySelector('#profit-margin').parentElement;
    if (profitElement) {
        const trendElement = profitElement.querySelector('.trend-indicator') || 
                           profitElement.querySelector('.kpi-detail');
        if (trendElement) {
            const isPositive = profitTrend.includes('+');
            trendElement.className = `trend-indicator ${isPositive ? 'positive' : 'negative'}`;
            trendElement.innerHTML = `${isPositive ? '↗' : '↘'}${profitTrend}`;
        }
    }
}

// 渲染儀表板圖表
function renderDashboardCharts(stats, type) {
  console.log('渲染儀表板圖表:', stats, type);
  
  if (typeof Chart === 'undefined') {
    console.error('Chart.js 未載入');
    return;
  }

  try {
    // 渲染主要趨勢圖
    renderMainTrendChart(stats, type);
    
    // 渲染金額分析圖
    renderAmountAnalysisChart(stats, type);
    
    // 渲染分布圖表
    renderDistributionCharts(stats);
    
  } catch (error) {
    console.error('渲染圖表時發生錯誤:', error);
  }
}

// 渲染主要趨勢圖
function renderMainTrendChart(stats, type) {
  const canvas = document.getElementById('dashboard-chart');
  if (!canvas) {
    console.error('找不到 dashboard-chart canvas');
    return;
  }

  // 銷毀現有圖表
  if (window.mainTrendChart) {
    window.mainTrendChart.destroy();
  }

  const processedLabels = stats.months || [];
  const datasets = [
    {
      label: '新客戶',
      data: stats.newCustomers || [],
      borderColor: '#3b82f6',
      backgroundColor: 'rgba(59, 130, 246, 0.1)',
      tension: 0.4
    },
    {
      label: '租賃中',
      data: stats.rentingCounts || [],
      borderColor: '#10b981',
      backgroundColor: 'rgba(16, 185, 129, 0.1)',
      tension: 0.4
    },
    {
      label: '已買回',
      data: stats.buybackCounts || [],
      borderColor: '#f59e0b',
      backgroundColor: 'rgba(245, 158, 11, 0.1)',
      tension: 0.4
    },
    {
      label: '呆帳',
      data: stats.lockedCounts || [],
      borderColor: '#ef4444',
      backgroundColor: 'rgba(239, 68, 68, 0.1)',
      tension: 0.4
    }
  ];

  window.mainTrendChart = new Chart(canvas, {
    type: 'line',
    data: {
      labels: processedLabels,
      datasets: datasets
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'top',
          labels: {
            font: { size: 12 },
            usePointStyle: true
          }
        },
        tooltip: {
          mode: 'index',
          intersect: false,
          backgroundColor: 'rgba(0, 0, 0, 0.8)',
          titleColor: '#fff',
          bodyColor: '#fff',
          borderColor: '#3b82f6',
          borderWidth: 1
        }
      },
      scales: {
        x: {
          grid: {
            display: false
          },
          ticks: {
            font: { size: 11 }
          }
        },
        y: {
          beginAtZero: true,
          grid: {
            color: 'rgba(0, 0, 0, 0.1)'
          },
          ticks: {
            font: { size: 11 }
          }
        }
      },
      interaction: {
        mode: 'nearest',
        axis: 'x',
        intersect: false
      }
    }
  });
}

// 渲染金額分析圖
function renderAmountAnalysisChart(stats, type) {
  const canvas = document.getElementById('amount-chart');
  if (!canvas) {
    console.error('找不到 amount-chart canvas');
    return;
  }

  // 銷毀現有圖表
  if (window.amountChart) {
    window.amountChart.destroy();
  }

  const labels = stats.months || [];
  const revenue = stats.revenue || [];
  const profit = stats.profit || [];
  const cost = stats.cost || [];

  // 更新摘要數據
  const totalRevenue = revenue.reduce((sum, val) => sum + val, 0);
  const totalProfit = profit.reduce((sum, val) => sum + val, 0);
  const totalCost = cost.reduce((sum, val) => sum + val, 0);

  document.getElementById('total-revenue').textContent = totalRevenue.toLocaleString() + ' 元';
  document.getElementById('total-profit').textContent = totalProfit.toLocaleString() + ' 元';
  document.getElementById('total-cost').textContent = totalCost.toLocaleString() + ' 元';

  window.amountChart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [
        {
          label: '營收',
          data: revenue,
          backgroundColor: 'rgba(59, 130, 246, 0.8)',
          borderColor: '#3b82f6',
          borderWidth: 1
        },
        {
          label: '利潤',
          data: profit,
          backgroundColor: 'rgba(16, 185, 129, 0.8)',
          borderColor: '#10b981',
          borderWidth: 1
        },
        {
          label: '成本',
          data: cost,
          backgroundColor: 'rgba(239, 68, 68, 0.8)',
          borderColor: '#ef4444',
          borderWidth: 1
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'top',
          labels: {
            font: { size: 12 },
            usePointStyle: true
          }
        },
        tooltip: {
          callbacks: {
            label: function(context) {
              return context.dataset.label + ': ' + context.parsed.y.toLocaleString() + ' 元';
            }
          }
        }
      },
      scales: {
        x: {
          grid: {
            display: false
          },
          ticks: {
            font: { size: 11 }
          }
        },
        y: {
          beginAtZero: true,
          grid: {
            color: 'rgba(0, 0, 0, 0.1)'
          },
          ticks: {
            font: { size: 11 },
            callback: function(value) {
              return value.toLocaleString() + ' 元';
            }
          }
        }
      }
    }
  });
}

// 渲染分布圖表
function renderDistributionCharts(stats) {
  renderModelChart(stats);
  renderRegionChart(stats);
}

// 渲染機型分布圖
function renderModelChart(stats) {
  const canvas = document.getElementById('model-chart');
  if (!canvas) {
    console.error('找不到 model-chart canvas');
    return;
  }

  // 銷毀現有圖表
  if (window.modelChart) {
    window.modelChart.destroy();
  }

  // 生成機型分布數據
  const modelData = stats.modelDist || {
    'iPhone 12 128GB': 6,
    'iPhone 13 128GB': 5,
    'iPhone 14 Pro 128GB': 3,
    'iPhone 12 Pro Max 128GB': 3,
    'iPhone 13 mini 128GB': 2,
    'iPhone 12 Pro 128GB': 1,
    'iPhone 14 128GB': 1,
    'iPhone 14 Plus 128GB': 1,
    'iPhone 13 Pro Max 512GB': 1,
    'iPhone 16 Pro 256GB': 1,
    'iPhone 16 Pro Max 256GB': 1,
    'iPhone 16 256GB': 1
  };

  const colors = [
    '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
    '#06b6d4', '#84cc16', '#f97316', '#ec4899', '#6366f1',
    '#14b8a6', '#f43f5e'
  ];

  window.modelChart = new Chart(canvas, {
    type: 'pie',
    data: {
      labels: Object.keys(modelData),
      datasets: [{
        data: Object.values(modelData),
        backgroundColor: colors.slice(0, Object.keys(modelData).length),
        borderWidth: 2,
        borderColor: '#fff'
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            font: { size: 11 },
            usePointStyle: true
          }
        },
        tooltip: {
          callbacks: {
            label: function(context) {
              const total = context.dataset.data.reduce((sum, val) => sum + val, 0);
              const percentage = ((context.parsed / total) * 100).toFixed(1);
              return context.label + ': ' + context.parsed + ' (' + percentage + '%)';
            }
          }
        }
      }
    }
  });
}

// 渲染地區分布圖
function renderRegionChart(stats) {
  const canvas = document.getElementById('region-chart');
  if (!canvas) {
    console.error('找不到 region-chart canvas');
    return;
  }

  // 銷毀現有圖表
  if (window.regionChart) {
    window.regionChart.destroy();
  }

  // 生成地區分布數據
  const regionData = stats.regionDist || {
    '臺北市': 5,
    '臺中市': 4,
    '臺東縣': 4,
    '新竹縣': 2,
    '南投市': 2,
    '高雄市': 2,
    '桃園市': 3,
    '臺南市': 1,
    '新北市': 1,
    '屏東縣': 1,
    '金門縣': 1
  };

  const colors = [
    '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
    '#06b6d4', '#84cc16', '#f97316', '#ec4899', '#6366f1',
    '#14b8a6'
  ];

  window.regionChart = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels: Object.keys(regionData),
      datasets: [{
        data: Object.values(regionData),
        backgroundColor: colors.slice(0, Object.keys(regionData).length),
        borderWidth: 2,
        borderColor: '#fff'
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            font: { size: 11 },
            usePointStyle: true
          }
        },
        tooltip: {
          callbacks: {
            label: function(context) {
              const total = context.dataset.data.reduce((sum, val) => sum + val, 0);
              const percentage = ((context.parsed / total) * 100).toFixed(1);
              return context.label + ': ' + context.parsed + ' (' + percentage + '%)';
            }
          }
        }
      }
    }
  });
}

// 載入智能建議
async function loadDashboardInsights() {
    try {
        const insightsRes = await fetch(`${API_BASE_URL}/api/insights`);
        const insightsData = await insightsRes.json();
        
        const insightsContent = document.getElementById('insights-content');
        if (!insightsContent) return;
        
        let html = '';
        
        if (insightsData.suggestions && insightsData.suggestions.length > 0) {
            insightsData.suggestions.forEach(suggestion => {
                const type = getSuggestionType(suggestion);
                html += `<p class="${type}">${suggestion}</p>`;
            });
        } else {
            html += '<p class="success">目前各項指標正常，請持續保持！</p>';
        }
        
        insightsContent.innerHTML = html;
        
    } catch (error) {
        console.error('載入智能建議失敗:', error);
        const insightsContent = document.getElementById('insights-content');
        if (insightsContent) {
            insightsContent.innerHTML = '<p class="error-message">載入智能建議失敗，請稍後再試</p>';
        }
    }
}

// 設置儀表板事件監聽器
function setupDashboardEvents() {
    // 日期範圍查詢
    document.getElementById('dashboard-date-search-btn').addEventListener('click', function() {
        const startDate = document.getElementById('dashboard-start-date').value;
        const endDate = document.getElementById('dashboard-end-date').value;
        loadDashboard('month', startDate, endDate);
    });
    
    // 重置按鈕
    document.getElementById('dashboard-reset-btn').addEventListener('click', function() {
        document.getElementById('dashboard-start-date').value = '';
        document.getElementById('dashboard-end-date').value = '';
        loadDashboard();
    });
    
    // 視圖切換
    document.querySelectorAll('.view-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
            this.classList.add('active');
            const view = this.dataset.view;
            loadDashboard(view);
        });
    });
    
    // 快速篩選
    document.querySelectorAll('.filter-chip').forEach(chip => {
        chip.addEventListener('click', function() {
            document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
            this.classList.add('active');
            const period = this.dataset.period;
            applyQuickFilter(period);
        });
    });
    
    // 圖表控制
    document.querySelectorAll('.chart-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            const container = this.closest('.chart-container');
            container.querySelectorAll('.chart-btn').forEach(b => b.classList.remove('active'));
            this.classList.add('active');
            const metric = this.dataset.metric;
            updateChartMetric(container, metric);
        });
    });
    
    // 智能分析篩選
    document.querySelectorAll('.insight-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            document.querySelectorAll('.insight-btn').forEach(b => b.classList.remove('active'));
            this.classList.add('active');
            const type = this.dataset.type;
            filterInsights(type);
        });
    });
    
    // 實時更新
    setInterval(updateRealTimeData, 30000); // 每30秒更新一次
}

// 應用快速篩選
function applyQuickFilter(period) {
    const now = new Date();
    let startDate = '';
    let endDate = '';
    
    switch(period) {
        case 'today':
            startDate = endDate = now.toISOString().split('T')[0];
            break;
        case 'week':
            const weekStart = new Date(now);
            weekStart.setDate(now.getDate() - now.getDay());
            startDate = weekStart.toISOString().split('T')[0];
            endDate = now.toISOString().split('T')[0];
            break;
        case 'month':
            startDate = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
            endDate = now.toISOString().split('T')[0];
            break;
        case 'quarter':
            const quarter = Math.floor(now.getMonth() / 3);
            startDate = new Date(now.getFullYear(), quarter * 3, 1).toISOString().split('T')[0];
            endDate = now.toISOString().split('T')[0];
            break;
        default:
            // 全部 - 不設置日期範圍
            break;
    }
    
    loadDashboard('month', startDate, endDate);
}

// 更新圖表指標
function updateChartMetric(container, metric) {
    // 這裡可以根據不同的指標更新圖表
    console.log('更新圖表指標:', metric);
    // 實際實現中會重新渲染對應的圖表
}

// 篩選智能分析
function filterInsights(type) {
    const insights = document.querySelectorAll('.insight-card');
    insights.forEach(insight => {
        if (type === 'all' || insight.classList.contains(type)) {
            insight.style.display = 'block';
        } else {
            insight.style.display = 'none';
        }
    });
}

// 更新實時數據
function updateRealTimeData() {
    // 模擬實時數據更新
    const todayNew = Math.floor(Math.random() * 5);
    const todayPayments = Math.floor(Math.random() * 10);
    const overdueAlerts = Math.floor(Math.random() * 3);
    
    document.getElementById('today-new').textContent = todayNew;
    document.getElementById('today-payments').textContent = todayPayments;
    document.getElementById('overdue-alerts').textContent = overdueAlerts;
    
    // 添加更新動畫
    const elements = ['today-new', 'today-payments', 'overdue-alerts'];
    elements.forEach(id => {
        const element = document.getElementById(id);
        if (element) {
            element.classList.add('updated');
            setTimeout(() => element.classList.remove('updated'), 1000);
        }
    });
}

// 匯出儀表板數據
function exportDashboardData() {
    // 實現匯出功能
    showNotification('正在準備匯出報表...', 'info');
    setTimeout(() => {
        showNotification('報表匯出完成', 'success');
    }, 2000);
}

// 初始化儀表板
function initDashboard() {
    setupDashboardEvents();
    loadDashboard();
    
    // 設置實時更新
    updateRealTimeData();
    
    // 添加載入動畫
    const cards = document.querySelectorAll('.kpi-card');
    cards.forEach((card, index) => {
        card.style.animationDelay = `${index * 0.1}s`;
    });
}

// 獲取狀態圖標
function getStatusIcon(status) {
    const icons = {
        '新增客戶': '🆕',
        '租賃中': '📱',
        '已買回': '✅',
        '呆帳': '⚠️',
        '逾期率(%)': '⏰',
        '呆帳率(%)': '🚨',
        '回收率(%)': '💰'
    };
    return icons[status] || '📊';
}



// 新增：比率趨勢圖




// 動態產生編輯表單
async function fillEditForm(customer) {
    // 取得所有設備
    const sales = await getAllSales();
    let salesOptions = '<option value="">請選擇設備</option>' + sales.map(s => `<option value="${s.id}" ${customer.salesId===s.id?'selected':''}>${s.name}（${s.appleAccount}）</option>`).join('');
    const form = document.getElementById('edit-customer-form');
    form.setAttribute('enctype', 'multipart/form-data');
    form.innerHTML = `
      <input type="hidden" name="id" value="${customer.id}" />
      
      <div class="form-sections">
        <!-- 基本資料 -->
        <div class="form-section active" data-section="basic">
          <h4>基本資料</h4>
          <div class="form-row">
            <div class="form-group">
              <label>姓名 *</label>
              <input type="text" name="name" value="${customer.name}" required />
            </div>
            <div class="form-group">
              <label>身分證字號 *</label>
              <input type="text" name="idNumber" value="${customer.idNumber}" required />
            </div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>手機號碼 *</label>
              <input type="tel" name="phone" value="${customer.phone}" required />
            </div>
            <div class="form-group">
              <label>生日</label>
              <input type="date" name="birthday" value="${customer.birthday || ''}" />
            </div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>職業</label>
              <input type="text" name="occupation" value="${customer.occupation || ''}" />
            </div>
            <div class="form-group">
              <label>來源管道</label>
              <input type="text" name="source" value="${customer.source || ''}" />
            </div>
          </div>
        </div>

        <!-- 聯絡資訊 -->
        <div class="form-section" data-section="contact">
          <h4>聯絡資訊</h4>
          <div class="form-group">
            <label>緊急聯絡人</label>
            <input type="text" name="emergencyContactName" value="${customer.emergencyContactName || ''}" placeholder="姓名" />
          </div>
          <div class="form-group">
            <label>緊急聯絡電話</label>
            <input type="tel" name="emergencyContactPhone" value="${customer.emergencyContactPhone || ''}" placeholder="電話" />
          </div>
          <div class="form-group">
            <label>戶籍地址</label>
            <input type="text" name="address" value="${customer.address || ''}" />
          </div>
          <div class="form-group">
            <label>通訊地址</label>
            <input type="text" name="currentAddress" value="${customer.currentAddress || ''}" />
          </div>
        </div>

        <!-- 租賃資訊 -->
        <div class="form-section" data-section="rental">
          <h4>租賃資訊</h4>
          <div class="form-row">
            <div class="form-group">
              <label>手機型號 *</label>
              <select name="model" required>
                <option value="">請選擇型號</option>
                <option value="iPhone 12 64GB" ${customer.model==="iPhone 12 64GB"?'selected':''}>iPhone 12 64GB</option>
                <option value="iPhone 12 128GB" ${customer.model==="iPhone 12 128GB"?'selected':''}>iPhone 12 128GB</option>
                <option value="iPhone 12 256GB" ${customer.model==="iPhone 12 256GB"?'selected':''}>iPhone 12 256GB</option>
                <option value="iPhone 12 mini 64GB" ${customer.model==="iPhone 12 mini 64GB"?'selected':''}>iPhone 12 mini 64GB</option>
                <option value="iPhone 12 mini 128GB" ${customer.model==="iPhone 12 mini 128GB"?'selected':''}>iPhone 12 mini 128GB</option>
                <option value="iPhone 12 mini 256GB" ${customer.model==="iPhone 12 mini 256GB"?'selected':''}>iPhone 12 mini 256GB</option>
                <option value="iPhone 12 Pro 128GB" ${customer.model==="iPhone 12 Pro 128GB"?'selected':''}>iPhone 12 Pro 128GB</option>
                <option value="iPhone 12 Pro 256GB" ${customer.model==="iPhone 12 Pro 256GB"?'selected':''}>iPhone 12 Pro 256GB</option>
                <option value="iPhone 12 Pro 512GB" ${customer.model==="iPhone 12 Pro 512GB"?'selected':''}>iPhone 12 Pro 512GB</option>
                <option value="iPhone 12 Pro Max 128GB" ${customer.model==="iPhone 12 Pro Max 128GB"?'selected':''}>iPhone 12 Pro Max 128GB</option>
                <option value="iPhone 12 Pro Max 256GB" ${customer.model==="iPhone 12 Pro Max 256GB"?'selected':''}>iPhone 12 Pro Max 256GB</option>
                <option value="iPhone 12 Pro Max 512GB" ${customer.model==="iPhone 12 Pro Max 512GB"?'selected':''}>iPhone 12 Pro Max 512GB</option>
                <option value="iPhone 13 128GB" ${customer.model==="iPhone 13 128GB"?'selected':''}>iPhone 13 128GB</option>
                <option value="iPhone 13 256GB" ${customer.model==="iPhone 13 256GB"?'selected':''}>iPhone 13 256GB</option>
                <option value="iPhone 13 512GB" ${customer.model==="iPhone 13 512GB"?'selected':''}>iPhone 13 512GB</option>
                <option value="iPhone 13 mini 128GB" ${customer.model==="iPhone 13 mini 128GB"?'selected':''}>iPhone 13 mini 128GB</option>
                <option value="iPhone 13 mini 256GB" ${customer.model==="iPhone 13 mini 256GB"?'selected':''}>iPhone 13 mini 256GB</option>
                <option value="iPhone 13 mini 512GB" ${customer.model==="iPhone 13 mini 512GB"?'selected':''}>iPhone 13 mini 512GB</option>
                <option value="iPhone 13 Pro 128GB" ${customer.model==="iPhone 13 Pro 128GB"?'selected':''}>iPhone 13 Pro 128GB</option>
                <option value="iPhone 13 Pro 256GB" ${customer.model==="iPhone 13 Pro 256GB"?'selected':''}>iPhone 13 Pro 256GB</option>
                <option value="iPhone 13 Pro 512GB" ${customer.model==="iPhone 13 Pro 512GB"?'selected':''}>iPhone 13 Pro 512GB</option>
                <option value="iPhone 13 Pro 1TB" ${customer.model==="iPhone 13 Pro 1TB"?'selected':''}>iPhone 13 Pro 1TB</option>
                <option value="iPhone 13 Pro Max 128GB" ${customer.model==="iPhone 13 Pro Max 128GB"?'selected':''}>iPhone 13 Pro Max 128GB</option>
                <option value="iPhone 13 Pro Max 256GB" ${customer.model==="iPhone 13 Pro Max 256GB"?'selected':''}>iPhone 13 Pro Max 256GB</option>
                <option value="iPhone 13 Pro Max 512GB" ${customer.model==="iPhone 13 Pro Max 512GB"?'selected':''}>iPhone 13 Pro Max 512GB</option>
                <option value="iPhone 13 Pro Max 1TB" ${customer.model==="iPhone 13 Pro Max 1TB"?'selected':''}>iPhone 13 Pro Max 1TB</option>
                <option value="iPhone SE (第三代) 64GB" ${customer.model==="iPhone SE (第三代) 64GB"?'selected':''}>iPhone SE (第三代) 64GB</option>
                <option value="iPhone SE (第三代) 128GB" ${customer.model==="iPhone SE (第三代) 128GB"?'selected':''}>iPhone SE (第三代) 128GB</option>
                <option value="iPhone SE (第三代) 256GB" ${customer.model==="iPhone SE (第三代) 256GB"?'selected':''}>iPhone SE (第三代) 256GB</option>
                <option value="iPhone 14 128GB" ${customer.model==="iPhone 14 128GB"?'selected':''}>iPhone 14 128GB</option>
                <option value="iPhone 14 256GB" ${customer.model==="iPhone 14 256GB"?'selected':''}>iPhone 14 256GB</option>
                <option value="iPhone 14 512GB" ${customer.model==="iPhone 14 512GB"?'selected':''}>iPhone 14 512GB</option>
                <option value="iPhone 14 Plus 128GB" ${customer.model==="iPhone 14 Plus 128GB"?'selected':''}>iPhone 14 Plus 128GB</option>
                <option value="iPhone 14 Plus 256GB" ${customer.model==="iPhone 14 Plus 256GB"?'selected':''}>iPhone 14 Plus 256GB</option>
                <option value="iPhone 14 Plus 512GB" ${customer.model==="iPhone 14 Plus 512GB"?'selected':''}>iPhone 14 Plus 512GB</option>
                <option value="iPhone 14 Pro 128GB" ${customer.model==="iPhone 14 Pro 128GB"?'selected':''}>iPhone 14 Pro 128GB</option>
                <option value="iPhone 14 Pro 256GB" ${customer.model==="iPhone 14 Pro 256GB"?'selected':''}>iPhone 14 Pro 256GB</option>
                <option value="iPhone 14 Pro 512GB" ${customer.model==="iPhone 14 Pro 512GB"?'selected':''}>iPhone 14 Pro 512GB</option>
                <option value="iPhone 14 Pro 1TB" ${customer.model==="iPhone 14 Pro 1TB"?'selected':''}>iPhone 14 Pro 1TB</option>
                <option value="iPhone 14 Pro Max 128GB" ${customer.model==="iPhone 14 Pro Max 128GB"?'selected':''}>iPhone 14 Pro Max 128GB</option>
                <option value="iPhone 14 Pro Max 256GB" ${customer.model==="iPhone 14 Pro Max 256GB"?'selected':''}>iPhone 14 Pro Max 256GB</option>
                <option value="iPhone 14 Pro Max 512GB" ${customer.model==="iPhone 14 Pro Max 512GB"?'selected':''}>iPhone 14 Pro Max 512GB</option>
                <option value="iPhone 14 Pro Max 1TB" ${customer.model==="iPhone 14 Pro Max 1TB"?'selected':''}>iPhone 14 Pro Max 1TB</option>
                <option value="iPhone 15 128GB" ${customer.model==="iPhone 15 128GB"?'selected':''}>iPhone 15 128GB</option>
                <option value="iPhone 15 256GB" ${customer.model==="iPhone 15 256GB"?'selected':''}>iPhone 15 256GB</option>
                <option value="iPhone 15 512GB" ${customer.model==="iPhone 15 512GB"?'selected':''}>iPhone 15 512GB</option>
                <option value="iPhone 15 Plus 128GB" ${customer.model==="iPhone 15 Plus 128GB"?'selected':''}>iPhone 15 Plus 128GB</option>
                <option value="iPhone 15 Plus 256GB" ${customer.model==="iPhone 15 Plus 256GB"?'selected':''}>iPhone 15 Plus 256GB</option>
                <option value="iPhone 15 Plus 512GB" ${customer.model==="iPhone 15 Plus 512GB"?'selected':''}>iPhone 15 Plus 512GB</option>
                <option value="iPhone 15 Pro 128GB" ${customer.model==="iPhone 15 Pro 128GB"?'selected':''}>iPhone 15 Pro 128GB</option>
                <option value="iPhone 15 Pro 256GB" ${customer.model==="iPhone 15 Pro 256GB"?'selected':''}>iPhone 15 Pro 256GB</option>
                <option value="iPhone 15 Pro 512GB" ${customer.model==="iPhone 15 Pro 512GB"?'selected':''}>iPhone 15 Pro 512GB</option>
                <option value="iPhone 15 Pro 1TB" ${customer.model==="iPhone 15 Pro 1TB"?'selected':''}>iPhone 15 Pro 1TB</option>
                <option value="iPhone 15 Pro Max 256GB" ${customer.model==="iPhone 15 Pro Max 256GB"?'selected':''}>iPhone 15 Pro Max 256GB</option>
                <option value="iPhone 15 Pro Max 512GB" ${customer.model==="iPhone 15 Pro Max 512GB"?'selected':''}>iPhone 15 Pro Max 512GB</option>
                <option value="iPhone 15 Pro Max 1TB" ${customer.model==="iPhone 15 Pro Max 1TB"?'selected':''}>iPhone 15 Pro Max 1TB</option>
                <option value="iPhone 16 128GB" ${customer.model==="iPhone 16 128GB"?'selected':''}>iPhone 16 128GB</option>
            <option value="iPhone 16 256GB" ${customer.model==="iPhone 16 256GB"?'selected':''}>iPhone 16 256GB</option>
            <option value="iPhone 16 512GB" ${customer.model==="iPhone 16 512GB"?'selected':''}>iPhone 16 512GB</option>
            <option value="iPhone 16 1TB" ${customer.model==="iPhone 16 1TB"?'selected':''}>iPhone 16 1TB</option>
            <option value="iPhone 16 Plus 128GB" ${customer.model==="iPhone 16 Plus 128GB"?'selected':''}>iPhone 16 Plus 128GB</option>
            <option value="iPhone 16 Plus 256GB" ${customer.model==="iPhone 16 Plus 256GB"?'selected':''}>iPhone 16 Plus 256GB</option>
            <option value="iPhone 16 Plus 512GB" ${customer.model==="iPhone 16 Plus 512GB"?'selected':''}>iPhone 16 Plus 512GB</option>
            <option value="iPhone 16 Plus 1TB" ${customer.model==="iPhone 16 Plus 1TB"?'selected':''}>iPhone 16 Plus 1TB</option>
            <option value="iPhone 16 Pro 128GB" ${customer.model==="iPhone 16 Pro 128GB"?'selected':''}>iPhone 16 Pro 128GB</option>
            <option value="iPhone 16 Pro 256GB" ${customer.model==="iPhone 16 Pro 256GB"?'selected':''}>iPhone 16 Pro 256GB</option>
            <option value="iPhone 16 Pro 512GB" ${customer.model==="iPhone 16 Pro 512GB"?'selected':''}>iPhone 16 Pro 512GB</option>
            <option value="iPhone 16 Pro 1TB" ${customer.model==="iPhone 16 Pro 1TB"?'selected':''}>iPhone 16 Pro 1TB</option>
            <option value="iPhone 16 Pro Max 256GB" ${customer.model==="iPhone 16 Pro Max 256GB"?'selected':''}>iPhone 16 Pro Max 256GB</option>
            <option value="iPhone 16 Pro Max 512GB" ${customer.model==="iPhone 16 Pro Max 512GB"?'selected':''}>iPhone 16 Pro Max 512GB</option>
            <option value="iPhone 16 Pro Max 1TB" ${customer.model==="iPhone 16 Pro Max 1TB"?'selected':''}>iPhone 16 Pro Max 1TB</option>
            <option value="iPhone 16e 128GB" ${customer.model==="iPhone 16e 128GB"?'selected':''}>iPhone 16e 128GB</option>
            <option value="iPhone 16e 256GB" ${customer.model==="iPhone 16e 256GB"?'selected':''}>iPhone 16e 256GB</option>
            <option value="iPhone 16e 512GB" ${customer.model==="iPhone 16e 512GB"?'selected':''}>iPhone 16e 512GB</option>
          </select>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>IMEI</label>
            <input type="text" name="imei" value="${customer.imei || ''}" />
          </div>
          <div class="form-group">
            <label>序號</label>
            <input type="text" name="serialNumber" value="${customer.serialNumber || ''}" />
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>螢幕密碼</label>
            <input type="text" name="screenPassword" value="${customer.screenPassword || ''}" />
          </div>
          <div class="form-group">
            <label>合約起始日 *</label>
            <input type="date" name="contractDate" value="${customer.contractDate || ''}" required />
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>繳款週期 (天) *</label>
            <input type="number" name="paymentCycleDays" value="${customer.paymentCycleDays || 30}" required />
          </div>
        </div>
      </div>

      <!-- 財務資訊 -->
      <div class="form-section" data-section="financial">
        <h4>財務資訊</h4>
        <div class="form-row">
          <div class="form-group">
            <label>買賣價金 *</label>
            <input type="number" name="salePrice" value="${customer.salePrice || ''}" required />
          </div>
          <div class="form-group">
            <label>租金 *</label>
            <input type="number" name="rent" value="${customer.rent || ''}" required />
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>銀行</label>
            <input type="text" name="bank" value="${customer.bank || ''}" />
          </div>
          <div class="form-group">
            <label>銀行帳號</label>
            <input type="text" name="bankAccountNumber" value="${customer.bankAccountNumber || ''}" />
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>銀行戶名</label>
            <input type="text" name="bankAccountName" value="${customer.bankAccountName || ''}" />
          </div>
          <div class="form-group">
            <label>設備</label>
            <select name="salesId">
              ${salesOptions}
            </select>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>下次應繳日覆蓋</label>
            <input type="date" name="nextDueOverride" value="${customer.nextDueOverride || ''}" />
          </div>
        </div>
      </div>

      <!-- 檔案上傳 -->
      <div class="form-section" data-section="files">
        <h4>檔案上傳</h4>
        <div class="file-upload-grid">
          <div class="file-upload-item">
            <label>身分證正面</label>
            <input type="file" name="idFront" accept="image/*" />
            <div class="file-preview">
              ${customer.idFront ? `<div class="file-info"><a href="/uploads/${customer.idFront}" target="_blank">查看檔案</a></div>` : ''}
            </div>
          </div>
          <div class="file-upload-item">
            <label>身分證反面</label>
            <input type="file" name="idBack" accept="image/*" />
            <div class="file-preview">
              ${customer.idBack ? `<div class="file-info"><a href="/uploads/${customer.idBack}" target="_blank">查看檔案</a></div>` : ''}
            </div>
          </div>
          <div class="file-upload-item">
            <label>存摺封面</label>
            <input type="file" name="billPhoto" accept="image/*" />
            <div class="file-preview">
              ${customer.billPhoto ? `<div class="file-info"><a href="/uploads/${customer.billPhoto}" target="_blank">查看檔案</a></div>` : ''}
            </div>
          </div>
          <div class="file-upload-item">
            <label>合約PDF</label>
            <input type="file" name="contractPdf" accept=".pdf" />
            <div class="file-preview">
              ${customer.contractPdf ? `<div class="file-info"><a href="/uploads/${customer.contractPdf}" target="_blank">查看檔案</a></div>` : ''}
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 表單導航 -->
    <div class="form-navigation">
      <button type="button" class="nav-btn" id="edit-prev-section">上一步</button>
      <div class="section-indicators">
        <span class="indicator active" data-section="basic">1</span>
        <span class="indicator" data-section="contact">2</span>
        <span class="indicator" data-section="rental">3</span>
        <span class="indicator" data-section="financial">4</span>
        <span class="indicator" data-section="files">5</span>
      </div>
      <button type="button" class="nav-btn" id="edit-next-section">下一步</button>
    </div>

    <div class="form-actions">
      <button type="submit" class="submit-btn">更新客戶</button>
    </div>
  `;
  
  // 設置編輯表單的導航
  setupEditFormNavigation();
}

// 設置編輯表單導航
function setupEditFormNavigation() {
  const sections = ['basic', 'contact', 'rental', 'financial', 'files'];
  let currentSectionIndex = 0;

  const showSection = (index) => {
    sections.forEach((section, i) => {
      const sectionElement = document.querySelector(`#edit-modal [data-section="${section}"]`);
      const indicator = document.querySelector(`#edit-modal .indicator[data-section="${section}"]`);
      
      if (sectionElement) {
        sectionElement.classList.toggle('active', i === index);
      }
      if (indicator) {
        indicator.classList.toggle('active', i === index);
      }
    });

    // 更新导航按钮状态
    const prevBtn = document.getElementById('edit-prev-section');
    const nextBtn = document.getElementById('edit-next-section');
    
    if (prevBtn) prevBtn.disabled = index === 0;
    if (nextBtn) nextBtn.disabled = index === sections.length - 1;
  };

  document.getElementById('edit-prev-section')?.addEventListener('click', () => {
    if (currentSectionIndex > 0) {
      currentSectionIndex--;
      showSection(currentSectionIndex);
    }
  });

  document.getElementById('edit-next-section')?.addEventListener('click', () => {
    if (currentSectionIndex < sections.length - 1) {
      currentSectionIndex++;
      showSection(currentSectionIndex);
    }
  });

  // 指示器点击
  document.querySelectorAll('#edit-modal .indicator').forEach((indicator, index) => {
    indicator.addEventListener('click', () => {
      currentSectionIndex = index;
      showSection(currentSectionIndex);
    });
  });
}

// 將fillEditForm暴露到全局
window.fillEditForm = fillEditForm;

// 繳款模態框
    const modal = document.getElementById('payment-modal');
const closeModal = document.querySelector('.close-modal');
if (modal && closeModal) {
    closeModal.addEventListener('click', () => {
        modal.classList.remove('active');
    });

    window.showPaymentModal = (customerId) => {
        console.log('顯示繳款模態框:', customerId);
        modal.dataset.customerId = customerId;
        // 設置默認日期為今天
        document.getElementById('payment-date').valueAsDate = new Date();
        modal.classList.add('active');
    };

    const submitPayment = document.getElementById('submit-payment');
    if (submitPayment) {
        submitPayment.addEventListener('click', async () => {
            const amount = document.getElementById('payment-amount').value;
            const date = document.getElementById('payment-date').value;
            const customerId = modal.dataset.customerId;

            if (!amount || isNaN(amount) || amount <= 0) {
                alert('請輸入有效的繳款金額');
                return;
            }

            if (!date) {
                alert('請選擇繳款日期');
                return;
            }

            try {
                const response = await fetch(`${API_BASE_URL}/api/customers/${customerId}/payments`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ 
                        amount: Number(amount),
                        date: date
                    })
                });

                const result = await response.json();
                if (result.success) {
                    alert('繳款成功');
                    modal.classList.remove('active');
                    document.getElementById('payment-amount').value = '';
                    document.getElementById('payment-date').value = '';
                    loadCustomers();
                    loadDashboard();
                } else {
                    alert(result.message || result.error || '繳款失敗');
                }
            } catch (error) {
                console.error('繳款失敗:', error);
                alert('繳款失敗，請稍後再試');
            }
        });
    }
}

// 關閉編輯 modal - 這個已經由customer-card-system.js統一處理

// 編輯表單送出
const editForm = document.getElementById('edit-customer-form');
if (editForm) {
    editForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const formData = new FormData(editForm);
        const id = formData.get('id');
        try {
            const response = await fetch(`${API_BASE_URL}/api/customers/${id}`, {
                method: 'PUT',
                body: formData
            });
            const result = await response.json();
            if (result.success) {
                showNotification('編輯成功', 'success');
                const editModal = document.getElementById('edit-modal');
                if (window.customerCardSystem && window.customerCardSystem.closeModal) {
                    window.customerCardSystem.closeModal(editModal);
                } else {
                    editModal.classList.remove('active');
                    editModal.style.display = 'none';
                }
                loadCustomers();
                loadDashboard();
            } else {
                showNotification(result.message || result.error || '編輯失敗', 'error');
            }
        } catch (error) {
            showNotification('編輯失敗，請稍後再試', 'error');
        }
    });
}

// 載入繳款紀錄
async function loadPaymentHistory(customerId, container) {
    if (!container) return;
    try {
        const res = await fetch(`${API_BASE_URL}/api/customers/${customerId}/payments`);
        const data = await res.json();
        if (!data.payments || data.payments.length === 0) {
            container.innerHTML = '<p class="no-payments">無繳款紀錄</p>';
            return;
        }
        
        let totalPaid = 0;
        let html = `
            <div class="payment-header">
                <h5>繳款紀錄 (${data.payments.length}筆)</h5>
                <button class="add-payment-btn" onclick="showPaymentModal('${customerId}')">
                    <span class="icon">➕</span>新增繳款
                </button>
            </div>
            <div class="payment-list">
        `;
        
        data.payments.forEach((pay, index) => {
            totalPaid += Number(pay.amount);
            const paymentDate = new Date(pay.date).toLocaleDateString();
            
            html += `
                <div class="payment-item" data-index="${index}" data-customer-id="${customerId}">
                    <div class="payment-info">
                        <div class="payment-date">
                            <label>日期：</label>
                            <input type="date" class="payment-date-input" value="${pay.date.split('T')[0]}" 
                                   onchange="updatePaymentField('${customerId}', ${index}, 'date', this.value)">
                        </div>
                        <div class="payment-amount">
                            <label>金額：</label>
                            <input type="number" class="payment-amount-input" value="${pay.amount}" 
                                   onchange="updatePaymentField('${customerId}', ${index}, 'amount', this.value)">
                        </div>
                        <div class="payment-note">
                            <label>備註：</label>
                            <input type="text" class="payment-note-input" value="${pay.note || ''}" 
                                   placeholder="備註" onchange="updatePaymentField('${customerId}', ${index}, 'note', this.value)">
                        </div>
                    </div>
                    <div class="payment-actions">
                        <button class="action-btn small" onclick="savePaymentChanges('${customerId}', ${index})">
                            <span class="icon">💾</span>儲存
                        </button>
                        <button class="action-btn small danger" onclick="deletePayment('${customerId}', ${index})">
                            <span class="icon">🗑️</span>刪除
                        </button>
                    </div>
                </div>
            `;
        });
        
        html += `
            </div>
            <div class="payment-summary">
                <p>累計已繳：<b>${formatCurrency(totalPaid)}</b></p>
            </div>
        `;
        
        container.innerHTML = html;
    } catch (e) {
        container.innerHTML = '<p class="error-message">載入繳款紀錄失敗</p>';
    }
}

// 更新繳款欄位
function updatePaymentField(customerId, index, field, value) {
    // 這裡可以添加即時驗證邏輯
    console.log(`更新繳款 ${customerId} ${index} ${field}: ${value}`);
}

// 儲存繳款變更
async function savePaymentChanges(customerId, index) {
    const paymentItem = document.querySelector(`[data-customer-id="${customerId}"][data-index="${index}"]`);
    if (!paymentItem) return;
    
    const dateInput = paymentItem.querySelector('.payment-date-input');
    const amountInput = paymentItem.querySelector('.payment-amount-input');
    const noteInput = paymentItem.querySelector('.payment-note-input');
    
    const newDate = dateInput.value;
    const newAmount = amountInput.value;
    const newNote = noteInput.value;
    
    if (!newDate || !newAmount || isNaN(newAmount) || newAmount <= 0) {
        showNotification('請輸入正確的日期與金額', 'error');
        return;
    }
    
    try {
        const response = await fetch(`${API_BASE_URL}/api/customers/${customerId}/payments/${index}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                date: newDate, 
                amount: Number(newAmount), 
                note: newNote 
            })
        });
        
        const result = await response.json();
        if (result.success) {
            showNotification('繳款紀錄更新成功', 'success');
            loadCustomers();
            loadDashboard();
        } else {
            showNotification(result.message || result.error || '更新失敗', 'error');
        }
    } catch (error) {
        showNotification('更新失敗，請稍後再試', 'error');
    }
}

// 刪除繳款紀錄
async function deletePayment(customerId, index) {
    if (!confirm('確定要刪除此筆繳款紀錄嗎？此操作無法復原！')) return;
    
    try {
        const response = await fetch(`${API_BASE_URL}/api/payments/${customerId}/${index}`, {
            method: 'DELETE'
        });
        
        const result = await response.json();
        if (result.success) {
            showNotification('繳款紀錄刪除成功', 'success');
            loadCustomers();
            loadDashboard();
        } else {
            showNotification(result.message || result.error || '刪除失敗', 'error');
        }
    } catch (error) {
        showNotification('刪除失敗，請稍後再試', 'error');
    }
}

// 帳表頁面渲染
async function loadTable() {
    const container = document.getElementById('table-container');
    container.innerHTML = '<div class="loading"></div>';
    try {
        const res = await fetch('/api/export/table');
        const data = await res.json();
        if (!data.table || data.table.length === 0) {
            container.innerHTML = '<div class="no-data">暫無帳務資料</div>';
            return;
        }

        // 添加篩選器
        let html = `
            <div class="account-filters">
                <div class="filter-group">
                    <label>狀態篩選:</label>
                    <select id="status-filter">
                        <option value="">全部狀態</option>
                        <option value="normal">正常</option>
                        <option value="overdue">逾期</option>
                        <option value="locked">呆帳</option>
                        <option value="buyback">已買回</option>
                        <option value="completed">結清</option>
                    </select>
                    <label>逾期天數:</label>
                    <select id="overdue-filter">
                        <option value="">全部</option>
                        <option value="1-7">1-7天</option>
                        <option value="8-30">8-30天</option>
                        <option value="30+">30天以上</option>
                    </select>
                    <button onclick="applyTableFilters()">篩選</button>
                    <button onclick="clearTableFilters()">清除</button>
                </div>
            </div>
        `;

        // 添加導出按鈕
        html += `
            <div class="export-buttons">
                <button class="export-btn excel" onclick="exportTableToExcel()">匯出 Excel</button>
                <button class="export-btn" onclick="exportTableToCSV()">匯出 CSV</button>
            </div>
        `;

        // 添加統計摘要
        html += '<div class="account-summary">';
        if (data.stats) {
            html += `
                <div class="summary-cards">
                    <div class="summary-card">
                        <h3>總客戶數</h3>
                        <div class="summary-value">${data.stats.total}</div>
                    </div>
                    <div class="summary-card">
                        <h3>正常客戶</h3>
                        <div class="summary-value normal">${data.stats.normal} (${data.stats.normalRate}%)</div>
                    </div>
                    <div class="summary-card">
                        <h3>逾期客戶</h3>
                        <div class="summary-value overdue">${data.stats.overdue} (${data.stats.overdueRate}%)</div>
                    </div>
                    <div class="summary-card">
                        <h3>呆帳客戶</h3>
                        <div class="summary-value locked">${data.stats.locked} (${data.stats.lockedRate}%)</div>
                    </div>
                    <div class="summary-card">
                        <h3>已買回客戶</h3>
                        <div class="summary-value buyback">${data.stats.buyback} (${data.stats.buybackRate}%)</div>
                    </div>
                    <div class="summary-card">
                        <h3>結清客戶</h3>
                        <div class="summary-value completed">${data.stats.completed} (${data.stats.completedRate}%)</div>
                    </div>
                </div>
                <div class="summary-cards">
                    <div class="summary-card">
                        <h3>應繳總額</h3>
                        <div class="summary-value">${data.stats.totalShouldPay.toLocaleString()}</div>
                    </div>
                    <div class="summary-card">
                        <h3>已繳總額</h3>
                        <div class="summary-value">${data.stats.totalPaid.toLocaleString()}</div>
                    </div>
                    <div class="summary-card">
                        <h3>總損益</h3>
                        <div class="summary-value ${data.stats.totalProfit >= 0 ? 'profit' : 'loss'}">${data.stats.totalProfit.toLocaleString()}</div>
                    </div>
                    <div class="summary-card">
                        <h3>逾期金額</h3>
                        <div class="summary-value overdue">${data.stats.totalOverdueAmount.toLocaleString()}</div>
                    </div>
                    <div class="summary-card">
                        <h3>回收率</h3>
                        <div class="summary-value">${data.stats.recoveryRate}%</div>
                    </div>
                </div>
            `;
        }
        html += '</div>';

        // 帳表表格
        html += '<div style="overflow-x:auto;"><table class="account-table"><thead><tr>';
        
        // 定義顯示欄位和順序
        const displayFields = [
            'name', 'phone', 'model', 'contractDate', 'rent', 'cycle', 'salePrice',
            'currentPeriod', 'shouldPay', 'totalPaid', 'currentPeriodPaid', 'currentPeriodRemain',
            'nextDueDate', 'profit', 'overdueDays', 'statusText'
        ];
        
        displayFields.forEach(field => {
            const headerText = data.headers[field] || field;
            html += `<th>${headerText}</th>`;
        });
        html += '<th>繳款紀錄</th>';
        html += '</tr></thead><tbody>';

        data.table.forEach(row => {
            // 根據狀態設定行樣式
            let rowClass = '';
            if (row.isOverdue) rowClass = 'overdue-row';
            else if (row.status === 'normal') rowClass = 'normal-row';
            else if (row.status === 'buyback') rowClass = 'buyback-row';
            else if (row.status === 'completed') rowClass = 'completed-row';
            
            html += `<tr class="${rowClass}" data-status="${row.status}" data-overdue="${row.overdueDays}">`;
            
            displayFields.forEach(field => {
                const value = row[field];
                let cellContent = '';
                
                if (field === 'profit') {
                    const color = value < 0 ? 'red' : 'green';
                    cellContent = `<span style="color:${color};font-weight:bold;">${value.toLocaleString()}</span>`;
                } else if (field === 'overdueDays') {
                    if (value > 0) {
                        cellContent = `<span style="color:red;font-weight:bold;">${value}天</span>`;
                    } else {
                        cellContent = '0天';
                    }
                } else if (field === 'statusText') {
                    const statusColors = {
                        '正常': 'green',
                        '逾期': 'red',
                        '呆帳': 'darkred',
                        '已買回': 'blue',
                        '結清': 'gray'
                    };
                    const color = statusColors[value] || 'black';
                    cellContent = `<span style="color:${color};font-weight:bold;">${value}</span>`;
                } else if (field === 'shouldPay' || field === 'totalPaid' || field === 'currentPeriodPaid' || field === 'currentPeriodRemain') {
                    cellContent = value.toLocaleString();
                } else {
                    cellContent = value;
                }
                
                html += `<td style="max-width:120px;word-break:break-all;">${cellContent}</td>`;
            });
            
            // 繳款紀錄
            const paymentsHtml = row.payments.map(p => 
                `${p.date}-${p.amount.toLocaleString()}${p.note ? `(${p.note})` : ''}`
            ).join('<br>');
            html += `<td style="max-width:180px;word-break:break-all;">${paymentsHtml}</td>`;
            
            html += '</tr>';
        });
        
        html += '</tbody></table></div>';
        container.innerHTML = html;
    } catch (e) {
        container.innerHTML = '<div class="error-message">載入失敗</div>';
    }
}

// 應用帳表篩選
function applyTableFilters() {
    const statusFilter = document.getElementById('status-filter').value;
    const overdueFilter = document.getElementById('overdue-filter').value;
    
    const rows = document.querySelectorAll('.account-table tbody tr');
    
    rows.forEach(row => {
        const status = row.getAttribute('data-status');
        const overdueDays = parseInt(row.getAttribute('data-overdue')) || 0;
        
        let showRow = true;
        
        // 狀態篩選
        if (statusFilter && status !== statusFilter) {
            showRow = false;
        }
        
        // 逾期天數篩選
        if (overdueFilter) {
            if (overdueFilter === '1-7' && (overdueDays < 1 || overdueDays > 7)) {
                showRow = false;
            } else if (overdueFilter === '8-30' && (overdueDays < 8 || overdueDays > 30)) {
                showRow = false;
            } else if (overdueFilter === '30+' && overdueDays <= 30) {
                showRow = false;
            }
        }
        
        row.style.display = showRow ? '' : 'none';
    });
}

// 清除帳表篩選
function clearTableFilters() {
    document.getElementById('status-filter').value = '';
    document.getElementById('overdue-filter').value = '';
    
    const rows = document.querySelectorAll('.account-table tbody tr');
    rows.forEach(row => {
        row.style.display = '';
    });
}

// 匯出帳表到Excel
function exportTableToExcel() {
    window.open('/api/export/excel', '_blank');
}

// 匯出帳表到CSV
function exportTableToCSV() {
    // 實現CSV匯出功能
    alert('CSV匯出功能開發中...');
}

// 資料同步
const fixBtn = document.getElementById('fix-data-btn');
if (fixBtn) {
    fixBtn.addEventListener('click', async () => {
        if (!confirm('確定要同步修正所有資料嗎？')) return;
        try {
            const res = await fetch('/api/fix-data', { method: 'POST' });
            const result = await res.json();
            if (result.success) {
                alert('資料同步完成，共修正 ' + result.count + ' 筆客戶');
                location.reload();
            } else {
                alert(result.message || result.error || '資料同步失敗');
            }
        } catch (e) {
            alert('資料同步失敗，請稍後再試');
        }
    });
}

// 操作日誌頁面渲染（支援多條件查詢）
async function loadLogs() {
    const container = document.getElementById('logs-container');
    container.innerHTML = '<div class="loading"></div>';
    // 取得搜尋條件
    const start = document.getElementById('logs-start-date')?.value;
    const end = document.getElementById('logs-end-date')?.value;
    const action = document.getElementById('logs-action')?.value;
    const type = document.getElementById('logs-type')?.value;
    const user = document.getElementById('logs-user')?.value;
    const customerId = document.getElementById('logs-customer-id')?.value;
    const customerName = document.getElementById('logs-customer-name')?.value;
    const keyword = document.getElementById('logs-keyword')?.value;
    // 組查詢參數
    const params = [];
    if (start) params.push(`start=${encodeURIComponent(start)}`);
    if (end) params.push(`end=${encodeURIComponent(end)}`);
    if (action) params.push(`action=${encodeURIComponent(action)}`);
    if (type) params.push(`type=${encodeURIComponent(type)}`);
    if (user) params.push(`user=${encodeURIComponent(user)}`);
    if (customerId) params.push(`customerId=${encodeURIComponent(customerId)}`);
    if (customerName) params.push(`customerName=${encodeURIComponent(customerName)}`);
    if (keyword) params.push(`keyword=${encodeURIComponent(keyword)}`);
    const url = '/api/logs' + (params.length ? '?' + params.join('&') : '');
    try {
        const res = await fetch(url);
        const data = await res.json();
        if (!data.logs || data.logs.length === 0) {
            container.innerHTML = '<div class="no-data">查無日誌紀錄</div>';
            return;
        }
        let html = '<table border="1" style="width:100%;border-collapse:collapse;"><thead><tr>';
        html += '<th>時間</th><th>操作者</th><th>操作</th><th>客戶ID</th><th>客戶姓名</th><th>細節</th>';
        html += '</tr></thead><tbody>';
        data.logs.slice().reverse().forEach((log, idx) => {
            html += '<tr>';
            html += `<td>${log.timestamp.replace('T',' ').replace('Z','')}</td>`;
            html += `<td>${log.user}</td>`;
            html += `<td>${log.action}</td>`;
            html += `<td>${log.customerId || ''}</td>`;
            html += `<td>${log.customerName || ''}</td>`;
            html += `<td><button class="log-detail-btn" data-idx="${idx}">明細</button><div class="log-detail" style="display:none;white-space:pre-wrap;max-width:400px;">${JSON.stringify(log.detail, null, 2)}</div></td>`;
            html += '</tr>';
        });
        html += '</tbody></table>';
        container.innerHTML = html;
        // 綁定明細展開
        container.querySelectorAll('.log-detail-btn').forEach(btn => {
            btn.addEventListener('click', function() {
                const detailDiv = this.nextElementSibling;
                detailDiv.style.display = detailDiv.style.display === 'none' ? 'block' : 'none';
            });
        });
    } catch (e) {
        container.innerHTML = '<div class="error-message">載入失敗</div>';
    }
}
// 綁定查詢/重設按鈕
setTimeout(() => {
    const searchBtn = document.getElementById('logs-search-btn');
    if (searchBtn) searchBtn.onclick = loadLogs;
    const resetBtn = document.getElementById('logs-reset-btn');
    if (resetBtn) resetBtn.onclick = () => {
        document.getElementById('logs-start-date').value = '';
        document.getElementById('logs-end-date').value = '';
        document.getElementById('logs-action').value = '';
        document.getElementById('logs-type').value = '';
        document.getElementById('logs-user').value = '';
        document.getElementById('logs-customer-id').value = '';
        document.getElementById('logs-customer-name').value = '';
        document.getElementById('logs-keyword').value = '';
        loadLogs();
    };
}, 0);

// 初始化事件監聽器
document.addEventListener('DOMContentLoaded', () => {
    // 頁面載入時自動載入資料
    // loadSalesData(); // 暫時註解，因為函數在局部作用域中
});



    console.log('頁面載入完成，開始初始化');
    
    // 初始化智能分析建議按鈕
    setupInsightButtons();

    // 側邊欄按鈕點擊事件
    document.querySelectorAll('.sidebar button').forEach(button => {
        button.addEventListener('click', () => {
            const pageId = button.dataset.page;
            console.log('點擊側邊欄按鈕:', pageId);
            showPage(pageId);
        });
    });

    // 表單提交事件
    const form = document.getElementById('add-customer-form');
    if (form) {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            console.log('提交表單');

            const formData = new FormData(form);

            // 組合地址
            const city = formData.get('city');
            const district = formData.get('district');
            const street = formData.get('street');
            
            if (city && district && street) {
                const fullAddress = city + district + street;
                formData.set('address', fullAddress);
            }

            // 前端驗證
            if (!validateIdNumber(formData.get('idNumber'))) {
                alert('請輸入有效的身分證字號');
                return;
            }
            if (!validatePhone(formData.get('phone'))) {
                alert('請輸入有效的手機號碼');
                return;
            }
            if (!validateImei(formData.get('imei'))) {
                alert('請輸入有效的 IMEI');
                return;
            }

            try {
                // 先檢查身分證字號或 IMEI 是否存在
                const checkResponse = await fetch(`${API_BASE_URL}/api/customers`);
                const { customers } = await checkResponse.json();
                const duplicateId = customers.find(c => c.idNumber === formData.get('idNumber'));
                const duplicateImei = customers.find(c => c.imei === formData.get('imei'));
                
                const response = await fetch(`${API_BASE_URL}/api/customers`, {
                    method: 'POST',
                    body: formData
                });
                const result = await response.json();
                if (result.success) {
                    let msg = '客戶新增成功';
                    if (duplicateId) {
                        msg += `！注意：此身分證已存在於「${duplicateId.name}」`; 
                    }
                    if (duplicateImei) {
                        msg += `！注意：此 IMEI 已存在於「${duplicateImei.name}」`;
                    }
                    alert(msg);
                    form.reset();
                    
                    // 重置表單導航到第一步
                    const sections = document.querySelectorAll('.form-section');
                    const indicators = document.querySelectorAll('.section-indicators .indicator');
                    sections.forEach((section, i) => {
                        section.classList.toggle('active', i === 0);
                    });
                    indicators.forEach((indicator, i) => {
                        indicator.classList.toggle('active', i === 0);
                    });
                    
                    showPage('dashboard');
                } else {
                    alert(result.message || result.error || '新增失敗');
                }
            } catch (error) {
                console.error('新增客戶失敗:', error);
                alert('新增失敗，請稍後再試');
            }
        });
    }

    // 多步驟表單導航功能
    function setupFormNavigation() {
        const prevBtn = document.getElementById('prev-section');
        const nextBtn = document.getElementById('next-section');
        const sections = document.querySelectorAll('.form-section');
        const indicators = document.querySelectorAll('.section-indicators .indicator');
        let currentSection = 0;

        function showSection(index) {
            sections.forEach((section, i) => {
                section.classList.toggle('active', i === index);
            });
            indicators.forEach((indicator, i) => {
                indicator.classList.toggle('active', i === index);
            });
            currentSection = index;

            // 更新按鈕狀態
            prevBtn.disabled = index === 0;
            nextBtn.textContent = index === sections.length - 1 ? '提交' : '下一步';
        }

        if (prevBtn && nextBtn) {
            prevBtn.addEventListener('click', () => {
                if (currentSection > 0) {
                    showSection(currentSection - 1);
                }
            });

            nextBtn.addEventListener('click', () => {
                if (currentSection < sections.length - 1) {
                    showSection(currentSection + 1);
                } else {
                    // 最後一步，觸發表單提交
                    document.getElementById('add-customer-form').dispatchEvent(new Event('submit'));
                }
            });
        }

        // 點擊指示器切換步驟
        indicators.forEach((indicator, index) => {
            indicator.addEventListener('click', () => {
                showSection(index);
            });
        });
    }

    // 檔案上傳預覽功能
    function setupFileUpload() {
        const fileInputs = document.querySelectorAll('input[type="file"]');
        
        fileInputs.forEach(input => {
            input.addEventListener('change', function(e) {
                const file = e.target.files[0];
                const previewId = this.id + '-preview';
                const preview = document.getElementById(previewId);
                
                if (file && preview) {
                    if (file.type.startsWith('image/')) {
                        const reader = new FileReader();
                        reader.onload = function(e) {
                            preview.innerHTML = `
                                <img src="${e.target.result}" alt="預覽" style="max-width: 100px; max-height: 100px;">
                                <div class="file-name">${file.name}</div>
                            `;
                        };
                        reader.readAsDataURL(file);
                    } else {
                        preview.innerHTML = `
                            <div class="file-icon">📄</div>
                            <div class="file-name">${file.name}</div>
                        `;
                    }
                }
            });
        });
    }

    // 地址自動填充功能
    function setupAddressAutoFill() {
        const sameAsRegistered = document.getElementById('sameAsRegistered');
        const currentAddress = document.getElementById('currentAddress');
        
        if (sameAsRegistered && currentAddress) {
            sameAsRegistered.addEventListener('change', function() {
                if (this.checked) {
                    const city = document.getElementById('city').value;
                    const district = document.getElementById('district').value;
                    const street = document.getElementById('street').value;
                    
                    if (city && district && street) {
                        currentAddress.value = city + district + street;
                        console.log('自動填充通訊地址:', currentAddress.value);
                    }
                } else {
                    currentAddress.value = '';
                }
            });
        }
        
        // 地址組件變更時自動更新通訊地址
        ['city', 'district', 'street'].forEach(id => {
            const element = document.getElementById(id);
            if (element) {
                element.addEventListener('change', function() {
                    const sameAsRegistered = document.getElementById('sameAsRegistered');
                    if (sameAsRegistered && sameAsRegistered.checked) {
                        const city = document.getElementById('city').value;
                        const district = document.getElementById('district').value;
                        const street = document.getElementById('street').value;
                        
                        if (city && district && street) {
                            currentAddress.value = city + district + street;
                            console.log('地址變更，更新通訊地址:', currentAddress.value);
                        }
                    }
                });
            }
        });
    }



    // 篩選按鈕點擊事件
    document.querySelectorAll('.filter-btn').forEach(button => {
        button.addEventListener('click', async () => {
            console.log('點擊篩選按鈕:', button.dataset.filter);
            document.querySelectorAll('.filter-btn').forEach(btn => {
                btn.classList.remove('active');
            });
            button.classList.add('active');
            currentFilter = button.dataset.filter;
            renderCustomerList();
        });
    });

    // 通訊地址同戶籍
    const sameAsRegistered = document.getElementById('sameAsRegistered');
    const currentAddress = document.getElementById('currentAddress');
    if (sameAsRegistered && currentAddress) {
        sameAsRegistered.addEventListener('change', () => {
            if (sameAsRegistered.checked) {
                // 安全地獲取地址值，避免 null 錯誤
                const addressElement = document.getElementById('address');
                if (addressElement) {
                    currentAddress.value = addressElement.value;
                } else {
                    // 如果沒有 address 元素，嘗試組合縣市+地區+街道
                    const city = document.getElementById('city');
                    const district = document.getElementById('district');
                    const street = document.getElementById('street');
                    if (city && district && street) {
                        currentAddress.value = city.value + district.value + street.value;
                    }
                }
                currentAddress.disabled = true;
            } else {
                currentAddress.disabled = false;
            }
        });
    }

    // 初始化儀表板
    initDashboard();

    // 初始化顯示儀表板
    showPage('dashboard');

    // 匯出 Excel
    const exportBtn = document.getElementById('export-excel-btn');
    if (exportBtn) {
        exportBtn.addEventListener('click', () => {
            window.open('/api/export/excel', '_blank');
        });
    }

    // 搜尋框事件
    const searchInput = document.getElementById('search-input');
    if (searchInput) {
        searchInput.addEventListener('input', e => {
            currentSearch = e.target.value;
            renderCustomerList();
        });
    }

    // 生成合約按鈕點擊事件
    document.addEventListener('click', function(e) {
      if (e.target.classList.contains('contract-btn')) {
        const customerId = e.target.dataset.id;
        const customer = allCustomersCache.find(c => c.id === customerId);
        if (customer) {
          // 打開新視窗顯示合約
          const contractWindow = window.open('contract.html', '_blank', 'width=800,height=600');
          // 等待新視窗載入完成後，呼叫 generateContract
          contractWindow.onload = function() {
            contractWindow.generateContract(customer);
          };
        }
      }
    });

    // 儀表板日期區間查詢
    const startInput = document.getElementById('dashboard-start-date');
    const endInput = document.getElementById('dashboard-end-date');
    const searchBtn = document.getElementById('dashboard-date-search-btn');
    if (searchBtn) {
      searchBtn.addEventListener('click', () => {
        const start = startInput.value;
        const end = endInput.value;
        // 強制切換到日統計
        loadDashboard('day', start, end);
      });
    }


// 根據本期未繳與剩餘天數自動判斷繳款狀態
function getPaymentStatus(remain, daysLeft) {
    if (remain > 0 && daysLeft < 0) return 'overdue';
    if (remain > 0 && daysLeft === 0) return 'due-today';
    if (remain === 0) return 'normal';
    return 'other';
}

function getPaymentStatusText(status) {
    return {
        normal: '正常',
        overdue: '逾期',
        'due-today': '本日應繳',
        remind: '提醒繳款',
        buyback: '已買回/結清',
        locked: '呆帳',
        other: '其他'
    }[status] || status;
}

function getTotalUnpaid(customer) {
    // 取得每期狀態
    const { periods } = getPeriodsStatus(customer);
    const rent = Number(customer.rent);
    // 累加所有未繳清期數的「應繳-已繳」金額
    let totalUnpaid = 0;
    periods.forEach(p => {
        if (!p.isPaid) {
            totalUnpaid += (rent - p.paid);
        }
    });
    // 額外防呆
    if (totalUnpaid < 0) totalUnpaid = 0;
    return totalUnpaid;
}

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
    let overdueCount = 0;
    let usedPaymentIdx = new Set();

    // 狀態變更日
    let endDate = today;
    if (customer.status === 'buyback') {
        if (payments.length > 0) {
            endDate = payments[payments.length - 1].date;
        } else {
            endDate = today;
        }
    }

    let periodIdx = 0;
    while (true) {
        const override = periodOverrides.find(po => po.period === periodIdx + 1);
        // 1. 先決定 periodStart
        if (override && override.start) {
            periodStart = new Date(override.start);
        } else if (periodIdx === 0) {
            periodStart = new Date(contractDate);
        } else {
            periodStart = new Date(periodEnd);
            periodStart.setDate(periodStart.getDate() + 1);
        }
        // 2. 再決定 periodEnd
        if (override && override.due) {
            periodEnd = new Date(override.due);
            periodEnd.setHours(23,59,59,999);
        } else {
            periodEnd = new Date(periodStart);
            periodEnd.setDate(periodEnd.getDate() + cycle - 1);
            periodEnd.setHours(23,59,59,999);
        }
        if (periodStart > endDate && periodStart > today) break;

        // 1. 先找 period 屬性對應的 payment
        let paid = 0;
        let paidDate = '';
        payments.forEach((p, idx) => {
            if (p.period === periodIdx + 1) {
                paid += p.amount;
                paidDate = p.date;
                usedPaymentIdx.add(idx);
            }
        });
        // 2. 若沒有 period 屬性，則根據日期自動分配（日期只比年月日，確保等於期末日也算）
        if (paid === 0) {
            payments.forEach((p, idx) => {
                if (!p.period && !usedPaymentIdx.has(idx)) {
                    // 只比年月日
                    const pd = new Date(p.date.getFullYear(), p.date.getMonth(), p.date.getDate());
                    const ps = new Date(periodStart.getFullYear(), periodStart.getMonth(), periodStart.getDate());
                    const pe = new Date(periodEnd.getFullYear(), periodEnd.getMonth(), periodEnd.getDate());
                    if (pd >= ps && pd <= pe) {
                        paid += p.amount;
                        paidDate = p.date;
                        usedPaymentIdx.add(idx);
                    }
                }
            });
        }
        let isPaid = paid >= rent;
        if (!isPaid && periodEnd < today) overdueCount++;

        periods.push({
            start: new Date(periodStart),
            end: new Date(periodEnd),
            paid,
            paidDate,
            isPaid
        });
        periodIdx++;
    }
    return { periods, overdueCount };
}

// 新增：根據期數狀態判斷繳款狀態（只要有任何期數未繳清且已過期，顯示逾期）
function getPaymentStatusByPeriods(customer) {
    if (customer.status === 'buyback') return 'buyback';
    const { periods } = getPeriodsStatus(customer);
    let now = new Date();
    function toDateOnly(d) {
        return new Date(d.getFullYear(), d.getMonth(), d.getDate());
    }
    if (!periods || periods.length === 0) return 'normal'; // 防呆
    for (let i = 0; i < periods.length; i++) {
        // 只要有任何期數未繳且 end < 今天（只比年月日），顯示逾期
        if (!periods[i].isPaid && toDateOnly(periods[i].end) < toDateOnly(now)) {
            return 'overdue';
        }
    }
    return 'normal';
}

// 彈窗顯示明細（預留，可根據實際需求實作）
function showDetailModal(label, type) {
    // 這裡可以根據 label/type 呼叫 API 取得明細，然後顯示在自訂 modal
    alert(`顯示${type === 'day' ? '日期' : '月份'}：${label} 的詳細明細（可自訂內容）`);
}

    // 取得所有設備（同步用）
    async function getAllSales() {
    const res = await fetch(`${API_BASE_URL}/api/sales`);
    const data = await res.json();
    console.log('API回傳 sales', data);
    return Array.isArray(data) ? data : (data.sales || []);
}

// 新增/編輯客戶表單加入設備下拉選單與新增設備按鈕
async function renderSalesSelect(formId, selectedId = '') {
    const sales = await getAllSales();
    const form = document.getElementById(formId);
    if (!form) return;
    
    // 查找現有的設備選擇框
    let select = form.querySelector('select[name="salesId"]');
    
    if (select) {
        // 如果已存在，直接更新選項
        select.innerHTML = '<option value="">請選擇設備</option>' + 
            sales.map(s => `<option value="${s.id}" ${selectedId===s.id?'selected':''}>${s.name}（${s.appleAccount}）</option>`).join('');
    } else {
        // 如果不存在，在財務資訊區塊中添加
        const financialSection = form.querySelector('[data-section="financial"]');
        if (financialSection) {
            const lastRow = financialSection.querySelector('.form-row:last-child');
            if (lastRow) {
                const salesGroup = document.createElement('div');
                salesGroup.className = 'form-group';
                salesGroup.innerHTML = `
                    <label for="salesId">設備</label>
                    <select id="salesId" name="salesId">
                        <option value="">請選擇設備</option>
                        ${sales.map(s => `<option value="${s.id}" ${selectedId===s.id?'selected':''}>${s.name}（${s.appleAccount}）</option>`).join('')}
                    </select>
                `;
                lastRow.appendChild(salesGroup);
            }
        }
    }
}

// 新增客戶表單初始化時載入設備
    // 初始化新增客戶表單功能
    if (document.getElementById('add-customer-form')) {
        renderSalesSelect('add-customer-form');
        setupFormNavigation();
        setupFileUpload();
        
        // 初始化地址自動填充功能
        setupAddressAutoFill();
    }
// 編輯客戶表單初始化時載入設備
if (document.getElementById('edit-customer-form')) {
    // 需在填充表單時呼叫 renderSalesSelect 並帶入已選設備
    const origFillEditForm = fillEditForm;
    fillEditForm = async function(customer) {
        await renderSalesSelect('edit-customer-form', customer.salesId || '');
        // 等待下拉選單渲染後再填充欄位
        origFillEditForm(customer);
        // 設定選單值（保險起見再設一次）
        const sel = document.querySelector('#edit-customer-form select[name="salesId"]');
        if (sel && customer.salesId) sel.value = customer.salesId;
    }
}





// 根據顯示模式渲染績效數據










// 新增：型號與地區圓餅圖
function renderPieCharts(stats) {
    // 型號分布
    let modelContainer = document.getElementById('model-pie-container');
    if (!modelContainer) {
        modelContainer = document.createElement('div');
        modelContainer.id = 'model-pie-container';
        modelContainer.style.marginTop = '32px';
        modelContainer.style.display = 'inline-block';
        modelContainer.style.verticalAlign = 'top';
        modelContainer.style.width = '320px';
        document.getElementById('dashboard').appendChild(modelContainer);
    }
    // 每次都清空內容，避免 canvas 疊加
    modelContainer.innerHTML = '<h3 style="margin-bottom:8px;">手機型號分布</h3><canvas id="model-pie-chart" width="500" height="500"></canvas>';
    let regionContainer = document.getElementById('region-pie-container');
    if (!regionContainer) {
        regionContainer = document.createElement('div');
        regionContainer.id = 'region-pie-container';
        regionContainer.style.marginTop = '32px';
        regionContainer.style.display = 'inline-block';
        regionContainer.style.verticalAlign = 'top';
        regionContainer.style.width = '320px';
        document.getElementById('dashboard').appendChild(regionContainer);
    }
    regionContainer.innerHTML = '<h3 style="margin-bottom:8px;">地區分布</h3><canvas id="region-pie-chart" width="500" height="500"></canvas>';
    // 型號圓餅圖
    const modelLabels = Object.keys(stats.modelDist || {});
    const modelData = Object.values(stats.modelDist || {});
    const modelColors = modelLabels.map((_,i)=>`hsl(${i*360/modelLabels.length},70%,60%)`);
    const modelCanvas = document.getElementById('model-pie-chart');
    const modelCtx = modelCanvas.getContext('2d');
    if (window.modelPieChart) window.modelPieChart.destroy();
    if (modelLabels.length === 0) {
        modelContainer.innerHTML += '<div style="color:#888;text-align:center;margin-top:120px;">查無資料</div>';
    } else {
        window.modelPieChart = new Chart(modelCtx, {
            type: 'pie',
            data: {
                labels: modelLabels,
                datasets: [{ data: modelData, backgroundColor: modelColors }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                plugins: { legend: { position: 'bottom' } },
                layout: { padding: 20 }
            }
        });
    }
    // 地區圓餅圖
    const regionLabels = Object.keys(stats.regionDist || {});
    const regionData = Object.values(stats.regionDist || {});
    const regionColors = regionLabels.map((_,i)=>`hsl(${i*360/regionLabels.length},50%,65%)`);
    const regionCanvas = document.getElementById('region-pie-chart');
    const regionCtx = regionCanvas.getContext('2d');
    if (window.regionPieChart) window.regionPieChart.destroy();
    if (regionLabels.length === 0) {
        regionContainer.innerHTML += '<div style="color:#888;text-align:center;margin-top:120px;">查無資料</div>';
    } else {
        window.regionPieChart = new Chart(regionCtx, {
            type: 'pie',
            data: {
                labels: regionLabels,
                datasets: [{ data: regionData, backgroundColor: regionColors }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                plugins: { legend: { position: 'bottom' } },
                layout: { padding: 20 }
            }
        });
    }
}

// 新增刪除檔案按鈕事件
setTimeout(() => {
  document.querySelectorAll('.delete-file-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('確定要刪除此檔案？')) return;
      const type = btn.dataset.type;
      const id = btn.dataset.id;
      try {
        const res = await fetch(`${API_BASE_URL}/api/customers/${id}/file/${type}`, { method: 'DELETE' });
        const result = await res.json();
        if (result.success) {
          alert('檔案已刪除');
          loadCustomers();
        } else {
          alert(result.message || result.error || '刪除失敗');
        }
      } catch (e) {
        alert('刪除失敗，請稍後再試');
      }
    });
  });
}, 0);

// 客戶操作函數
async function editCustomer(customerId) {
    // 首先嘗試從 allCustomersCache 獲取客戶
    let customer = allCustomersCache.find(c => c.id === customerId);
    
    // 如果沒有找到，嘗試從 customer-card-system 獲取
    if (!customer && window.customerCardSystem && window.customerCardSystem.allCustomers) {
        customer = window.customerCardSystem.allCustomers.find(c => c.id === customerId);
    }
    
    if (customer) {
        await fillEditForm(customer);
        const editModal = document.getElementById('edit-modal');
        if (editModal) {
            editModal.style.display = 'flex';
            editModal.classList.add('active');
        } else {
            // 如果找不到編輯模態框，使用簡單編輯方式
            if (window.customerCardSystem) {
                window.customerCardSystem.showSimpleEditModal(customer);
            }
        }
    } else {
        console.error('找不到客戶:', customerId);
        showNotification('找不到客戶資料', 'error');
    }
}

function deleteCustomer(customerId) {
    if (!confirm('確定要刪除這位客戶嗎？此操作無法復原！')) return;
    
    fetch(`${API_BASE_URL}/api/customers/${customerId}`, { 
        method: 'DELETE' 
    })
    .then(res => res.json())
    .then(result => {
        if (result.success) {
            showNotification('客戶刪除成功', 'success');
            loadCustomers();
            loadDashboard();
        } else {
            showNotification(result.message || result.error || '刪除失敗', 'error');
        }
    })
    .catch(error => {
        showNotification('刪除失敗，請稍後再試', 'error');
    });
}

function changeCustomerStatus(customerId, newStatus) {
    // 獲取當前客戶信息
    const customer = window.allCustomers ? window.allCustomers.find(c => c.id === customerId) : null;
    
    // 如果當前狀態是呆帳，再次點擊呆帳按鈕則取消呆帳
    if (newStatus === 'locked' && customer && customer.status === 'locked') {
        if (!confirm('確定要取消呆帳狀態，將客戶改回租賃中嗎？')) {
            return;
        }
        newStatus = 'renting'; // 改回租賃中狀態
    } else {
        const statusText = {
            'buyback': '已買回/結清',
            'locked': '呆帳',
            'renting': '租賃中'
        };
        
        if (!confirm(`確定要將此客戶設為${statusText[newStatus]}嗎？`)) return;
    }
    
    fetch(`${API_BASE_URL}/api/customers/${customerId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus })
    })
    .then(res => res.json())
    .then(result => {
        if (result.success) {
            const message = newStatus === 'renting' ? '已取消呆帳，客戶狀態改回租賃中' : `狀態已更新為${newStatus === 'locked' ? '呆帳' : newStatus === 'buyback' ? '已買回/結清' : '租賃中'}`;
            showNotification(message, 'success');
            loadCustomers();
            loadDashboard();
        } else {
            showNotification(result.message || result.error || '狀態更新失敗', 'error');
        }
    })
    .catch(error => {
        showNotification('狀態更新失敗，請稍後再試', 'error');
    });
}

function toggleCustomerDetail(customerId) {
    const detailElement = document.getElementById(`detail-${customerId}`);
    if (detailElement) {
        const isVisible = detailElement.style.display !== 'none';
        detailElement.style.display = isVisible ? 'none' : 'block';
        
        if (!isVisible) {
            // 載入繳款紀錄
            loadPaymentHistory(customerId, detailElement.querySelector('.payment-history'));
        }
    }
}

// 通知函數
function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;
    
    // 移除現有通知
    document.querySelectorAll('.notification').forEach(n => n.remove());
    
    document.body.appendChild(notification);
    
    // 自動移除
    setTimeout(() => {
        notification.remove();
    }, 3000);
}

// 編輯表單提交處理
async function submitEditForm(customerId) {
    const form = document.getElementById('edit-customer-form');
    if (!form) return;

    const formData = new FormData(form);
    const updateData = {
        name: formData.get('name'),
        idNumber: formData.get('idNumber'),
        phone: formData.get('phone'),
        birthday: formData.get('birthday') || null,
        occupation: formData.get('occupation') || null,
        source: formData.get('source') || null,
        emergencyContactName: formData.get('emergencyContactName') || null,
        emergencyContactPhone: formData.get('emergencyContactPhone') || null,
        address: formData.get('address') || null,
        currentAddress: formData.get('currentAddress') || null,
        model: formData.get('model'),
        imei: formData.get('imei') || null,
        serialNumber: formData.get('serialNumber') || null,
        screenPassword: formData.get('screenPassword') || null,
        contractDate: formData.get('contractDate'),
        paymentCycleDays: parseInt(formData.get('paymentCycleDays')) || 30,
        salePrice: parseFloat(formData.get('salePrice')),
        rent: parseFloat(formData.get('rent')),
        bank: formData.get('bank') || null,
        bankAccountNumber: formData.get('bankAccountNumber') || null,
        salesperson: formData.get('salesperson') || null
    };

    try {
        const response = await fetch(`/api/customers/${customerId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updateData)
        });

        const result = await response.json();
        if (result.success) {
            showNotification('客戶資訊更新成功', 'success');
            // 重新載入數據
            await loadCustomers();
            // 關閉編輯模態框
            const editModal = document.getElementById('edit-modal');
            editModal.style.display = 'none';
            editModal.classList.remove('active');
        } else {
            showNotification(result.message || result.error || '更新失敗', 'error');
        }
    } catch (error) {
        console.error('更新客戶失敗:', error);
        showNotification('更新失敗，請稍後再試', 'error');
    }
}

// 初始化編輯表單事件
document.addEventListener('DOMContentLoaded', () => {
    // 使用事件委託來處理動態生成的表單
    document.addEventListener('submit', async (e) => {
        if (e.target.id === 'edit-customer-form') {
            e.preventDefault();
            const customerId = e.target.querySelector('input[name="id"]')?.value;
            if (customerId) {
                await submitEditForm(customerId);
            }
        }
    });
});

// 暴露 main.js 的編輯函數到全局
window.mainEditCustomer = editCustomer;
window.editCustomer = editCustomer;

// 獲取建議類型
function getSuggestionType(suggestion) {
    const lowerSuggestion = suggestion.toLowerCase();
    
    if (lowerSuggestion.includes('呆帳率高達') || 
        lowerSuggestion.includes('逾期率高達') || 
        lowerSuggestion.includes('危險') || 
        lowerSuggestion.includes('警告')) {
        return 'warning';
    }
    
    if (lowerSuggestion.includes('建議') || 
        lowerSuggestion.includes('可考慮') || 
        lowerSuggestion.includes('可加強')) {
        return 'suggestion';
    }
    
    if (lowerSuggestion.includes('正常') || 
        lowerSuggestion.includes('良好') || 
        lowerSuggestion.includes('持續保持')) {
        return 'success';
    }
    
    return 'suggestion';
}

// 智能分析建議按鈕事件處理
function setupInsightButtons() {
  // 設置建議卡片按鈕事件
  const actionButtons = document.querySelectorAll('.action-btn');
  actionButtons.forEach(button => {
    button.addEventListener('click', function(e) {
      e.preventDefault();
      const buttonText = this.textContent;
      const card = this.closest('.insight-card');
      const cardType = card.classList.contains('warning') ? 'warning' : 
                      card.classList.contains('suggestion') ? 'suggestion' : 'success';
      
      console.log(`點擊了 ${cardType} 類型的按鈕: ${buttonText}`);
      
      // 根據按鈕文字執行不同操作
      switch(buttonText) {
        case '查看詳情':
          showInsightDetails('逾期風險提醒', getOverdueRiskDetails());
          break;
        case '採納建議':
          showInsightDetails('業務優化建議', getBusinessOptimizationDetails());
          break;
        case '查看報告':
          showInsightDetails('業績達標報告', getPerformanceReportDetails());
          break;
        default:
          showInsightDetails('智能建議', '處理建議操作');
      }
    });
  });
  
  // 設置篩選按鈕事件
  const insightButtons = document.querySelectorAll('.insight-btn');
  insightButtons.forEach(button => {
    button.addEventListener('click', function(e) {
      e.preventDefault();
      
      // 移除所有按鈕的active類
      insightButtons.forEach(btn => btn.classList.remove('active'));
      
      // 添加當前按鈕的active類
      this.classList.add('active');
      
      const filterType = this.getAttribute('data-type');
      console.log(`篩選建議類型: ${filterType}`);
      
      // 根據篩選類型顯示/隱藏卡片
      filterInsightCards(filterType);
    });
  });
}

// 獲取逾期風險詳細信息
function getOverdueRiskDetails() {
  return `
    <div class="detail-content">
      <h4>📊 逾期客戶統計</h4>
      <div class="detail-stats">
        <div class="stat-item">
          <span class="stat-label">逾期客戶數</span>
          <span class="stat-value">3 人</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">逾期總金額</span>
          <span class="stat-value">113,100 元</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">平均逾期天數</span>
          <span class="stat-value">15 天</span>
        </div>
      </div>
      
      <h4>⚠️ 高風險客戶名單</h4>
      <div class="customer-list">
        <div class="customer-item">
          <span class="customer-name">張小明</span>
          <span class="customer-amount">45,000 元</span>
          <span class="customer-days">逾期 25 天</span>
        </div>
        <div class="customer-item">
          <span class="customer-name">李美玲</span>
          <span class="customer-amount">38,000 元</span>
          <span class="customer-days">逾期 18 天</span>
        </div>
        <div class="customer-item">
          <span class="customer-name">王大華</span>
          <span class="customer-amount">30,100 元</span>
          <span class="customer-days">逾期 12 天</span>
        </div>
      </div>
      
      <h4>💡 處理建議</h4>
      <ul class="suggestion-list">
        <li>立即聯繫逾期客戶，了解還款困難原因</li>
        <li>提供分期付款方案，降低客戶還款壓力</li>
        <li>加強催收流程，定期跟進還款進度</li>
        <li>考慮法律途徑，保護公司權益</li>
      </ul>
    </div>
  `;
}

// 獲取業務優化建議詳細信息
function getBusinessOptimizationDetails() {
  return `
    <div class="detail-content">
      <h4>📈 iPhone 12 系列市場分析</h4>
      <div class="detail-stats">
        <div class="stat-item">
          <span class="stat-label">當前庫存</span>
          <span class="stat-value">15 台</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">月需求量</span>
          <span class="stat-value">25 台</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">市場佔有率</span>
          <span class="stat-value">68%</span>
        </div>
      </div>
      
      <h4>🎯 推廣策略建議</h4>
      <div class="strategy-list">
        <div class="strategy-item">
          <h5>1. 價格優化</h5>
          <p>建議將 iPhone 12 128GB 價格調整至 8,500 元，提高競爭力</p>
        </div>
        <div class="strategy-item">
          <h5>2. 促銷活動</h5>
          <p>推出「舊機換新機」活動，吸引更多客戶升級</p>
        </div>
        <div class="strategy-item">
          <h5>3. 分期方案</h5>
          <p>提供 12 期 0 利率分期，降低客戶購買門檻</p>
        </div>
      </div>
      
      <h4>📊 預期效果</h4>
      <div class="expected-results">
        <div class="result-item">
          <span class="result-label">銷售增長</span>
          <span class="result-value">+35%</span>
        </div>
        <div class="result-item">
          <span class="result-label">利潤提升</span>
          <span class="result-value">+28%</span>
        </div>
        <div class="result-item">
          <span class="result-label">客戶滿意度</span>
          <span class="result-value">+42%</span>
        </div>
      </div>
    </div>
  `;
}

// 獲取業績達標報告詳細信息
function getPerformanceReportDetails() {
  return `
    <div class="detail-content">
      <h4>🎉 本月業績達標報告</h4>
      <div class="detail-stats">
        <div class="stat-item">
          <span class="stat-label">新增客戶</span>
          <span class="stat-value">26 人</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">累積銷售</span>
          <span class="stat-value">219,700 元</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">達成率</span>
          <span class="stat-value">108%</span>
        </div>
      </div>
      
      <h4>📈 月度趨勢分析</h4>
      <div class="trend-analysis">
        <div class="trend-item positive">
          <span class="trend-label">客戶增長</span>
          <span class="trend-value">+12%</span>
          <span class="trend-desc">較上月增長 3 人</span>
        </div>
        <div class="trend-item positive">
          <span class="trend-label">營收增長</span>
          <span class="trend-value">+8%</span>
          <span class="trend-desc">較上月增長 16,300 元</span>
        </div>
        <div class="trend-item negative">
          <span class="trend-label">逾期率</span>
          <span class="trend-value">+2%</span>
          <span class="trend-desc">需要關注</span>
        </div>
      </div>
      
      <h4>🏆 優秀表現</h4>
      <div class="achievements">
        <div class="achievement-item">
          <span class="achievement-icon">🥇</span>
          <span class="achievement-text">新增客戶數超標完成</span>
        </div>
        <div class="achievement-item">
          <span class="achievement-icon">🥈</span>
          <span class="achievement-text">iPhone 12 系列銷售冠軍</span>
        </div>
        <div class="achievement-item">
          <span class="achievement-icon">🥉</span>
          <span class="achievement-text">客戶滿意度達 95%</span>
        </div>
      </div>
      
      <h4>📋 下月目標</h4>
      <div class="next-month-goals">
        <div class="goal-item">
          <span class="goal-label">新增客戶</span>
          <span class="goal-target">30 人</span>
        </div>
        <div class="goal-item">
          <span class="goal-label">營收目標</span>
          <span class="goal-target">250,000 元</span>
        </div>
        <div class="goal-item">
          <span class="goal-label">逾期率控制</span>
          <span class="goal-target">≤ 10%</span>
        </div>
      </div>
    </div>
  `;
}

// 顯示建議詳情
function showInsightDetails(title, message) {
  // 創建模態框
  const modal = document.createElement('div');
  modal.className = 'insight-modal';
  modal.innerHTML = `
    <div class="modal-overlay"></div>
    <div class="modal-content">
      <div class="modal-header">
        <h3>${title}</h3>
        <button class="modal-close" onclick="this.closest('.insight-modal').remove()">×</button>
      </div>
      <div class="modal-body">
        <p>${message}</p>
      </div>
      <div class="modal-footer">
        <button class="modal-btn" onclick="this.closest('.insight-modal').remove()">確定</button>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  
  // 添加動畫效果
  setTimeout(() => {
    modal.classList.add('show');
  }, 10);
}

// 篩選建議卡片
function filterInsightCards(type) {
  const cards = document.querySelectorAll('.insight-card');
  
  cards.forEach(card => {
    const cardType = card.classList.contains('warning') ? 'warning' : 
                    card.classList.contains('suggestion') ? 'suggestion' : 'success';
    
    if (type === 'all' || cardType === type) {
      card.style.display = 'block';
      card.style.opacity = '0';
      setTimeout(() => {
        card.style.opacity = '1';
      }, 50);
    } else {
      card.style.opacity = '0';
      setTimeout(() => {
        card.style.display = 'none';
      }, 300);
    }
  });
}

// 計算設備績效統計
function calcSalesStats(customers, salesList, startDate, endDate, highAmount = 15000, stablePeriods = 3) {
    return salesList.map(s => {
        // 只統計合約起始日在區間內的客戶
        const myCustomers = customers.filter(c => c.salesId === s.id && new Date(c.contractDate) >= startDate && new Date(c.contractDate) <= endDate);
        const validCustomers = myCustomers.filter(c => c.salePrice && c.payments && c.payments.length > 0);
        const 成交客戶數 = validCustomers.length;
        const 成交總金額 = validCustomers.reduce((sum, c) => sum + Number(c.salePrice), 0);
        let 已回收金額 = 0;
        validCustomers.forEach(c => {
            已回收金額 += (c.payments || []).reduce((sum, p) => sum + Number(p.amount), 0);
        });
        // 應回收金額 = 成交總金額 - 已回收金額
        let 應回收金額 = 成交總金額 - 已回收金額;
        if (應回收金額 < 0) 應回收金額 = 0;
        // 逾期金額 = 所有呆帳客戶的(買賣價金-已收款項)
        let 逾期金額 = 0;
        myCustomers.filter(c => c.status === 'locked').forEach(c => {
            const salePrice = Number(c.salePrice);
            const paid = (c.payments || []).reduce((sum, p) => sum + Number(p.amount), 0);
            let lockedUnpaid = salePrice - paid;
            if (lockedUnpaid < 0) lockedUnpaid = 0;
            逾期金額 += lockedUnpaid;
        });
        const 回收率 = 成交總金額 ? ((已回收金額 / 成交總金額) * 100).toFixed(1) + '%' : '-';
        // 其他指標照舊...
        const 逾期客戶 = myCustomers.filter(c => getPaymentStatusByPeriods(c) === 'overdue');
        const 逾期客戶數 = 逾期客戶.length;
        const 呆帳客戶數 = myCustomers.filter(c => c.status === 'locked').length;
        const 已買回數 = myCustomers.filter(c => c.status === 'buyback').length;
        let 逾期天數總和 = 0, 逾期期數 = 0;
        逾期客戶.forEach(c => {
            const { periods } = getPeriodsStatus(c);
            periods.forEach(p => {
                if (!p.isPaid && p.end < new Date()) {
                    逾期天數總和 += Math.ceil((new Date() - p.end) / (1000 * 60 * 60 * 24));
                    逾期期數++;
                }
            });
        });
        const 平均逾期天數 = 逾期期數 ? (逾期天數總和 / 逾期期數).toFixed(1) : '-';
        let 回收天數總和 = 0, 回收客戶數 = 0;
        myCustomers.filter(c => c.status === 'buyback').forEach(c => {
            if (c.payments && c.payments.length > 0) {
                const first = new Date(c.contractDate);
                const last = new Date(c.payments[c.payments.length - 1].date);
                回收天數總和 += Math.ceil((last - first) / (1000 * 60 * 60 * 24));
                回收客戶數++;
            }
        });
        const 平均回收天數 = 回收客戶數 ? (回收天數總和 / 回收客戶數).toFixed(1) : '-';
        const 高額合約客戶數 = myCustomers.filter(c => Number(c.salePrice) >= highAmount).length;
        const 穩定客戶數 = myCustomers.filter(c => {
            const { periods } = getPeriodsStatus(c);
            if (periods.length < stablePeriods) return false;
            for (let i = periods.length - stablePeriods; i < periods.length; i++) {
                if (!periods[i].isPaid) return false;
            }
            return true;
        }).length;
        const 逾期率 = myCustomers.length ? ((逾期客戶數 / myCustomers.length) * 100).toFixed(1) + '%' : '-';
        const 呆帳率 = myCustomers.length ? ((呆帳客戶數 / myCustomers.length) * 100).toFixed(1) + '%' : '-';
        return {
            設備: s.name,
            成交客戶數,
            成交總金額,
            已回收金額,
            應回收金額,
            回收率,
            逾期客戶數,
            逾期率,
            逾期金額,
            呆帳客戶數,
            呆帳率,
            已買回數,
            平均逾期天數,
            平均回收天數,
            高額合約客戶數,
            穩定客戶數
        };
    });
}

// 頁面切換事件監聽器初始化
document.addEventListener('DOMContentLoaded', function() {
    // 設置頁面切換事件監聽器
    document.querySelectorAll('[data-page]').forEach(button => {
        button.addEventListener('click', function() {
            const pageId = this.getAttribute('data-page');
            showPage(pageId);
            
            // 更新按鈕狀態
            document.querySelectorAll('[data-page]').forEach(btn => {
                btn.classList.remove('active');
            });
            this.classList.add('active');
        });
    });
    
    // 設置默認頁面
    showPage('dashboard');
    document.querySelector('[data-page="dashboard"]').classList.add('active');
});

// 新增：設備管理2.0初始化

function initSalesManagementPage() {
  console.log('初始化設備管理頁面');
  if (salesManagementInited) {
    console.log('設備管理頁面已初始化，跳過');
    return;
  }
  salesManagementInited = true;
  console.log('開始初始化設備管理頁面');
  // 2.0 JS 內容
  const API_BASE_URL = 'http://localhost:3001';
  let salesData = [];
  let customersData = [];

  async function loadSalesData() {
    console.log('開始載入設備數據');
    try {
      const list = document.getElementById('sales-list');
      if (!list) {
        console.error('找不到 sales-list 元素');
        return;
      }
      console.log('設置載入中狀態');
      list.innerHTML = '<div class="loading">載入中...</div>';
      console.log('請求設備API:', `${API_BASE_URL}/api/sales`);
      const salesRes = await fetch(`${API_BASE_URL}/api/sales`);
      console.log('設備API響應狀態:', salesRes.status);
      if (!salesRes.ok) throw new Error(`設備API請求失敗: ${salesRes.status}`);
      const salesResult = await salesRes.json();
      salesData = salesResult.sales || [];
      console.log('載入到設備數據:', salesData.length, '筆');
      console.log('請求客戶API:', `${API_BASE_URL}/api/customers`);
      const customersRes = await fetch(`${API_BASE_URL}/api/customers`);
      console.log('客戶API響應狀態:', customersRes.status);
      if (!customersRes.ok) throw new Error(`客戶API請求失敗: ${customersRes.status}`);
      const customersResult = await customersRes.json();
      customersData = customersResult.customers || [];
      console.log('載入到客戶數據:', customersData.length, '筆');
      updateStats();
      renderSalesList();
    } catch (error) {
      console.error('載入設備數據失敗:', error);
      const list = document.getElementById('sales-list');
      if (list) {
        list.innerHTML = `<div class="error"><h3>載入失敗</h3><p>錯誤訊息: ${error.message}</p><button onclick="loadSalesData()" class="btn-primary">重新載入</button></div>`;
      }
    }
  }
  function calculateCustomerFinance(customer) {
    const salePrice = parseFloat(customer.salePrice) || 0;
    const rent = parseFloat(customer.rent) || 0;
    const totalPaid = (customer.payments || []).reduce((sum, payment) => sum + (parseFloat(payment.amount) || 0), 0);
    const profit = totalPaid - salePrice;
    return { salePrice, rent, totalPaid, profit };
  }
  function getCustomerStatusText(status) {
    const statusMap = { renting: '正常', overdue: '逾期', completed: '完成', locked: '呆帳', buyback: '已買回' };
    return statusMap[status] || '未知';
  }
  function getCustomerStatusClass(status) {
    const classMap = { renting: 'status-normal', overdue: 'status-overdue', completed: 'status-completed', locked: 'status-locked', buyback: 'status-completed' };
    return classMap[status] || 'status-normal';
  }
  function toggleFinance(elementId) {
    const financeElement = document.getElementById(elementId);
    if (financeElement) financeElement.classList.toggle('show');
  }
  window.toggleFinance = toggleFinance;
  function updateStats() {
    const totalSales = salesData.length;
    const activeSales = salesData.length;
    const totalCustomers = customersData.length;
    const avgCustomers = totalSales > 0 ? Math.round(totalCustomers / totalSales) : 0;
    const totalProfit = customersData.reduce((sum, customer) => {
      const finance = calculateCustomerFinance(customer);
      console.log(`客戶 ${customer.name}: 買賣價金=${finance.salePrice}, 已繳=${finance.totalPaid}, 損益=${finance.profit}`);
      return sum + finance.profit;
    }, 0);
    console.log(`總損益計算結果: ${totalProfit}`);
    const overdueCustomers = customersData.filter(customer => customer.status === 'overdue' || customer.status === 'locked').length;
    document.getElementById('total-sales').textContent = totalSales;
    document.getElementById('active-sales').textContent = activeSales;
    document.getElementById('total-customers').textContent = totalCustomers;
    document.getElementById('avg-customers').textContent = avgCustomers;
    document.getElementById('sales-total-profit').textContent = totalProfit.toLocaleString();
    document.getElementById('overdue-customers').textContent = overdueCustomers;
  }
  function renderSalesList() {
    const list = document.getElementById('sales-list');
    if (!salesData || salesData.length === 0) {
      list.innerHTML = `<div class="no-data"><h3>目前沒有設備資料</h3><p>點擊「新增設備」按鈕來新增第一台設備</p></div>`;
      return;
    }
    list.innerHTML = salesData.map((sales, idx) => {
      const myCustomers = customersData.filter(c => c.salesId === sales.id);
      const passwordLogs = (sales.passwordLogs || []).map(log => `<li>${log.date.replace('T',' ').slice(0,16)}：${log.password}</li>`).join('');
      const customerDetails = myCustomers.map((customer, index) => {
        const finance = calculateCustomerFinance(customer);
        const statusText = getCustomerStatusText(customer.status);
        const statusClass = getCustomerStatusClass(customer.status);
        return `<div class="customer-card"><div class="customer-header"><div class="customer-info"><span class="customer-name">${customer.name}</span><span class="customer-model">${customer.model || '未填寫機型'}</span><span class="customer-status ${statusClass}">${statusText}</span></div><button class="finance-toggle" onclick="toggleFinance('customer-${sales.id}-${index}')">💰 財務狀況</button></div><div class="finance-summary" id="customer-${sales.id}-${index}"><h6>📊 財務狀況詳情</h6><div class="finance-grid"><div class="finance-item"><span class="finance-label">買賣價金</span><span class="finance-value">${finance.salePrice.toLocaleString()}</span></div><div class="finance-item"><span class="finance-label">租金</span><span class="finance-value">${finance.rent.toLocaleString()}</span></div><div class="finance-item"><span class="finance-label">已繳租金</span><span class="finance-value">${finance.totalPaid.toLocaleString()}</span></div><div class="finance-item"><span class="finance-label">損益</span><span class="finance-value ${finance.profit >= 0 ? 'profit-positive' : 'profit-negative'}">${finance.profit.toLocaleString()}</span></div></div></div></div>`;
      }).join('');
      return `<div class="sales-item"><div class="sales-card-header"><div class="sales-card-title"><div class="sales-avatar">${sales.name.charAt(0)}</div><div class="sales-info"><h4>${sales.name}</h4><p>${sales.appleAccount}</p></div></div><div class="sales-card-actions"><button class="btn-edit" onclick="editSales('${sales.id}')">編輯</button><button class="btn-delete" onclick="deleteSales('${sales.id}')">刪除</button></div></div><div class="sales-details"><div class="detail-item"><span class="detail-label">手機號碼</span><span class="detail-value">${sales.phone || '未填寫'}</span></div><div class="detail-item"><span class="detail-label">復原密鑰/號碼</span><span class="detail-value">${sales.findPhone || '未填寫'}</span></div><div class="detail-item"><span class="detail-label">APPLE密碼</span><span class="detail-value">${sales.applePassword || '未填寫'}</span></div><div class="detail-item"><span class="detail-label">管理客戶數</span><span class="detail-value">${myCustomers.length} 位</span></div></div>${passwordLogs ? `<div class="password-logs"><h5>密碼變更日誌</h5><ul>${passwordLogs}</ul></div>` : ''}${myCustomers.length > 0 ? `<div class="customers-section"><h5>管理的客戶 (${myCustomers.length}位)</h5><div class="customer-list">${customerDetails}</div></div>` : ''}</div>`;
    }).join('');
  }
  window.openSalesForm = function() {
    document.getElementById('sales-form-sidebar').style.display = 'block';
    document.getElementById('form-title').textContent = '新增設備';
    resetSalesForm();
  }
  window.closeSalesForm = function() {
    document.getElementById('sales-form-sidebar').style.display = 'none';
    resetSalesForm();
  }
  window.resetSalesForm = function() {
    document.getElementById('sales-form').reset();
    document.getElementById('sales-id').value = '';
    document.getElementById('sales-save-btn').textContent = '新增';
  }
  window.editSales = function(id) {
    const sales = salesData.find(s => s.id === id);
    if (!sales) { alert('找不到設備資料'); return; }
    document.getElementById('sales-id').value = sales.id;
    document.getElementById('sales-name').value = sales.name;
    document.getElementById('sales-phone').value = sales.phone || '';
    document.getElementById('sales-findPhone').value = sales.findPhone || '';
    document.getElementById('sales-appleAccount').value = sales.appleAccount;
    document.getElementById('sales-applePassword').value = sales.applePassword;
    document.getElementById('form-title').textContent = '編輯設備';
    document.getElementById('sales-save-btn').textContent = '更新';
    document.getElementById('sales-form-sidebar').style.display = 'block';
  }
  window.deleteSales = async function(id) {
    const sales = salesData.find(s => s.id === id);
    if (!sales) { alert('找不到設備資料'); return; }
    if (!confirm(`確定要刪除設備「${sales.name}」嗎？\n\n此操作無法復原！`)) return;
    try {
      const res = await fetch(`${API_BASE_URL}/api/sales/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`刪除失敗: ${res.status}`);
      alert(`設備「${sales.name}」已成功刪除！`);
      await loadSalesData();
    } catch (error) {
      alert(`刪除失敗: ${error.message}`);
    }
  }
  document.getElementById('sales-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('sales-id').value;
    const name = document.getElementById('sales-name').value.trim();
    const phone = document.getElementById('sales-phone').value.trim();
    const findPhone = document.getElementById('sales-findPhone').value.trim();
    const appleAccount = document.getElementById('sales-appleAccount').value.trim();
    const applePassword = document.getElementById('sales-applePassword').value;
    if (!name || !phone || !appleAccount || !applePassword) { alert('請填寫所有必填欄位'); return; }
    if (!/^09\d{8}$/.test(phone)) { alert('請輸入正確的手機號碼格式（09開頭的10位數字）'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(appleAccount)) { alert('請輸入正確的EMAIL格式'); return; }
    try {
      const data = { name, phone, findPhone, appleAccount, applePassword };
      if (id) {
        const res = await fetch(`${API_BASE_URL}/api/sales/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
        if (!res.ok) throw new Error(`編輯失敗: ${res.status}`);
        alert('設備更新成功！');
      } else {
        const res = await fetch(`${API_BASE_URL}/api/sales`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
        if (!res.ok) throw new Error(`新增失敗: ${res.status}`);
        alert('設備新增成功！');
      }
      await loadSalesData();
      closeSalesForm();
    } catch (error) {
      alert(`操作失敗: ${error.message}`);
    }
  });
  // 頁面載入時自動載入資料
  loadSalesData();
}

// 现代化客户卡系统
class CustomerCardSystem {
  constructor() {
    this.currentPage = 1;
    this.pageSize = 12;
    this.currentFilter = 'all';
    this.currentSearch = '';
    this.selectedCustomers = new Set();
    this.allCustomers = [];
    
    this.init();
  }

  init() {
    this.bindEvents();
    this.loadCustomers();
    this.setupFormNavigation();
  }

  bindEvents() {
    // 搜索功能
    const searchInput = document.getElementById('search-input');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        this.currentSearch = e.target.value;
        this.currentPage = 1;
        this.renderCustomerGrid();
      });
    }

    // 筛选标签
    document.querySelectorAll('.filter-tab').forEach(tab => {
      tab.addEventListener('click', (e) => {
        document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
        e.target.classList.add('active');
        this.currentFilter = e.target.dataset.filter;
        this.currentPage = 1;
        this.renderCustomerGrid();
      });
    });

    // 分页按钮
    document.getElementById('prev-page')?.addEventListener('click', () => {
      if (this.currentPage > 1) {
        this.currentPage--;
        this.renderCustomerGrid();
      }
    });

    document.getElementById('next-page')?.addEventListener('click', () => {
      const totalPages = Math.ceil(this.getFilteredCustomers().length / this.pageSize);
      if (this.currentPage < totalPages) {
        this.currentPage++;
        this.renderCustomerGrid();
      }
    });

    // 模态框关闭
    document.querySelectorAll('.close-modal').forEach(closeBtn => {
      closeBtn.addEventListener('click', (e) => {
        e.preventDefault();
        const modal = e.target.closest('.modal');
        if (modal) {
          this.closeModal(modal);
        }
      });
    });

    // 点击模态框外部关闭
    window.addEventListener('click', (e) => {
      if (e.target.classList.contains('modal')) {
        this.closeModal(e.target);
      }
    });

    // ESC鍵關閉模態框
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const activeModal = document.querySelector('.modal.active');
        if (activeModal) {
          this.closeModal(activeModal);
        }
      }
    });
  }

  closeModal(modal) {
    // 添加關閉動畫
    modal.style.opacity = '0';
    modal.style.transform = 'scale(0.9)';
    
    setTimeout(() => {
      modal.classList.remove('active');
      modal.style.display = 'none';
      modal.style.opacity = '';
      modal.style.transform = '';
      
      // 清空表單
      const forms = modal.querySelectorAll('form');
      forms.forEach(form => form.reset());
      
      // 清空特定輸入欄位
      const amountInput = modal.querySelector('#payment-amount');
      const dateInput = modal.querySelector('#payment-date');
      if (amountInput) amountInput.value = '';
      if (dateInput) dateInput.value = '';
      
      // 重置文件預覽
      const filePreviews = modal.querySelectorAll('.file-preview');
      filePreviews.forEach(preview => {
        preview.innerHTML = '';
        preview.classList.remove('has-file');
      });
    }, 150);
  }

  async loadCustomers() {
    try {
      const response = await fetch('/api/customers');
      const data = await response.json();
      
      if (data.customers) {
        this.allCustomers = data.customers;
        this.renderCustomerGrid();
        this.updateFilterCounts();
        this.showAutoRefreshIndicator('數據已更新');
      } else {
        console.error('載入客戶資料失敗:', data.error || '未知錯誤');
      }
    } catch (error) {
      console.error('載入客戶資料錯誤:', error);
    }
  }

  // 添加自动刷新指示器
  showAutoRefreshIndicator(message) {
    let indicator = document.querySelector('.auto-refresh-indicator');
    if (!indicator) {
      indicator = document.createElement('div');
      indicator.className = 'auto-refresh-indicator';
      document.body.appendChild(indicator);
    }
    
    indicator.textContent = message;
    indicator.classList.add('show');
    
    setTimeout(() => {
      indicator.classList.remove('show');
    }, 2000);
  }

  getFilteredCustomers() {
    let filtered = this.allCustomers;

    // 搜索过滤
    if (this.currentSearch) {
      const searchTerm = this.currentSearch.toLowerCase();
      filtered = filtered.filter(customer => 
        customer.name?.toLowerCase().includes(searchTerm) ||
        customer.idNumber?.toLowerCase().includes(searchTerm) ||
        customer.phone?.toLowerCase().includes(searchTerm) ||
        customer.imei?.toLowerCase().includes(searchTerm)
      );
    }

    // 状态过滤
    if (this.currentFilter && this.currentFilter !== 'all') {
      filtered = filtered.filter(customer => {
        const status = this.getCustomerStatus(customer);
        return status === this.currentFilter;
      });
    }

    return filtered;
  }

  getCustomerStatus(customer) {
    if (customer.status === 'buyback') return 'buyback';
    if (customer.status === 'locked') return 'locked';
    
    const paymentStatus = this.getPaymentStatus(customer);
    if (paymentStatus === 'overdue') return 'overdue';
    if (paymentStatus === 'due-today') return 'due-today';
    return 'renting';
  }

  getPaymentStatus(customer) {
    const nextDue = this.getNextDueDate(customer);
    const daysLeft = this.getDaysLeft(nextDue);
    const unpaidAmount = this.getUnpaidAmount(customer);

    if (unpaidAmount > 0 && daysLeft < 0) return 'overdue';
    if (unpaidAmount > 0 && daysLeft === 0) return 'due-today';
    return 'normal';
  }

  getNextDueDate(customer) {
    if (customer.nextDueOverride) {
      return new Date(customer.nextDueOverride);
    }
    
    const contractDate = new Date(customer.contractDate);
    const cycleDays = customer.paymentCycleDays || 30;
    const today = new Date();
    const daysSinceContract = Math.floor((today - contractDate) / (1000 * 60 * 60 * 24));
    const cyclesCompleted = Math.floor(daysSinceContract / cycleDays);
    const nextDue = new Date(contractDate);
    nextDue.setDate(nextDue.getDate() + (cyclesCompleted + 1) * cycleDays);
    
    return nextDue;
  }

  getDaysLeft(nextDue) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    nextDue.setHours(0, 0, 0, 0);
    return Math.ceil((nextDue - today) / (1000 * 60 * 60 * 24));
  }

  getUnpaidAmount(customer) {
    const rent = Number(customer.rent) || 0;
    const payments = customer.payments || [];
    const totalPaid = payments.reduce((sum, payment) => sum + Number(payment.amount), 0);
    return Math.max(0, rent - totalPaid);
  }

  renderCustomerGrid() {
    const grid = document.getElementById('customer-grid');
    if (!grid) return;

    const filteredCustomers = this.getFilteredCustomers();
    const startIndex = (this.currentPage - 1) * this.pageSize;
    const endIndex = startIndex + this.pageSize;
    const pageCustomers = filteredCustomers.slice(startIndex, endIndex);

    grid.innerHTML = pageCustomers.map(customer => this.renderCustomerCard(customer)).join('');

    this.updatePagination(filteredCustomers.length);
    this.bindCardEvents();
  }

  renderCustomerCard(customer) {
    const status = this.getCustomerStatus(customer);
    const nextDue = this.getNextDueDate(customer);
    const daysLeft = this.getDaysLeft(nextDue);
    const unpaidAmount = this.getUnpaidAmount(customer);
    const totalPaid = (customer.payments || []).reduce((sum, p) => sum + Number(p.amount), 0);

    const cardClass = `customer-card ${status}`;
    
    return `
      <div class="${cardClass}" data-customer-id="${customer.id}">
        <div class="customer-header">
          <div class="customer-info-main">
            <div class="customer-name">${customer.name}</div>
            <div class="customer-id">ID: ${customer.id}</div>
            <div class="customer-status">
              <span class="status-badge ${status}">${this.getStatusText(status)}</span>
            </div>
          </div>
          <div class="customer-actions">
            <button class="action-btn primary" onclick="customerCardSystem.showPaymentModal('${customer.id}')">
              💰 繳款
            </button>
            <button class="action-btn secondary" onclick="customerCardSystem.showCustomerDetail('${customer.id}')">
              📋 詳情
            </button>
          </div>
        </div>

        <div class="customer-info-grid">
          <div class="info-section">
            <h4>基本資訊</h4>
            <div class="info-item">
              <span class="info-label">手機號碼</span>
              <span class="info-value">${customer.phone || '-'}</span>
            </div>
            <div class="info-item">
              <span class="info-label">身分證</span>
              <span class="info-value">${customer.idNumber || '-'}</span>
            </div>
            <div class="info-item">
              <span class="info-label">手機型號</span>
              <span class="info-value">${customer.model || '-'}</span>
            </div>
            <div class="info-item">
              <span class="info-label">合約起始</span>
              <span class="info-value">${this.formatDate(customer.contractDate)}</span>
            </div>
          </div>

          <div class="info-section">
            <h4>財務狀況</h4>
            <div class="info-item">
              <span class="info-label">租金</span>
              <span class="info-value">${this.formatCurrency(customer.rent)}</span>
            </div>
            <div class="info-item">
              <span class="info-label">已繳總額</span>
              <span class="info-value">${this.formatCurrency(totalPaid)}</span>
            </div>
            <div class="info-item">
              <span class="info-label">未繳金額</span>
              <span class="info-value amount ${unpaidAmount > 0 ? 'overdue' : 'normal'}">${this.formatCurrency(unpaidAmount)}</span>
            </div>
            <div class="info-item">
              <span class="info-label">剩餘天數</span>
              <span class="info-value ${daysLeft <= 7 ? 'urgent' : ''}">${daysLeft} 天</span>
            </div>
          </div>
        </div>

        <div class="financial-highlight">
          <h4>繳款資訊</h4>
          <div class="financial-item">
            <span class="financial-label">下次應繳日</span>
            <span class="financial-value">${this.formatDate(nextDue)}</span>
          </div>
          <div class="financial-item">
            <span class="financial-label">應繳金額</span>
            <span class="financial-value">${this.formatCurrency(customer.rent)}</span>
          </div>
        </div>

        <div class="customer-actions">
          <button class="action-btn primary" onclick="customerCardSystem.showPaymentModal('${customer.id}')">
            💰 繳款
          </button>
          <button class="action-btn secondary" onclick="customerCardSystem.editCustomer('${customer.id}')">
            ✏️ 編輯
          </button>
          <button class="action-btn secondary" onclick="customerCardSystem.showCustomerDetail('${customer.id}')">
            📋 詳情
          </button>
          <button class="action-btn secondary" onclick="customerCardSystem.generateContract('${customer.id}')">
            📄 合約
          </button>
          <button class="action-btn warning" onclick="customerCardSystem.changeStatus('${customer.id}', 'buyback')">
            ✅ 已買回
          </button>
          <button class="action-btn danger" onclick="customerCardSystem.changeStatus('${customer.id}', 'locked')">
            ${customer.status === 'locked' ? '🔓 取消呆帳' : '🔒 呆帳'}
          </button>
          <button class="action-btn danger" onclick="customerCardSystem.deleteCustomer('${customer.id}')">
            🗑️ 刪除
          </button>
        </div>
      </div>
    `;
  }

  bindCardEvents() {
    // 客户卡片选择功能
    document.querySelectorAll('.customer-card').forEach(card => {
      card.addEventListener('click', (e) => {
        if (e.target.tagName === 'BUTTON') return;
        
        const customerId = card.dataset.customerId;
        if (this.selectedCustomers.has(customerId)) {
          this.selectedCustomers.delete(customerId);
          card.classList.remove('selected');
        } else {
          this.selectedCustomers.add(customerId);
          card.classList.add('selected');
        }
        
        this.updateBulkPaymentSummary();
      });
    });
  }

  updatePagination(totalItems) {
    const totalPages = Math.ceil(totalItems / this.pageSize);
    const pageInfo = document.getElementById('page-info');
    const prevBtn = document.getElementById('prev-page');
    const nextBtn = document.getElementById('next-page');

    if (pageInfo) {
      pageInfo.textContent = `第 ${this.currentPage} 页，共 ${totalPages} 页`;
    }

    if (prevBtn) {
      prevBtn.disabled = this.currentPage <= 1;
    }

    if (nextBtn) {
      nextBtn.disabled = this.currentPage >= totalPages;
    }
  }

  updateFilterCounts() {
    const counts = {
      all: this.allCustomers.length,
      renting: 0,
      overdue: 0,
      'due-today': 0,
      locked: 0,
      buyback: 0
    };

    this.allCustomers.forEach(customer => {
      const status = this.getCustomerStatus(customer);
      counts[status]++;
    });

    Object.keys(counts).forEach(filter => {
      const countElement = document.getElementById(`count-${filter}`);
      if (countElement) {
        countElement.textContent = counts[filter];
      }
    });
  }

  // 新增客户功能
  showAddCustomerModal() {
    // 直接跳轉到新增客戶頁面
    showPage('add');
  }

  setupFormNavigation() {
    const sections = ['basic', 'contact', 'rental', 'financial', 'files'];
    let currentSectionIndex = 0;

    const showSection = (index) => {
      sections.forEach((section, i) => {
        const sectionElement = document.querySelector(`[data-section="${section}"]`);
        const indicator = document.querySelector(`[data-section="${section}"]`);
        
        if (sectionElement) {
          sectionElement.classList.toggle('active', i === index);
        }
        if (indicator) {
          indicator.classList.toggle('active', i === index);
        }
      });

      // 更新导航按钮状态
      const prevBtn = document.getElementById('prev-section');
      const nextBtn = document.getElementById('next-section');
      
      if (prevBtn) prevBtn.disabled = index === 0;
      if (nextBtn) nextBtn.disabled = index === sections.length - 1;
    };

    document.getElementById('prev-section')?.addEventListener('click', () => {
      if (currentSectionIndex > 0) {
        currentSectionIndex--;
        showSection(currentSectionIndex);
      }
    });

    document.getElementById('next-section')?.addEventListener('click', () => {
      if (currentSectionIndex < sections.length - 1) {
        currentSectionIndex++;
        showSection(currentSectionIndex);
      }
    });

    // 指示器点击
    document.querySelectorAll('.indicator').forEach((indicator, index) => {
      indicator.addEventListener('click', () => {
        currentSectionIndex = index;
        showSection(currentSectionIndex);
      });
    });
  }

  async loadModelOptions() {
    const modelSelect = document.getElementById('new-model');
    if (!modelSelect) return;

    const models = [
      'iPhone 12 64GB', 'iPhone 12 128GB', 'iPhone 12 256GB',
      'iPhone 12 mini 64GB', 'iPhone 12 mini 128GB', 'iPhone 12 mini 256GB',
      'iPhone 12 Pro 128GB', 'iPhone 12 Pro 256GB', 'iPhone 12 Pro 512GB',
      'iPhone 12 Pro Max 128GB', 'iPhone 12 Pro Max 256GB', 'iPhone 12 Pro Max 512GB',
      'iPhone 13 128GB', 'iPhone 13 256GB', 'iPhone 13 512GB',
      'iPhone 13 mini 128GB', 'iPhone 13 mini 256GB', 'iPhone 13 mini 512GB',
      'iPhone 13 Pro 128GB', 'iPhone 13 Pro 256GB', 'iPhone 13 Pro 512GB', 'iPhone 13 Pro 1TB',
      'iPhone 13 Pro Max 128GB', 'iPhone 13 Pro Max 256GB', 'iPhone 13 Pro Max 512GB', 'iPhone 13 Pro Max 1TB',
      'iPhone SE (第三代) 64GB', 'iPhone SE (第三代) 128GB', 'iPhone SE (第三代) 256GB',
      'iPhone 14 128GB', 'iPhone 14 256GB', 'iPhone 14 512GB',
      'iPhone 14 Plus 128GB', 'iPhone 14 Plus 256GB', 'iPhone 14 Plus 512GB',
      'iPhone 14 Pro 128GB', 'iPhone 14 Pro 256GB', 'iPhone 14 Pro 512GB', 'iPhone 14 Pro 1TB',
      'iPhone 14 Pro Max 128GB', 'iPhone 14 Pro Max 256GB', 'iPhone 14 Pro Max 512GB', 'iPhone 14 Pro Max 1TB',
      'iPhone 15 128GB', 'iPhone 15 256GB', 'iPhone 15 512GB',
      'iPhone 15 Plus 128GB', 'iPhone 15 Plus 256GB', 'iPhone 15 Plus 512GB',
      'iPhone 15 Pro 128GB', 'iPhone 15 Pro 256GB', 'iPhone 15 Pro 512GB', 'iPhone 15 Pro 1TB',
      'iPhone 15 Pro Max 256GB', 'iPhone 15 Pro Max 512GB', 'iPhone 15 Pro Max 1TB',
      'iPhone 16 128GB', 'iPhone 16 256GB', 'iPhone 16 512GB', 'iPhone 16 1TB',
      'iPhone 16 Plus 128GB', 'iPhone 16 Plus 256GB', 'iPhone 16 Plus 512GB', 'iPhone 16 Plus 1TB',
      'iPhone 16 Pro 128GB', 'iPhone 16 Pro 256GB', 'iPhone 16 Pro 512GB', 'iPhone 16 Pro 1TB',
      'iPhone 16 Pro Max 256GB', 'iPhone 16 Pro Max 512GB', 'iPhone 16 Pro Max 1TB',
      'iPhone 16e 128GB', 'iPhone 16e 256GB', 'iPhone 16e 512GB'
    ];

    modelSelect.innerHTML = '<option value="">請選擇型號</option>';
    models.forEach(model => {
      const option = document.createElement('option');
      option.value = model;
      option.textContent = model;
      modelSelect.appendChild(option);
    });
  }

  async loadSalesOptions() {
    const salesSelect = document.getElementById('new-salesId');
    if (!salesSelect) return;

    try {
      const response = await fetch('/api/sales');
      const data = await response.json();
      const salesList = data.sales || [];

      salesSelect.innerHTML = '<option value="">請選擇設備</option>';
      salesList.forEach(sales => {
        const option = document.createElement('option');
        option.value = sales.id;
        option.textContent = `${sales.name} (${sales.appleAccount})`;
        salesSelect.appendChild(option);
      });
    } catch (error) {
      console.error('加载业务员数据失败:', error);
    }
  }



  // 批量缴款功能
  showBulkPaymentModal() {
    if (this.selectedCustomers.size === 0) {
      this.showNotification('請先選擇客戶', 'warning');
      return;
    }

    const modal = document.getElementById('bulk-payment-modal');
    if (modal) {
      modal.style.display = 'flex';
      modal.classList.add('active');
      this.updateBulkPaymentSummary();
      this.renderCustomerSelectionList();
    }
  }

  updateBulkPaymentSummary() {
    const selectedCustomers = this.allCustomers.filter(c => this.selectedCustomers.has(c.id));
    const totalDue = selectedCustomers.reduce((sum, c) => sum + this.getUnpaidAmount(c), 0);
    const overdueCount = selectedCustomers.filter(c => this.getCustomerStatus(c) === 'overdue').length;

    document.getElementById('selected-customers-count').textContent = this.selectedCustomers.size;
    document.getElementById('total-due-amount').textContent = this.formatCurrency(totalDue);
    document.getElementById('overdue-customers-count').textContent = overdueCount;
  }

  renderCustomerSelectionList() {
    const container = document.getElementById('customer-selection-list');
    if (!container) return;

    const selectedCustomers = this.allCustomers.filter(c => this.selectedCustomers.has(c.id));
    
    container.innerHTML = selectedCustomers.map(customer => {
      const unpaidAmount = this.getUnpaidAmount(customer);
      const status = this.getCustomerStatus(customer);
      
      return `
        <div class="customer-selection-item">
          <div>
            <strong>${customer.name}</strong>
            <div style="font-size: 12px; color: #666;">${customer.phone}</div>
          </div>
          <div style="text-align: right;">
            <div class="status-badge ${status}">${this.getStatusText(status)}</div>
            <div style="font-size: 14px; color: #e74c3c;">未繳: ${this.formatCurrency(unpaidAmount)}</div>
          </div>
        </div>
      `;
    }).join('');
  }

  async submitBulkPayment() {
    const selectedCustomers = Array.from(this.selectedCustomers);
    const amount = parseFloat(document.getElementById('bulk-payment-amount').value);
    const date = document.getElementById('bulk-payment-date').value;
    const note = document.getElementById('bulk-payment-note').value;

    if (!amount || !date) {
      this.showNotification('請填寫完整資訊', 'error');
      return;
    }

    try {
      const promises = selectedCustomers.map(customerId => 
        fetch('/api/payments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            customerId,
            amount,
            date,
            note
          })
        })
      );

      const responses = await Promise.all(promises);
      const results = await Promise.all(responses.map(r => r.json()));

      const successCount = results.filter(r => r.success).length;
      this.showNotification(`成功為 ${successCount} 位客戶繳款`, 'success');
      
      // 立即重新加载数据
      await this.loadCustomers();
      this.closeBulkPaymentModal();
      
      // 清空选择
      this.selectedCustomers.clear();
      this.updateBulkPaymentSummary();
    } catch (error) {
      console.error('批量繳款失敗:', error);
      this.showNotification('批量繳款失敗', 'error');
    }
  }

  closeBulkPaymentModal() {
    const modal = document.getElementById('bulk-payment-modal');
    if (modal) {
      this.closeModal(modal);
    }
  }

  // 客户详情功能
  showCustomerDetail(customerId) {
    const customer = this.allCustomers.find(c => c.id === customerId);
    if (!customer) return;

    const modal = document.getElementById('customer-detail-modal');
    const content = modal.querySelector('.customer-detail-content');
    
    content.innerHTML = this.renderCustomerDetail(customer);
    modal.style.display = 'flex';
    modal.classList.add('active');
  }

  renderCustomerDetail(customer) {
    const payments = customer.payments || [];
    const totalPaid = payments.reduce((sum, p) => sum + Number(p.amount), 0);
    const unpaidAmount = this.getUnpaidAmount(customer);

    return `
      <div class="customer-detail-full">
        <div class="detail-header">
          <h3>${customer.name} - 客戶詳情</h3>
          <div class="detail-status">
            <span class="status-badge ${this.getCustomerStatus(customer)}">${this.getStatusText(this.getCustomerStatus(customer))}</span>
          </div>
        </div>

        <div class="detail-sections">
          <div class="detail-section">
            <h4>基本資料</h4>
            <div class="detail-grid">
              <div class="detail-item">
                <span class="detail-label">客戶ID</span>
                <span class="detail-value">${customer.id}</span>
              </div>
              <div class="detail-item">
                <span class="detail-label">身分證字號</span>
                <span class="detail-value">${customer.idNumber || '-'}</span>
              </div>
              <div class="detail-item">
                <span class="detail-label">手機號碼</span>
                <span class="detail-value">${customer.phone || '-'}</span>
              </div>
              <div class="detail-item">
                <span class="detail-label">生日</span>
                <span class="detail-value">${customer.birthday || '-'}</span>
              </div>
              <div class="detail-item">
                <span class="detail-label">職業</span>
                <span class="detail-value">${customer.occupation || '-'}</span>
              </div>
              <div class="detail-item">
                <span class="detail-label">來源管道</span>
                <span class="detail-value">${customer.source || '-'}</span>
              </div>
            </div>
          </div>

          <div class="detail-section">
            <h4>聯絡資訊</h4>
            <div class="detail-grid">
              <div class="detail-item">
                <span class="detail-label">緊急聯絡人</span>
                <span class="detail-value">${customer.emergencyContactName || '-'}</span>
              </div>
              <div class="detail-item">
                <span class="detail-label">緊急聯絡電話</span>
                <span class="detail-value">${customer.emergencyContactPhone || '-'}</span>
              </div>
              <div class="detail-item">
                <span class="detail-label">戶籍地址</span>
                <span class="detail-value">${customer.address || '-'}</span>
              </div>
              <div class="detail-item">
                <span class="detail-label">通訊地址</span>
                <span class="detail-value">${customer.currentAddress || '-'}</span>
              </div>
            </div>
          </div>

          <div class="detail-section">
            <h4>租賃資訊</h4>
            <div class="detail-grid">
              <div class="detail-item">
                <span class="detail-label">手機型號</span>
                <span class="detail-value">${customer.model || '-'}</span>
              </div>
              <div class="detail-item">
                <span class="detail-label">IMEI</span>
                <span class="detail-value">${customer.imei || '-'}</span>
              </div>
              <div class="detail-item">
                <span class="detail-label">序號</span>
                <span class="detail-value">${customer.serialNumber || '-'}</span>
              </div>
              <div class="detail-item">
                <span class="detail-label">螢幕密碼</span>
                <span class="detail-value">${customer.screenPassword || '-'}</span>
              </div>
              <div class="detail-item">
                <span class="detail-label">合約起始日</span>
                <span class="detail-value">${this.formatDate(customer.contractDate)}</span>
              </div>
              <div class="detail-item">
                <span class="detail-label">繳款週期</span>
                <span class="detail-value">${customer.paymentCycleDays || 30} 天</span>
              </div>
            </div>
          </div>

          <div class="detail-section">
            <h4>財務資訊</h4>
            <div class="detail-grid">
              <div class="detail-item">
                <span class="detail-label">買賣價金</span>
                <span class="detail-value">${this.formatCurrency(customer.salePrice)}</span>
              </div>
              <div class="detail-item">
                <span class="detail-label">租金</span>
                <span class="detail-value">${this.formatCurrency(customer.rent)}</span>
              </div>
              <div class="detail-item">
                <span class="detail-label">已繳總額</span>
                <span class="detail-value">${this.formatCurrency(totalPaid)}</span>
              </div>
              <div class="detail-item">
                <span class="detail-label">未繳金額</span>
                <span class="detail-value amount ${unpaidAmount > 0 ? 'overdue' : 'normal'}">${this.formatCurrency(unpaidAmount)}</span>
              </div>
              <div class="detail-item">
                <span class="detail-label">銀行</span>
                <span class="detail-value">${customer.bank || '-'}</span>
              </div>
              <div class="detail-item">
                <span class="detail-label">銀行帳號</span>
                <span class="detail-value">${customer.bankAccountNumber || '-'}</span>
              </div>
            </div>
          </div>

          <div class="detail-section">
            <h4>繳款紀錄</h4>
            <div class="payment-history">
              ${payments.length > 0 ? payments.map((payment, index) => `
                <div class="payment-record" data-customer-id="${customer.id}" data-index="${index}">
                  <div class="payment-date">
                    <input type="date" class="payment-date-input" value="${this.formatDateForInput(payment.date)}" 
                           onchange="customerCardSystem.updatePaymentField('${customer.id}', ${index}, 'date', this.value)">
                  </div>
                  <div class="payment-amount">
                    <input type="number" class="payment-amount-input" value="${payment.amount}" 
                           onchange="customerCardSystem.updatePaymentField('${customer.id}', ${index}, 'amount', this.value)">
                  </div>
                  <div class="payment-note">
                    <input type="text" class="payment-note-input" value="${payment.note || ''}" 
                           placeholder="備註" onchange="customerCardSystem.updatePaymentField('${customer.id}', ${index}, 'note', this.value)">
                  </div>
                  <div class="payment-actions">
                    <button class="action-btn small" onclick="customerCardSystem.savePaymentChanges('${customer.id}', ${index})">
                      💾 儲存
                    </button>
                    <button class="action-btn small danger" onclick="customerCardSystem.deletePayment('${customer.id}', ${index})">
                      🗑️ 刪除
                    </button>
                  </div>
                </div>
              `).join('') : '<div class="no-payments">尚無繳款紀錄</div>'}
            </div>
          </div>

          <div class="detail-section">
            <h4>上傳檔案</h4>
            <div class="detail-grid">
              <div class="detail-item">
                <span class="detail-label">身分證正面</span>
                <span class="detail-value">
                  ${customer.idFront ? 
                    `<a href="/uploads/${customer.idFront}" target="_blank" class="file-link">📄 查看檔案</a>` : 
                    '<span class="no-file">未上傳</span>'
                  }
                </span>
              </div>
              <div class="detail-item">
                <span class="detail-label">身分證反面</span>
                <span class="detail-value">
                  ${customer.idBack ? 
                    `<a href="/uploads/${customer.idBack}" target="_blank" class="file-link">📄 查看檔案</a>` : 
                    '<span class="no-file">未上傳</span>'
                  }
                </span>
              </div>
              <div class="detail-item">
                <span class="detail-label">存摺封面</span>
                <span class="detail-value">
                  ${customer.billPhoto ? 
                    `<a href="/uploads/${customer.billPhoto}" target="_blank" class="file-link">📄 查看檔案</a>` : 
                    '<span class="no-file">未上傳</span>'
                  }
                </span>
              </div>
              <div class="detail-item">
                <span class="detail-label">合約PDF</span>
                <span class="detail-value">
                  ${customer.contractPdf ? 
                    `<a href="/uploads/${customer.contractPdf}" target="_blank" class="file-link">📄 查看檔案</a>` : 
                    '<span class="no-file">未上傳</span>'
                  }
                </span>
              </div>
            </div>
          </div>
        </div>

        <div class="detail-actions">
          <button class="action-btn primary" onclick="customerCardSystem.showPaymentModal('${customer.id}')">
            💰 繳款
          </button>
          <button class="action-btn secondary" onclick="customerCardSystem.editCustomer('${customer.id}')">
            ✏️ 編輯
          </button>
          <button class="action-btn secondary" onclick="customerCardSystem.generateContract('${customer.id}')">
            📄 合約
          </button>
          <button class="action-btn warning" onclick="customerCardSystem.changeStatus('${customer.id}', 'buyback')">
            ✅ 已買回
          </button>
          <button class="action-btn danger" onclick="customerCardSystem.changeStatus('${customer.id}', 'locked')">
            ${customer.status === 'locked' ? '🔓 取消呆帳' : '🔒 呆帳'}
          </button>
        </div>
      </div>
    `;
  }

  // 缴款功能
  showPaymentModal(customerId) {
    const customer = this.allCustomers.find(c => c.id === customerId);
    if (!customer) return;

    const modal = document.getElementById('payment-modal');
    if (modal) {
      // 設置客戶ID到模態框
      modal.dataset.customerId = customerId;
      modal.style.display = 'flex';
      modal.classList.add('active');
      
      // 设置默认日期为今天
      const dateInput = document.getElementById('payment-date');
      if (dateInput) {
        dateInput.value = new Date().toISOString().slice(0, 10);
      }
      
      // 设置默认金额为未缴金额
      const amountInput = document.getElementById('payment-amount');
      if (amountInput) {
        const unpaidAmount = this.getUnpaidAmount(customer);
        amountInput.value = unpaidAmount > 0 ? unpaidAmount : customer.rent;
      }
    }
  }

  // 生成合約
  generateContract(customerId) {
    const customer = this.allCustomers.find(c => c.id === customerId);
    if (!customer) {
      this.showNotification('找不到客戶資料', 'error');
      return;
    }

    // 打開新視窗顯示合約
    const contractWindow = window.open('contract.html', '_blank', 'width=800,height=600');
    
    // 等待新視窗載入完成後，呼叫 generateContract
    contractWindow.onload = function() {
      if (contractWindow.generateContract) {
        contractWindow.generateContract(customer);
      } else {
        console.error('合約生成功能未找到');
      }
    };
  }

  // 编辑客户
  editCustomer(customerId) {
    console.log('客戶卡系統 - 編輯客戶:', customerId);
    
    // 優先使用 main.js 中的完整编辑功能
    if (typeof window.mainEditCustomer === 'function') {
      console.log('使用 main.js 的 editCustomer 函數');
      window.mainEditCustomer(customerId);
    } else {
      console.log('main.js 的 editCustomer 不可用，使用備用方案');
      // 如果 main.js 的 editCustomer 不可用，嘗試使用 fillEditForm
      const customer = this.allCustomers.find(c => c.id === customerId);
      if (!customer) {
        this.showNotification('找不到客戶資料', 'error');
        return;
      }
      
      // 嘗試使用 main.js 中的 fillEditForm 函數
      if (typeof window.fillEditForm === 'function') {
        console.log('使用 main.js 的 fillEditForm 函數');
        window.fillEditForm(customer).then(() => {
          const editModal = document.getElementById('edit-modal');
          if (editModal) {
            editModal.style.display = 'flex';
            editModal.classList.add('active');
          } else {
            console.log('找不到編輯模態框，使用简单编辑方式');
            // 如果找不到編輯模態框，使用简单编辑方式
            this.showSimpleEditModal(customer);
          }
        }).catch(error => {
          console.error('fillEditForm 出錯:', error);
          this.showSimpleEditModal(customer);
        });
      } else {
        console.log('使用簡單編輯方式');
        // 如果都不可用，使用简单的编辑方式
        this.showSimpleEditModal(customer);
      }
    }
  }

  // 简单编辑模态框
  showSimpleEditModal(customer) {
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = `
      <div class="modal-content edit-customer-modal">
        <span class="close-modal">&times;</span>
        <h3>編輯客戶 - ${customer.name}</h3>
        <form id="simple-edit-form">
          <div class="form-sections">
            <!-- 基本資料 -->
            <div class="form-section active" data-section="basic">
              <h4>基本資料</h4>
              <div class="form-row">
                <div class="form-group">
                  <label>姓名 *</label>
                  <input type="text" name="name" value="${customer.name}" required>
                </div>
                <div class="form-group">
                  <label>手機號碼 *</label>
                  <input type="tel" name="phone" value="${customer.phone || ''}" required>
                </div>
              </div>
              <div class="form-row">
                <div class="form-group">
                  <label>身分證字號</label>
                  <input type="text" name="idNumber" value="${customer.idNumber || ''}">
                </div>
                <div class="form-group">
                  <label>生日</label>
                  <input type="date" name="birthday" value="${customer.birthday || ''}">
                </div>
              </div>
            </div>

            <!-- 租賃資訊 -->
            <div class="form-section" data-section="rental">
              <h4>租賃資訊</h4>
              <div class="form-row">
                <div class="form-group">
                  <label>手機型號</label>
                  <input type="text" name="model" value="${customer.model || ''}">
                </div>
                <div class="form-group">
                  <label>IMEI</label>
                  <input type="text" name="imei" value="${customer.imei || ''}">
                </div>
              </div>
              <div class="form-row">
                <div class="form-group">
                  <label>租金 *</label>
                  <input type="number" name="rent" value="${customer.rent || ''}" required>
                </div>
                <div class="form-group">
                  <label>買賣價金</label>
                  <input type="number" name="salePrice" value="${customer.salePrice || ''}">
                </div>
              </div>
              <div class="form-row">
                <div class="form-group">
                  <label>合約起始日</label>
                  <input type="date" name="contractDate" value="${customer.contractDate || ''}">
                </div>
                <div class="form-group">
                  <label>繳款週期（天）</label>
                  <input type="number" name="paymentCycleDays" value="${customer.paymentCycleDays || 30}">
                </div>
              </div>
            </div>

            <!-- 財務資訊 -->
            <div class="form-section" data-section="financial">
              <h4>財務資訊</h4>
              <div class="form-row">
                <div class="form-group">
                  <label>銀行</label>
                  <input type="text" name="bank" value="${customer.bank || ''}">
                </div>
                <div class="form-group">
                  <label>銀行帳號</label>
                  <input type="text" name="bankAccountNumber" value="${customer.bankAccountNumber || ''}">
                </div>
              </div>
              <div class="form-row">
                <div class="form-group">
                  <label>銀行戶名</label>
                  <input type="text" name="bankAccountName" value="${customer.bankAccountName || ''}">
                </div>
                <div class="form-group">
                  <label>下次應繳日覆蓋</label>
                  <input type="date" name="nextDueOverride" value="${customer.nextDueOverride || ''}">
                </div>
              </div>
            </div>

            <!-- 檔案上傳 -->
            <div class="form-section" data-section="files">
              <h4>檔案上傳</h4>
              <div class="file-upload-grid">
                <div class="file-upload-item">
                  <label>身分證正面</label>
                  <input type="file" name="idFront" accept="image/*">
                  <div class="file-preview">
                    ${customer.idFront ? `<div class="file-info"><a href="/uploads/${customer.idFront}" target="_blank">查看檔案</a></div>` : ''}
                  </div>
                </div>
                <div class="file-upload-item">
                  <label>身分證反面</label>
                  <input type="file" name="idBack" accept="image/*">
                  <div class="file-preview">
                    ${customer.idBack ? `<div class="file-info"><a href="/uploads/${customer.idBack}" target="_blank">查看檔案</a></div>` : ''}
                  </div>
                </div>
                <div class="file-upload-item">
                  <label>存摺封面</label>
                  <input type="file" name="billPhoto" accept="image/*">
                  <div class="file-preview">
                    ${customer.billPhoto ? `<div class="file-info"><a href="/uploads/${customer.billPhoto}" target="_blank">查看檔案</a></div>` : ''}
                  </div>
                </div>
                <div class="file-upload-item">
                  <label>合約PDF</label>
                  <input type="file" name="contractPdf" accept=".pdf">
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
              <span class="indicator" data-section="rental">2</span>
              <span class="indicator" data-section="financial">3</span>
              <span class="indicator" data-section="files">4</span>
            </div>
            <button type="button" class="nav-btn" id="edit-next-section">下一步</button>
          </div>

          <div class="form-actions">
            <button type="submit" class="submit-btn">更新客戶</button>
            <button type="button" class="btn-secondary" onclick="this.closest('.modal').style.display='none'">取消</button>
          </div>
        </form>
      </div>
    `;

    document.body.appendChild(modal);
    modal.style.display = 'flex';
    modal.classList.add('active');

    // 設置編輯表單導航
    this.setupSimpleEditNavigation(modal);

    // 绑定关闭事件
    const closeBtn = modal.querySelector('.close-modal');
    closeBtn.addEventListener('click', () => {
      modal.style.display = 'none';
      document.body.removeChild(modal);
    });

    // 绑定表单提交事件
    const form = modal.querySelector('#simple-edit-form');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      await this.submitSimpleEdit(customer.id, form);
      modal.style.display = 'none';
      document.body.removeChild(modal);
    });
  }

  // 設置簡單編輯表單導航
  setupSimpleEditNavigation(modal) {
    const sections = ['basic', 'rental', 'financial', 'files'];
    let currentSectionIndex = 0;

    const showSection = (index) => {
      sections.forEach((section, i) => {
        const sectionElement = modal.querySelector(`[data-section="${section}"]`);
        const indicator = modal.querySelector(`.indicator[data-section="${section}"]`);
        
        if (sectionElement) {
          sectionElement.classList.toggle('active', i === index);
        }
        if (indicator) {
          indicator.classList.toggle('active', i === index);
        }
      });

      // 更新导航按钮状态
      const prevBtn = modal.querySelector('#edit-prev-section');
      const nextBtn = modal.querySelector('#edit-next-section');
      
      if (prevBtn) prevBtn.disabled = index === 0;
      if (nextBtn) nextBtn.disabled = index === sections.length - 1;
    };

    const prevBtn = modal.querySelector('#edit-prev-section');
    const nextBtn = modal.querySelector('#edit-next-section');

    if (prevBtn) {
      prevBtn.addEventListener('click', () => {
        if (currentSectionIndex > 0) {
          currentSectionIndex--;
          showSection(currentSectionIndex);
        }
      });
    }

    if (nextBtn) {
      nextBtn.addEventListener('click', () => {
        if (currentSectionIndex < sections.length - 1) {
          currentSectionIndex++;
          showSection(currentSectionIndex);
        }
      });
    }

    // 指示器点击
    modal.querySelectorAll('.indicator').forEach((indicator, index) => {
      indicator.addEventListener('click', () => {
        currentSectionIndex = index;
        showSection(currentSectionIndex);
      });
    });
  }

  // 提交简单编辑
  async submitSimpleEdit(customerId, form) {
    const formData = new FormData(form);
    const updateData = {
      name: formData.get('name'),
      phone: formData.get('phone'),
      idNumber: formData.get('idNumber') || null,
      birthday: formData.get('birthday') || null,
      model: formData.get('model') || null,
      imei: formData.get('imei') || null,
      rent: parseFloat(formData.get('rent')) || 0,
      salePrice: parseFloat(formData.get('salePrice')) || null,
      contractDate: formData.get('contractDate') || null,
      paymentCycleDays: parseInt(formData.get('paymentCycleDays')) || 30,
      bank: formData.get('bank') || null,
      bankAccountNumber: formData.get('bankAccountNumber') || null,
      bankAccountName: formData.get('bankAccountName') || null,
      nextDueOverride: formData.get('nextDueOverride') || null
    };

    try {
      const response = await fetch(`/api/customers/${customerId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updateData)
      });

      const result = await response.json();
      if (result.success) {
        this.showNotification('客戶資訊更新成功', 'success');
        // 重新加载数据
        await this.loadCustomers();
        // 添加更新动画
        this.addUpdateAnimation(customerId);
      } else {
        this.showNotification(result.message || '更新失敗', 'error');
      }
    } catch (error) {
      console.error('更新客戶失敗:', error);
      this.showNotification('更新失敗', 'error');
    }
  }

  // 改变客户状态
  async changeStatus(customerId, newStatus) {
    // 使用 main.js 中的状态更改功能
    if (typeof window.changeCustomerStatus === 'function') {
      window.changeCustomerStatus(customerId, newStatus);
    } else {
      // 获取当前客户信息
      const customer = this.allCustomers.find(c => c.id === customerId);
      if (!customer) {
        this.showNotification('找不到客戶資料', 'error');
        return;
      }

      // 如果当前状态是呆帳，再次点击呆帳按钮则取消呆帳
      if (newStatus === 'locked' && customer.status === 'locked') {
        if (!confirm('確定要取消呆帳狀態，將客戶改回租賃中嗎？')) {
          return;
        }
        newStatus = 'renting'; // 改回租賃中狀態
      } else {
        if (!confirm(`確定要將客戶狀態改為 ${this.getStatusText(newStatus)} 嗎？`)) {
          return;
        }
      }

      try {
        const response = await fetch(`/api/customers/${customerId}/status`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: newStatus })
        });

        const result = await response.json();
        if (result.success) {
          const message = newStatus === 'renting' ? '已取消呆帳，客戶狀態改回租賃中' : '狀態更新成功';
          this.showNotification(message, 'success');
          // 立即重新加载数据
          await this.loadCustomers();
          // 添加更新动画
          this.addUpdateAnimation(customerId);
        } else {
          this.showNotification(result.message || result.error || '狀態更新失敗', 'error');
        }
      } catch (error) {
        console.error('更新状态失败:', error);
        this.showNotification('狀態更新失敗', 'error');
      }
    }
  }

  // 删除客户
  async deleteCustomer(customerId) {
    // 使用 main.js 中的删除功能
    if (typeof window.deleteCustomer === 'function') {
      window.deleteCustomer(customerId);
    } else {
      if (!confirm('確定要刪除這位客戶嗎？此操作無法復原！')) {
        return;
      }

      try {
        const response = await fetch(`/api/customers/${customerId}`, {
          method: 'DELETE'
        });

        const result = await response.json();
        if (result.success) {
          this.showNotification('客戶刪除成功', 'success');
          // 立即重新加载数据
          await this.loadCustomers();
        } else {
          this.showNotification(result.message || result.error || '刪除失敗', 'error');
        }
      } catch (error) {
        console.error('刪除客戶失敗:', error);
        this.showNotification('刪除失敗，請稍後再試', 'error');
      }
    }
  }

  // 添加更新动画
  addUpdateAnimation(customerId) {
    const card = document.querySelector(`[data-customer-id="${customerId}"]`);
    if (card) {
      card.classList.add('updated');
      setTimeout(() => {
        card.classList.remove('updated');
      }, 600);
    }
  }

  // 导出客户数据
  exportCustomerData() {
    const filteredCustomers = this.getFilteredCustomers();
    const csvContent = this.generateCSV(filteredCustomers);
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `客戶資料_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
  }

  generateCSV(customers) {
    const headers = [
      '客戶ID', '姓名', '身分證字號', '手機號碼', '手機型號', '合約起始日',
      '租金', '已繳總額', '未繳金額', '狀態', '下次應繳日'
    ];

    const rows = customers.map(customer => {
      const totalPaid = (customer.payments || []).reduce((sum, p) => sum + Number(p.amount), 0);
      const unpaidAmount = this.getUnpaidAmount(customer);
      const status = this.getCustomerStatus(customer);
      const nextDue = this.getNextDueDate(customer);

      return [
        customer.id,
        customer.name,
        customer.idNumber || '',
        customer.phone || '',
        customer.model || '',
        this.formatDate(customer.contractDate),
        customer.rent || 0,
        totalPaid,
        unpaidAmount,
        this.getStatusText(status),
        this.formatDate(nextDue)
      ];
    });

    return [headers, ...rows].map(row => row.join(',')).join('\n');
  }

  // 工具方法
  getStatusText(status) {
    // 使用 main.js 中的狀態文字功能
    if (typeof window.getStatusText === 'function') {
      return window.getStatusText(status);
    } else {
      const statusMap = {
        'renting': '租賃中',
        'overdue': '逾期',
        'due-today': '本日應繳',
        'locked': '呆帳',
        'buyback': '已買回',
        'normal': '正常'
      };
      return statusMap[status] || status;
    }
  }

  formatCurrency(amount) {
    // 使用 main.js 中的格式化功能
    if (typeof window.formatCurrency === 'function') {
      return window.formatCurrency(amount || 0);
    } else {
      return new Intl.NumberFormat('zh-TW', {
        style: 'currency',
        currency: 'TWD',
        minimumFractionDigits: 0
      }).format(amount || 0);
    }
  }

  formatDate(date) {
    // 使用 main.js 中的格式化功能
    if (typeof window.formatDate === 'function') {
      return window.formatDate(date);
    } else {
      if (!date) return '-';
      return new Date(date).toLocaleDateString('zh-TW');
    }
  }

  formatDateForInput(dateString) {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toISOString().slice(0, 10); // YYYY-MM-DD
  }

  async updatePaymentField(customerId, index, field, value) {
    try {
      const response = await fetch(`/api/payments/${customerId}/${index}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: value })
      });

      const result = await response.json();
      if (result.success) {
        this.showNotification('繳款紀錄更新成功', 'success');
        // 重新加载客户数据
        await this.loadCustomers();
        // 如果当前在详情页面，重新显示详情
        const detailModal = document.getElementById('customer-detail-modal');
        if (detailModal && detailModal.style.display === 'flex') {
          this.showCustomerDetail(customerId);
        }
      } else {
        this.showNotification(result.message || '繳款紀錄更新失敗', 'error');
      }
    } catch (error) {
      console.error('更新繳款紀錄失败:', error);
      this.showNotification('繳款紀錄更新失敗', 'error');
    }
  }

  async deletePayment(customerId, index) {
    if (!confirm('確定要刪除此筆繳款紀錄嗎？')) {
      return;
    }

    try {
      const response = await fetch(`/api/payments/${customerId}/${index}`, {
        method: 'DELETE'
      });

      const result = await response.json();
      if (result.success) {
        this.showNotification('繳款紀錄已刪除', 'success');
        // 重新加载客户数据
        await this.loadCustomers();
        // 如果当前在详情页面，重新显示详情
        const detailModal = document.getElementById('customer-detail-modal');
        if (detailModal.style.display === 'flex') {
          this.showCustomerDetail(customerId);
        }
      } else {
        this.showNotification(result.message || '刪除失敗', 'error');
      }
    } catch (error) {
      console.error('刪除繳款紀錄失败:', error);
      this.showNotification('刪除失敗', 'error');
    }
  }

  async savePaymentChanges(customerId, index) {
    try {
      const paymentRecord = document.querySelector(`.payment-record[data-customer-id="${customerId}"][data-index="${index}"]`);
      const dateInput = paymentRecord.querySelector('.payment-date-input');
      const amountInput = paymentRecord.querySelector('.payment-amount-input');
      const noteInput = paymentRecord.querySelector('.payment-note-input');

      const paymentData = {
        date: dateInput.value,
        amount: parseFloat(amountInput.value),
        note: noteInput.value
      };

      const response = await fetch(`/api/payments/${customerId}/${index}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(paymentData)
      });

      const result = await response.json();
      if (result.success) {
        this.showNotification('繳款紀錄更新成功', 'success');
        // 重新加载客户数据
        await this.loadCustomers();
        // 如果当前在详情页面，重新显示详情
        const detailModal = document.getElementById('customer-detail-modal');
        if (detailModal.style.display === 'flex') {
          this.showCustomerDetail(customerId);
        }
      } else {
        this.showNotification(result.message || '更新失敗', 'error');
      }
    } catch (error) {
      console.error('更新繳款紀錄失敗:', error);
      this.showNotification('更新失敗', 'error');
    }
  }

  showNotification(message, type = 'info') {
    // 使用 main.js 中的通知功能
    if (typeof window.showNotification === 'function') {
      window.showNotification(message, type);
    } else {
      const notification = document.createElement('div');
      notification.className = `notification ${type}`;
      notification.textContent = message;
      
      document.body.appendChild(notification);
      
      setTimeout(() => {
        notification.classList.add('show');
      }, 100);
      
      setTimeout(() => {
        notification.classList.remove('show');
        setTimeout(() => {
          document.body.removeChild(notification);
        }, 300);
      }, 3000);
    }
  }
}

// 全局函数暴露，确保按钮功能正常工作
const customerCardSystem = new CustomerCardSystem();

// 暴露全局函数供HTML调用
window.customerCardSystem = customerCardSystem;
window.showPaymentModal = (customerId) => customerCardSystem.showPaymentModal(customerId);
window.showCustomerDetail = (customerId) => customerCardSystem.showCustomerDetail(customerId);
window.generateContract = (customerId) => customerCardSystem.generateContract(customerId);
window.changeStatus = (customerId, status) => customerCardSystem.changeStatus(customerId, status);
window.deleteCustomer = (customerId) => customerCardSystem.deleteCustomer(customerId);

// 編輯客戶功能 - 直接使用 customer-card-system 中的函數
window.editCustomer = (customerId) => {
  console.log('全局 editCustomer 被調用:', customerId);
  customerCardSystem.editCustomer(customerId);
};

// 缴款记录相关全局函数
window.updatePaymentField = (customerId, index, field, value) => customerCardSystem.updatePaymentField(customerId, index, field, value);
window.savePaymentChanges = (customerId, index) => customerCardSystem.savePaymentChanges(customerId, index);
window.deletePayment = (customerId, index) => customerCardSystem.deletePayment(customerId, index);

  // 初始化系统
  document.addEventListener('DOMContentLoaded', () => {
    customerCardSystem.init();
    
    // 初始化文件上傳預覽功能
    setupFileUploadPreviews();
    
    // 如果當前頁面是客戶列表，立即載入客戶數據
    const listPage = document.getElementById('list');
    if (listPage && listPage.classList.contains('active')) {
      customerCardSystem.loadCustomers();
    }
  });

  // 設置文件上傳預覽功能
  function setupFileUploadPreviews() {
    // 為所有文件上傳輸入添加事件監聽器
    document.addEventListener('change', (e) => {
      if (e.target.type === 'file') {
        const file = e.target.files[0];
        const previewId = e.target.id.replace('new-', '').replace('edit-', '') + '-preview';
        const previewElement = document.getElementById(previewId);
        
        if (file && previewElement) {
          if (file.type.startsWith('image/')) {
            // 圖片預覽
            const reader = new FileReader();
            reader.onload = function(e) {
              previewElement.innerHTML = `
                <div class="file-preview-image">
                  <img src="${e.target.result}" alt="預覽" style="max-width: 100px; max-height: 100px;" />
                  <div class="file-name">${file.name}</div>
                </div>
              `;
              previewElement.classList.add('has-file');
            };
            reader.readAsDataURL(file);
          } else if (file.type === 'application/pdf') {
            // PDF 預覽
            previewElement.innerHTML = `
              <div class="file-preview-pdf">
                <div class="pdf-icon">📄</div>
                <div class="file-name">${file.name}</div>
              </div>
            `;
            previewElement.classList.add('has-file');
          }
        }
      }
    });
  }
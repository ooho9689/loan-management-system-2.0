const API_BASE_URL = 'https://five-iridescent-flyaway.glitch.me';

// 付款模態框
const modal = document.getElementById('payment-modal');
const closeModal = document.querySelector('.close-modal');
const paymentAmount = document.getElementById('payment-amount');
const submitPayment = document.getElementById('submit-payment');

let currentCustomerId = null;

// 顯示付款模態框
window.showPaymentModal = (customerId) => {
  currentCustomerId = customerId;
  modal.style.display = 'flex';
  modal.classList.add('active');
  paymentAmount.value = '';
};

// 關閉模態框
closeModal.addEventListener('click', () => {
  closeModalWithAnimation(modal);
});

// 點擊模態框外部關閉
window.addEventListener('click', (e) => {
  if (e.target === modal) {
    closeModalWithAnimation(modal);
  }
});

// 關閉模態框的動畫函數
function closeModalWithAnimation(modal) {
  modal.style.opacity = '0';
  modal.style.transform = 'scale(0.9)';
  
  setTimeout(() => {
    modal.classList.remove('active');
    modal.style.display = 'none';
    modal.style.opacity = '';
    modal.style.transform = '';
    currentCustomerId = null;
  }, 150);
}

// 提交付款
submitPayment.addEventListener('click', async () => {
  if (!currentCustomerId) return;
  
  const amount = parseFloat(paymentAmount.value);
  if (isNaN(amount) || amount <= 0) {
    alert('請輸入有效的付款金額');
    return;
  }
  
  try {
    const response = await fetch('/api/payments', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        customerId: currentCustomerId,
        amount: amount,
        date: new Date().toISOString()
      })
    });
    
    if (response.ok) {
      alert('付款成功');
      closeModalWithAnimation(modal);
      // 重新載入客戶列表
      const activeFilter = document.querySelector('.filter-btn.active').dataset.filter;
      filterCustomers(activeFilter);
    } else {
      alert('付款失敗');
    }
  } catch (error) {
    console.error('Error:', error);
    alert('系統錯誤，請稍後再試');
  }
});

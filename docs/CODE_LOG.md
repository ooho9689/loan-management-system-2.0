# 手機租賃管理系統程式碼日誌

## 系統架構
```
├── app.js                 # 主應用程式入口
├── index.js              # 伺服器啟動點
├── routes/               # API 路由模組
│   ├── customers.js      # 客戶管理相關 API
│   ├── dashboard.js      # 儀表板統計 API
│   ├── insights.js       # 智能分析建議 API
│   ├── sales.js          # 銷售相關 API
│   ├── logs.js           # 系統日誌 API
│   ├── export.js         # 資料匯出 API
│   ├── fix.js            # 資料修復 API
│   └── payments.js       # 付款相關 API
├── services/             # 業務邏輯層
│   ├── dataService.js    # 資料存取服務
│   ├── salesService.js   # 銷售業務邏輯
│   └── logService.js     # 日誌服務
└── utils/                # 工具函數
    └── validate.js       # 資料驗證工具
```

## 功能模組對應表

### 1. 客戶管理 (customers.js)
- 功能：客戶資料 CRUD、狀態管理
- 主要 API：
  - GET /api/customers - 查詢客戶列表
  - POST /api/customers - 新增客戶
  - PUT /api/customers/:id - 更新客戶資料
  - DELETE /api/customers/:id - 刪除客戶
- 監控重點：
  - 客戶資料完整性
  - 狀態變更記錄
  - 資料驗證結果

### 2. 儀表板統計 (dashboard.js)
- 功能：各項業務指標統計
- 主要 API：
  - GET /api/dashboard - 獲取統計數據
- 監控指標：
  - 呆帳率計算
  - 回收率計算
  - 逾期率計算
  - 累積業績統計
  - 機型分布
  - 地區分布

### 3. 智能分析建議 (insights.js)
- 功能：業務數據分析與建議
- 主要 API：
  - GET /api/insights - 獲取分析建議
- 監控指標：
  - 各項指標計算準確性
  - 建議生成邏輯
  - 摘要生成品質

### 4. 銷售管理 (sales.js)
- 功能：銷售記錄與統計
- 主要 API：
  - GET /api/sales - 查詢銷售記錄
  - POST /api/sales - 新增銷售記錄
- 監控重點：
  - 銷售金額計算
  - 付款記錄關聯
  - 業績統計準確性

### 5. 系統日誌 (logs.js)
- 功能：操作記錄與錯誤追蹤
- 主要 API：
  - GET /api/logs - 查詢系統日誌
  - POST /api/logs - 記錄操作日誌
- 監控重點：
  - 錯誤記錄完整性
  - 操作追蹤準確性
  - 日誌存儲可靠性

### 6. 資料匯出 (export.js)
- 功能：資料匯出與報表生成
- 主要 API：
  - GET /api/export/customers - 匯出客戶資料
  - GET /api/export/sales - 匯出銷售報表
- 監控重點：
  - 匯出資料完整性
  - 檔案格式正確性
  - 大量資料處理效能

### 7. 資料修復 (fix.js)
- 功能：資料一致性檢查與修復
- 主要 API：
  - POST /api/fix/check - 檢查資料一致性
  - POST /api/fix/repair - 修復資料問題
- 監控重點：
  - 修復操作安全性
  - 資料備份完整性
  - 修復結果驗證

### 8. 付款管理 (payments.js)
- 功能：付款記錄與追蹤
- 主要 API：
  - GET /api/payments - 查詢付款記錄
  - POST /api/payments - 新增付款記錄
- 監控重點：
  - 付款金額計算
  - 付款狀態更新
  - 逾期追蹤準確性

## 監控機制

### 1. 錯誤處理
```javascript
// 全局錯誤處理中間件
app.use((err, req, res, next) => {
  console.error(`[ERROR] ${new Date().toISOString()} - ${err.message}`);
  console.error(err.stack);
  res.status(500).json({ error: '系統錯誤，請稍後再試' });
});
```

### 2. 請求日誌
```javascript
// 請求日誌中間件
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});
```

### 3. 效能監控
```javascript
// 效能監控中間件
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`[PERFORMANCE] ${req.method} ${req.url} - ${duration}ms`);
  });
  next();
});
```

### 4. 資料驗證
```javascript
// 資料驗證中間件
const validate = (schema) => {
  return (req, res, next) => {
    const { error } = schema.validate(req.body);
    if (error) {
      console.error(`[VALIDATION] ${error.details[0].message}`);
      return res.status(400).json({ error: error.details[0].message });
    }
    next();
  };
};
```

## 開發規範

### 1. 程式碼風格
- 使用 ESLint 進行程式碼檢查
- 遵循 Airbnb JavaScript 風格指南
- 使用 Prettier 進行程式碼格式化

### 2. 版本控制
- 使用 Git Flow 工作流程
- 提交訊息格式：
  ```
  <type>(<scope>): <subject>
  
  <body>
  
  <footer>
  ```
- type 類型：
  - feat: 新功能
  - fix: 錯誤修復
  - docs: 文件更新
  - style: 程式碼風格
  - refactor: 重構
  - test: 測試
  - chore: 建置過程或輔助工具的變動

### 3. 測試規範
- 單元測試覆蓋率 > 80%
- 整合測試覆蓋所有 API 端點
- 效能測試基準：
  - API 響應時間 < 200ms
  - 資料庫查詢時間 < 100ms
  - 記憶體使用 < 500MB

### 4. 部署流程
1. 開發環境測試
2. 程式碼審查
3. 整合測試
4. 預備環境部署
5. 生產環境部署
6. 監控與回饋

## 維護建議

### 1. 定期檢查
- 每日檢查錯誤日誌
- 每週檢查效能指標
- 每月檢查資料一致性

### 2. 備份策略
- 每日資料庫備份
- 每週完整系統備份
- 異地備份存儲

### 3. 更新流程
1. 評估更新影響
2. 準備回滾方案
3. 執行更新
4. 驗證系統功能
5. 監控系統狀態

### 4. 效能優化
- 定期清理日誌
- 優化資料庫查詢
- 更新依賴套件
- 檢查記憶體使用

## 緊急處理流程

### 1. 系統異常
1. 記錄錯誤信息
2. 評估影響範圍
3. 啟動備用方案
4. 修復問題
5. 驗證系統

### 2. 資料異常
1. 停止相關服務
2. 備份當前資料
3. 執行資料修復
4. 驗證資料完整性
5. 恢復服務

### 3. 效能問題
1. 分析瓶頸
2. 優化程式碼
3. 調整配置
4. 監控改善效果

## 聯繫方式

### 技術支援
- 開發團隊：dev@example.com
- 系統管理員：admin@example.com
- 緊急聯繫：emergency@example.com

### 文件維護
- 最後更新：2024-03-21
- 維護人員：系統開發團隊
- 版本：1.0.0 
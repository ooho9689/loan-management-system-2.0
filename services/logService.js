const fs = require('fs').promises;
const path = require('path');

const logsFile = path.join(__dirname, '../logs.json');

// 確保日誌檔案存在
async function ensureLogFile() {
  try {
    await fs.access(logsFile);
  } catch (e) {
    // 如果檔案不存在，創建一個空的日誌檔案
    await fs.writeFile(logsFile, JSON.stringify([], null, 2));
  }
}

async function logAction({ action, user = 'admin', customerId, customerName, detail }) {
  try {
    await ensureLogFile();
    const log = {
      timestamp: new Date().toISOString(),
      user,
      action,
      customerId,
      customerName,
      detail
    };
    let logs = [];
    try {
      const raw = await fs.readFile(logsFile, 'utf8');
      logs = JSON.parse(raw);
    } catch (e) {
      console.error('讀取日誌檔案失敗:', e);
    }
    logs.push(log);
    await fs.writeFile(logsFile, JSON.stringify(logs, null, 2));
  } catch (e) {
    console.error('寫入日誌失敗:', e);
    throw e;
  }
}

async function readLogs() {
  try {
    await ensureLogFile();
    const raw = await fs.readFile(logsFile, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    console.error('讀取日誌失敗:', e);
    return [];
  }
}

module.exports = { logAction, readLogs }; 
const fs = require('fs').promises;
const path = require('path');

const dataFile = path.join(__dirname, '../data.json');
const backupDir = path.join(__dirname, '../backups');

// 確保備份目錄存在
async function ensureBackupDir() {
  try {
    await fs.access(backupDir);
  } catch (error) {
    await fs.mkdir(backupDir, { recursive: true });
  }
}

// 創建數據備份
async function createBackup() {
  try {
    await ensureBackupDir();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFile = path.join(backupDir, `data-backup-${timestamp}.json`);
    
    const data = await fs.readFile(dataFile, 'utf8');
    await fs.writeFile(backupFile, data);
    
    console.log(`數據備份已創建: ${backupFile}`);
    
    // 清理舊備份，只保留最近10個
    const files = await fs.readdir(backupDir);
    const backupFiles = files.filter(f => f.startsWith('data-backup-')).sort().reverse();
    
    if (backupFiles.length > 10) {
      for (let i = 10; i < backupFiles.length; i++) {
        await fs.unlink(path.join(backupDir, backupFiles[i]));
        console.log(`刪除舊備份: ${backupFiles[i]}`);
      }
    }
  } catch (error) {
    console.error('創建備份失敗:', error);
  }
}

async function readData() {
  try {
    const data = await fs.readFile(dataFile, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return { customers: [] };
    }
    throw error;
  }
}

async function writeData(data) {
  // 在寫入前創建備份
  await createBackup();
  
  await fs.writeFile(dataFile, JSON.stringify(data, null, 2));
}

// 恢復數據功能
async function restoreData(backupFile) {
  try {
    const backupPath = path.join(backupDir, backupFile);
    const data = await fs.readFile(backupPath, 'utf8');
    await fs.writeFile(dataFile, data);
    console.log(`數據已從備份恢復: ${backupFile}`);
    return true;
  } catch (error) {
    console.error('恢復數據失敗:', error);
    return false;
  }
}

// 列出所有備份
async function listBackups() {
  try {
    await ensureBackupDir();
    const files = await fs.readdir(backupDir);
    return files.filter(f => f.startsWith('data-backup-')).sort().reverse();
  } catch (error) {
    console.error('列出備份失敗:', error);
    return [];
  }
}

module.exports = { 
  readData, 
  writeData, 
  createBackup, 
  restoreData, 
  listBackups 
}; 
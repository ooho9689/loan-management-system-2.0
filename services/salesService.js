const fs = require('fs').promises;
const path = require('path');

const salesFile = path.join(__dirname, '../sales.json');

async function readSales() {
  try {
    const data = await fs.readFile(salesFile, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function writeSales(data) {
  await fs.writeFile(salesFile, JSON.stringify(data, null, 2));
}

module.exports = { readSales, writeSales }; 
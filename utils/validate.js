function validateCustomer(body, files) {
  const errors = [];
  
  if (!body.name) errors.push('姓名為必填');
  if (!body.idNumber || !/^[A-Z][12]\d{8}$/.test(body.idNumber)) errors.push('身分證字號格式錯誤');
  if (!body.phone || !/^09\d{8}$/.test(body.phone)) errors.push('手機號碼格式錯誤');
  if (!body.model) errors.push('手機型號為必填');
  if (!body.imei || !/^\d{15}$/.test(body.imei)) errors.push('IMEI 格式錯誤');
  if (!body.serialNumber) errors.push('序號為必填');
  if (!body.address) errors.push('戶籍地址為必填');
  if (!body.currentAddress) errors.push('通訊地址為必填');
  if (!body.contractDate) errors.push('合約起始日為必填');
  if (!body.salePrice) errors.push('買賣價金為必填');
  if (!body.rent) errors.push('租金為必填');
  if (!body.bank) errors.push('銀行為必填');
  if (!body.bankAccountName) errors.push('戶名為必填');
  if (!body.bankAccountNumber) errors.push('帳號為必填');
  
  return errors.length > 0 ? errors.join('; ') : null;
}

module.exports = { validateCustomer }; 
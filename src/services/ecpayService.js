/**
 * ECPay 站內付 2.0 — AES 加解密 + Token 取得
 */
const crypto = require('crypto');

const MERCHANT_ID = process.env.ECPAY_MERCHANT_ID || '3002607';
const HASH_KEY = process.env.ECPAY_HASH_KEY || 'pwFHCqoQZGmho4w6';
const HASH_IV = process.env.ECPAY_HASH_IV || 'EkRm7iFT261dpevs';
const API_URL = process.env.ECPAY_API_URL || 'https://ecpg-stage.ecpay.com.tw';

// ============================================
// AES-128-CBC 加解密（PKCS7）
// ============================================

function aesEncrypt(data) {
  const jsonStr = JSON.stringify(data);
  const encoded = encodeURIComponent(jsonStr);
  const cipher = crypto.createCipheriv(
    'aes-128-cbc',
    Buffer.from(HASH_KEY, 'utf8'),
    Buffer.from(HASH_IV, 'utf8')
  );
  cipher.setAutoPadding(true); // PKCS7
  let encrypted = cipher.update(encoded, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  return encrypted;
}

function aesDecrypt(encryptedData) {
  const decipher = crypto.createDecipheriv(
    'aes-128-cbc',
    Buffer.from(HASH_KEY, 'utf8'),
    Buffer.from(HASH_IV, 'utf8')
  );
  decipher.setAutoPadding(true);
  let decrypted = decipher.update(encryptedData, 'base64', 'utf8');
  decrypted += decipher.final('utf8');
  const decoded = decodeURIComponent(decrypted);
  return JSON.parse(decoded);
}

// ============================================
// 產生 MerchantTradeNo（max 20 chars）
// ============================================

function generateTradeNo() {
  const now = new Date();
  const ts = [
    String(now.getFullYear()).slice(-2),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
    String(now.getSeconds()).padStart(2, '0'),
  ].join('');
  const rand = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
  return `CICD${ts}${rand}`; // 4 + 12 + 4 = 20
}

// ============================================
// 取得廠商驗證碼（Token）
// ============================================

async function getTokenByTrade({
  billIds,
  totalAmount,
  itemName,
  memberName,
  memberEmail,
  memberPhone,
  returnUrl,
  orderResultUrl,
}) {
  const timestamp = Math.floor(Date.now() / 1000);
  const merchantTradeNo = generateTradeNo().slice(0, 20);
  const now = new Date();
  const tradeDate = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;

  const dataPayload = {
    MerchantID: MERCHANT_ID,
    RememberCard: 0,
    PaymentUIType: 2, // 付款選擇清單頁
    ChoosePaymentList: '1,3', // 信用卡、ATM（虛擬帳號）
    OrderInfo: {
      MerchantTradeNo: merchantTradeNo,
      MerchantTradeDate: tradeDate,
      TotalAmount: totalAmount,
      ReturnURL: returnUrl,
      TradeDesc: '工商建研會會費繳納',
      ItemName: itemName || '會費',
      OrderResultURL: orderResultUrl || '',
    },
    CardInfo: {
      CreditInstallment: '0', // 一次付清
    },
    ATMInfo: {
      ExpireDate: 3, // 3 天內繳費
    },
    ConsumerInfo: {
      MerchantMemberID: '',
      Email: memberEmail || '',
      Phone: memberPhone || '',
      Name: memberName || '會員',
    },
    CustomField: billIds.join(','), // 存帳單 ID 對應
  };

  const encryptedData = aesEncrypt(dataPayload);

  const requestBody = {
    MerchantID: MERCHANT_ID,
    RqHeader: { Timestamp: timestamp },
    Data: encryptedData,
  };

  const response = await fetch(`${API_URL}/Merchant/GetTokenbyTrade`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody),
  });

  const result = await response.json();

  if (result.TransCode !== 1) {
    throw new Error(`ECPay TransCode=${result.TransCode}: ${result.TransMsg}`);
  }

  // 解密 Data
  const decryptedData = aesDecrypt(result.Data);

  if (decryptedData.RtnCode !== 1) {
    throw new Error(`ECPay RtnCode=${decryptedData.RtnCode}: ${decryptedData.RtnMsg}`);
  }

  return {
    token: decryptedData.Token,
    tokenExpireDate: decryptedData.TokenExpireDate,
    merchantTradeNo,
  };
}

// ============================================
// 解密付款結果（ReturnURL callback）
// ============================================

function decryptPaymentResult(encryptedData) {
  return aesDecrypt(encryptedData);
}

module.exports = {
  aesEncrypt,
  aesDecrypt,
  getTokenByTrade,
  decryptPaymentResult,
  MERCHANT_ID,
  API_URL,
};

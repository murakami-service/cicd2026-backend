/**
 * ECPay 站內付 2.0 — 金流路由
 */
const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { verifyToken } = require('../middleware/auth');
const {
  getTokenByTrade,
  decryptPaymentResult,
  MERCHANT_ID,
  API_URL,
} = require('../services/ecpayService');

// 付款暫存（Token + billIds 對應，30 分鐘過期）
const paymentStore = new Map();
const PAYMENT_TTL = 30 * 60 * 1000; // 30 min

function cleanExpiredPayments() {
  const now = Date.now();
  for (const [key, val] of paymentStore) {
    if (now - val.createdAt > PAYMENT_TTL) paymentStore.delete(key);
  }
}
setInterval(cleanExpiredPayments, 5 * 60 * 1000);

function generatePaymentId() {
  const { randomUUID } = require('crypto');
  return randomUUID().replace(/-/g, '').slice(0, 16);
}

// ============================================
// 1. POST /get-token — APP 請求付款 Token
// ============================================
router.post('/get-token', verifyToken, async (req, res, next) => {
  try {
    const memberId = req.member.id;
    const { billIds } = req.body;

    if (!billIds || !Array.isArray(billIds) || billIds.length === 0) {
      return res.status(400).json({ error: '請選擇要繳費的帳單' });
    }

    // 查詢帳單，確認都屬於該會員且為 UNPAID
    const bills = await prisma.bill.findMany({
      where: {
        id: { in: billIds.map(Number) },
        memberId,
        status: 'UNPAID',
      },
      include: { batch: { select: { title: true } } },
    });

    if (bills.length !== billIds.length) {
      return res.status(400).json({ error: '部分帳單不存在或已繳費' });
    }

    const totalAmount = bills.reduce((sum, b) => sum + Number(b.amount), 0);
    if (totalAmount <= 0) {
      return res.status(400).json({ error: '繳費金額必須大於 0' });
    }

    // 商品名稱（# 分隔）
    const itemName = bills.map(b => b.batch.title).join('#');

    // 查會員資訊
    const member = await prisma.member.findUnique({
      where: { id: memberId },
      select: { name: true, email: true, phone: true },
    });

    // 後端 URL
    const backendUrl = process.env.NODE_ENV === 'production'
      ? 'https://cicd-app.com'
      : `http://localhost:${process.env.PORT || 3001}`;

    const result = await getTokenByTrade({
      billIds: billIds.map(Number),
      totalAmount,
      itemName,
      memberName: member?.name || '會員',
      memberEmail: member?.email || '',
      memberPhone: member?.phone || '0912345678', // 預設號碼，避免 ECPay 驗證失敗
      returnUrl: `${backendUrl}/api/ecpay/return-url`,
      orderResultUrl: `${backendUrl}/api/ecpay/order-result`,
    });

    // 暫存
    const paymentId = generatePaymentId();
    paymentStore.set(paymentId, {
      token: result.token,
      merchantTradeNo: result.merchantTradeNo,
      billIds: billIds.map(Number),
      totalAmount,
      memberId,
      createdAt: Date.now(),
    });

    res.json({
      paymentUrl: `/api/ecpay/payment-page?pid=${paymentId}`,
      merchantTradeNo: result.merchantTradeNo,
    });
  } catch (err) {
    console.error('[ECPay] getToken 失敗:', err.message);
    next(err);
  }
});

// ============================================
// 2. GET /payment-page — WebView 載入的付款頁面
// ============================================
router.get('/payment-page', (req, res) => {
  const { pid } = req.query;
  const payment = paymentStore.get(pid);

  if (!payment) {
    return res.status(400).send(`
      <html><body style="display:flex;justify-content:center;align-items:center;height:100vh;font-family:sans-serif;">
        <div style="text-align:center;">
          <h2>付款連結已過期</h2>
          <p>請返回 APP 重新發起付款</p>
          <script>
            setTimeout(() => {
              window.ReactNativeWebView && window.ReactNativeWebView.postMessage(
                JSON.stringify({ type: 'PAYMENT_EXPIRED' })
              );
            }, 2000);
          </script>
        </div>
      </body></html>
    `);
  }

  const checkoutUrl = `${API_URL}/SP/SPCheckOut`;

  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>繳費中...</title>
      <style>
        body {
          display: flex; justify-content: center; align-items: center;
          height: 100vh; margin: 0; font-family: -apple-system, sans-serif;
          background: #f5f5f5;
        }
        .loading { text-align: center; }
        .spinner {
          border: 4px solid #e0e0e0; border-top: 4px solid #2AA9E0;
          border-radius: 50%; width: 40px; height: 40px;
          animation: spin 1s linear infinite; margin: 0 auto 16px;
        }
        @keyframes spin { to { transform: rotate(360deg); } }
      </style>
    </head>
    <body>
      <div class="loading">
        <div class="spinner"></div>
        <p>正在前往綠界付款頁面...</p>
      </div>
      <form id="ecpayForm" method="POST" action="${checkoutUrl}" style="display:none;">
        <input type="hidden" name="MerchantID" value="${MERCHANT_ID}" />
        <input type="hidden" name="Token" value="${payment.token}" />
      </form>
      <script>
        document.getElementById('ecpayForm').submit();
      </script>
    </body>
    </html>
  `);
});

// ============================================
// 3. POST /return-url — ECPay 背景通知（Server-to-Server）
// ============================================
router.post('/return-url', async (req, res) => {
  try {
    console.log('[ECPay] ReturnURL callback received');

    const { Data, TransCode } = req.body;

    if (TransCode !== 1 && TransCode !== '1') {
      console.warn('[ECPay] TransCode 非 1:', req.body);
      return res.send('1|OK');
    }

    const result = decryptPaymentResult(Data);
    console.log('[ECPay] 解密結果:', JSON.stringify(result, null, 2));

    const rtnCode = Number(result.RtnCode);
    const merchantTradeNo = result.OrderInfo?.MerchantTradeNo || result.MerchantTradeNo;
    const tradeNo = result.OrderInfo?.TradeNo || result.TradeNo;
    const customField = result.OrderInfo?.CustomField || result.CustomField || '';

    // 找到對應的帳單 IDs
    let billIds = [];
    if (customField) {
      billIds = customField.split(',').map(Number).filter(n => !isNaN(n));
    }

    // 也從 paymentStore 找
    if (billIds.length === 0 && merchantTradeNo) {
      for (const [, val] of paymentStore) {
        if (val.merchantTradeNo === merchantTradeNo) {
          billIds = val.billIds;
          break;
        }
      }
    }

    if (billIds.length === 0) {
      console.error('[ECPay] 無法找到對應帳單:', merchantTradeNo);
      return res.send('1|OK');
    }

    if (rtnCode === 1) {
      // 付款成功 — 更新帳單狀態
      const paymentDate = result.OrderInfo?.PaymentDate || new Date().toISOString();

      await prisma.bill.updateMany({
        where: {
          id: { in: billIds },
          status: 'UNPAID', // 冪等：只更新未繳的
        },
        data: {
          status: 'PAID',
          paymentMethod: 'ECPAY',
          paymentDate: new Date(paymentDate.replace(/\//g, '-')),
          ecpayTradeNo: tradeNo || '',
        },
      });

      console.log(`[ECPay] 付款成功: bills=${billIds.join(',')}, tradeNo=${tradeNo}`);
    } else {
      console.log(`[ECPay] 付款未成功: RtnCode=${rtnCode}, Msg=${result.RtnMsg}`);
    }

    res.send('1|OK');
  } catch (err) {
    console.error('[ECPay] ReturnURL 處理錯誤:', err.message);
    res.send('1|OK'); // 即使出錯也回 1|OK，避免 ECPay 一直重送
  }
});

// ============================================
// 4. POST /order-result — 付款完成/ATM取號/超商取碼 後前端跳轉
// ============================================
router.post('/order-result', async (req, res) => {
  const { Data, TransCode } = req.body;
  let success = false;
  let message = '付款處理中';
  let payInfoHtml = '';
  let postMessageType = 'PAYMENT_DONE';

  try {
    if (TransCode == 1 && Data) {
      const result = decryptPaymentResult(Data);
      const rtnCode = Number(result.RtnCode);
      success = rtnCode === 1;

      const merchantTradeNo = result.OrderInfo?.MerchantTradeNo || result.MerchantTradeNo;
      const customField = result.OrderInfo?.CustomField || result.CustomField || '';
      const paymentType = result.OrderInfo?.PaymentType || '';

      // 找對應帳單 IDs
      let billIds = [];
      if (customField) {
        billIds = customField.split(',').map(Number).filter(n => !isNaN(n));
      }
      if (billIds.length === 0 && merchantTradeNo) {
        for (const [, val] of paymentStore) {
          if (val.merchantTradeNo === merchantTradeNo) {
            billIds = val.billIds;
            break;
          }
        }
      }

      if (success) {
        message = '付款成功！';
      } else if (rtnCode === 2 || rtnCode === 10100058) {
        // ATM 取號成功 / 超商取碼成功（尚未付款）
        const atmInfo = result.ATMInfo || {};

        let payInfo = null;

        if (paymentType.includes('ATM') || atmInfo.BankCode) {
          // ATM 虛擬帳號
          payInfo = {
            type: 'ATM',
            bankCode: atmInfo.BankCode || '',
            vAccount: atmInfo.vAccount || '',
            expireDate: atmInfo.ExpireDate || '',
          };
          message = 'ATM 虛擬帳號已取得';
          payInfoHtml = `
            <div style="background:#FFF7ED;border-radius:8px;padding:16px;margin-top:16px;text-align:left;">
              <div style="font-weight:600;color:#92400E;margin-bottom:8px;">請使用以下帳號完成轉帳：</div>
              <div style="margin-bottom:4px;color:#333;">銀行代碼：<b>${payInfo.bankCode}</b></div>
              <div style="margin-bottom:4px;color:#333;">虛擬帳號：<b>${payInfo.vAccount}</b></div>
              <div style="color:#999;font-size:13px;">繳費期限：${payInfo.expireDate}</div>
            </div>`;
        }

        // 儲存待付款資訊到帳單
        if (payInfo && billIds.length > 0) {
          postMessageType = 'PAYMENT_PENDING';
          try {
            await prisma.bill.updateMany({
              where: { id: { in: billIds }, status: 'UNPAID' },
              data: {
                paymentMethod: 'ECPAY',
                ecpayTradeNo: merchantTradeNo || '',
                ecpayPayInfo: payInfo,
              },
            });
            console.log(`[ECPay] 待付款資訊已儲存: type=${payInfo.type}, bills=${billIds.join(',')}`);
          } catch (dbErr) {
            console.error('[ECPay] 儲存待付款資訊失敗:', dbErr.message);
          }
        }
      } else {
        message = result.RtnMsg || '付款失敗';
      }
    }
  } catch (err) {
    console.error('[ECPay] orderResult 解密失敗:', err.message);
    message = '付款結果處理中，請稍候確認';
  }

  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>付款結果</title>
      <style>
        body {
          display: flex; justify-content: center; align-items: center;
          min-height: 100vh; margin: 0; font-family: -apple-system, sans-serif;
          background: #f5f5f5; padding: 20px; box-sizing: border-box;
        }
        .result { text-align: center; max-width: 400px; width: 100%; }
        .icon { font-size: 64px; margin-bottom: 16px; }
        .msg { font-size: 18px; color: #333; margin-bottom: 8px; }
        .hint { font-size: 14px; color: #999; }
      </style>
    </head>
    <body>
      <div class="result">
        <div class="icon">${success ? '✅' : '⏳'}</div>
        <div class="msg">${message}</div>
        ${payInfoHtml}
        <div class="hint" style="margin-top:16px;">${success ? '即將返回 APP...' : '付款資訊已記錄，可在繳費紀錄中查看'}</div>
      </div>
      <script>
        setTimeout(function() {
          if (window.ReactNativeWebView) {
            window.ReactNativeWebView.postMessage(
              JSON.stringify({ type: '${postMessageType}', success: ${success} })
            );
          }
        }, ${success ? 2000 : 5000});
      </script>
    </body>
    </html>
  `);
});

// ============================================
// 5. GET /result — 查詢付款結果（APP 用）
// ============================================
router.get('/result/:merchantTradeNo', verifyToken, async (req, res, next) => {
  try {
    const { merchantTradeNo } = req.params;

    // 從 paymentStore 找 billIds
    let billIds = [];
    for (const [, val] of paymentStore) {
      if (val.merchantTradeNo === merchantTradeNo) {
        billIds = val.billIds;
        break;
      }
    }

    if (billIds.length === 0) {
      return res.status(404).json({ error: '找不到此交易' });
    }

    const bills = await prisma.bill.findMany({
      where: { id: { in: billIds } },
      select: { id: true, status: true, ecpayTradeNo: true },
    });

    const allPaid = bills.every(b => b.status === 'PAID');
    res.json({ success: allPaid, bills });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

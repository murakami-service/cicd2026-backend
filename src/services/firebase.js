const admin = require('firebase-admin');

let initialized = false;

function initFirebase() {
  if (initialized) return;

  const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!keyPath) {
    console.warn('[Firebase] GOOGLE_APPLICATION_CREDENTIALS 未設定，FCM 推播功能不可用');
    return;
  }

  try {
    const serviceAccount = require(require('path').resolve(keyPath));
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET || 'cicd2026-907dc.firebasestorage.app',
    });
    initialized = true;
    console.log('[Firebase] Admin SDK 初始化成功');
  } catch (err) {
    console.error('[Firebase] Admin SDK 初始化失敗:', err.message);
  }
}

/**
 * 發送 FCM 推播到指定 tokens
 * @param {string[]} tokens - FCM device tokens
 * @param {string} title - 通知標題
 * @param {string} body - 通知內容
 * @param {object} [data] - 額外資料 (optional)
 * @returns {{ successCount: number, failureCount: number, failedTokens: string[] }}
 */
async function sendToTokens(tokens, title, body, data = {}) {
  if (!initialized || tokens.length === 0) {
    return { successCount: 0, failureCount: 0, failedTokens: [] };
  }

  // FCM v1 sendEachForMulticast（最多 500 個 token）
  const batchSize = 500;
  let successCount = 0;
  let failureCount = 0;
  const failedTokens = [];

  for (let i = 0; i < tokens.length; i += batchSize) {
    const batch = tokens.slice(i, i + batchSize);

    const message = {
      notification: { title, body },
      data: Object.fromEntries(
        Object.entries(data).map(([k, v]) => [k, String(v)])
      ),
      tokens: batch,
    };

    try {
      const response = await admin.messaging().sendEachForMulticast(message);
      successCount += response.successCount;
      failureCount += response.failureCount;

      response.responses.forEach((resp, idx) => {
        if (!resp.success) {
          failedTokens.push(batch[idx]);
        }
      });
    } catch (err) {
      console.error('[FCM] batch send error:', err.message);
      failureCount += batch.length;
      failedTokens.push(...batch);
    }
  }

  return { successCount, failureCount, failedTokens };
}

/**
 * 判斷 Firebase 是否可用
 */
function isAvailable() {
  return initialized;
}

// 啟動時嘗試初始化
initFirebase();

module.exports = { sendToTokens, isAvailable, initFirebase };

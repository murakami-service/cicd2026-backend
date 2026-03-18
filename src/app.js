require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const path = require('path');
const { initFirebase } = require('./services/firebase');
const { processScheduledNotifications } = require('./services/fcmSender');
const { startDigestScheduler } = require('./services/digestScheduler');

// 伺服器啟動時初始化 Firebase Admin SDK（Storage + FCM 都需要）
initFirebase();

const app = express();

// 信任 Render / 反向代理的 X-Forwarded-For 標頭
// 這樣 express-rate-limit 才能正確識別每個使用者的真實 IP
app.set('trust proxy', 1);

// Security middleware
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: false,
}));
app.use(cors({
  origin: true, // 開發環境允許所有來源（含實體手機 IP）
  credentials: true
}));

// Rate limiting — trust proxy 已設定，每個 IP 各自計算
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 300, // 每 IP 每 15 分鐘 300 次（一般 API）
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: '請求過於頻繁，請稍後再試' }
});
app.use('/api/', limiter);

// 登入端點專用限制（防暴力破解）
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15, // 每 IP 每 15 分鐘最多 15 次登入嘗試
  standardHeaders: true,
  legacyHeaders: false,
  // 只限制登入 endpoint，用 account 作為額外 key 避免連坐
  keyGenerator: (req) => {
    // 用帳號作為 key，避免同一 IP 下不同使用者互相影響
    const account = req.body?.account || req.body?.username || '';
    return account || 'anonymous';
  },
  message: { error: '登入嘗試次數過多，請於 15 分鐘後再試' },
  skipSuccessfulRequests: true, // 成功登入不計入次數
});

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// 靜態檔案 (上傳的圖片)
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Routes
// authLimiter 只套用於登入端點（login / member-login），其他 auth 路由不限制
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/member-login', authLimiter);
app.use('/api/auth', require('./routes/auth'));
app.use('/api/members', require('./routes/members'));
app.use('/api/billing', require('./routes/billing'));
app.use('/api/events', require('./routes/events'));
app.use('/api/checkin', require('./routes/checkin'));
app.use('/api/points', require('./routes/points'));
app.use('/api/news', require('./routes/news'));
app.use('/api/ads', require('./routes/ads'));
app.use('/api/stores', require('./routes/stores'));
app.use('/api/organization', require('./routes/organization'));
app.use('/api/push', require('./routes/push'));
app.use('/api/ai-digest', require('./routes/aiDigest'));
app.use('/api/products', require('./routes/products'));
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api/admins', require('./routes/admins'));
app.use('/api/industry', require('./routes/industry'));
app.use('/api/ecpay', require('./routes/ecpay'));
app.use('/api/elections', require('./routes/elections'));
app.use('/api/documents', require('./routes/documents'));
app.use('/api/audit-logs', require('./routes/auditLog'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/app/home', require('./routes/appHome'));
app.use('/api/app/member', require('./routes/appMember'));

// Deep Link 跳板頁：嘗試開啟 APP，否則導向商店下載
app.get('/app-link', (req, res) => {
  const { type, id } = req.query;
  const deepLink = `cicd2026://${type}/${id}`;
  const androidStore = 'https://play.google.com/store/apps/details?id=com.cicd2026.app';
  const iosStore = 'https://apps.apple.com/app/id000000000'; // TODO: 上架後替換
  res.send(`<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<title>工商建研會</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font-family:-apple-system,sans-serif;text-align:center;padding:60px 20px;background:#F5F8FA;}
h2{color:#29A9E0;margin-bottom:8px;}p{color:#666;margin-bottom:24px;}
.btn{display:inline-block;padding:14px 32px;background:#29A9E0;color:#fff;border-radius:12px;text-decoration:none;font-size:16px;font-weight:600;}
.sub{margin-top:16px;font-size:13px;color:#999;}</style>
<script>
  var deep = "${deepLink}";
  var t = setTimeout(function(){ /* APP 未開啟，留在頁面 */ }, 2000);
  window.location.href = deep;
</script>
</head><body>
<h2>工商建研會</h2>
<p>正在開啟 APP...</p>
<a class="btn" href="${deepLink}">開啟 APP</a>
<div class="sub">
  尚未安裝？<a href="${androidStore}">Android 下載</a> ｜ <a href="${iosStore}">iOS 下載</a>
</div>
</body></html>`);
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 404
app.use((req, res) => {
  res.status(404).json({ error: '找不到此路徑' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  const status = err.status || 500;
  res.status(status).json({
    error: process.env.NODE_ENV === 'production' ? '伺服器內部錯誤' : err.message
  });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);

  // 排程推播處理：每分鐘檢查一次
  setInterval(() => {
    processScheduledNotifications().catch((err) => {
      console.error('[Scheduler] 排程推播處理失敗:', err.message);
    });
  }, 60 * 1000);

  // AI 摘要排程（RSS 抓取 + 生成 + 清理）
  startDigestScheduler();

  // Keep-alive：每 14 分鐘 ping 自己，防止 Render 免費方案休眠
  if (process.env.RENDER_EXTERNAL_URL || process.env.NODE_ENV === 'production') {
    const KEEP_ALIVE_URL = process.env.RENDER_EXTERNAL_URL
      ? `${process.env.RENDER_EXTERNAL_URL}/api/health`
      : `http://localhost:${PORT}/api/health`;
    setInterval(() => {
      fetch(KEEP_ALIVE_URL).catch(() => {});
    }, 14 * 60 * 1000); // 14 分鐘
    console.log('[Keep-alive] 每 14 分鐘 ping', KEEP_ALIVE_URL);
  }
});

module.exports = app;

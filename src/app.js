require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const path = require('path');
const { processScheduledNotifications } = require('./services/fcmSender');
const { startDigestScheduler } = require('./services/digestScheduler');

const app = express();

// Security middleware
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: false,
}));
app.use(cors({
  origin: true, // 開發環境允許所有來源（含實體手機 IP）
  credentials: true
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  message: { error: '請求過於頻繁，請稍後再試' }
});
app.use('/api/', limiter);

// Stricter rate limit for auth routes
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: '登入嘗試過於頻繁，請於 15 分鐘後再試' }
});

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// 靜態檔案 (上傳的圖片)
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Routes
app.use('/api/auth', authLimiter, require('./routes/auth'));
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
app.use('/api/audit-logs', require('./routes/auditLog'));
app.use('/api/app/home', require('./routes/appHome'));
app.use('/api/app/member', require('./routes/appMember'));

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
});

module.exports = app;

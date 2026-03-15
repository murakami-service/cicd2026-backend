const cron = require('node-cron');
const { fetchAllRssSources, cleanOldArticles } = require('./rssService');
const { cleanOldDigests } = require('./digestGenerator');
const prisma = require('../config/database');
const { sendPushNotification } = require('./fcmSender');

/**
 * 啟動排程任務（RSS 抓取 + 資料清理 + 點數到期提醒）
 */
function startDigestScheduler() {
  // 每 6 小時抓取 RSS（00:00, 06:00, 12:00, 18:00）
  cron.schedule('0 0,6,12,18 * * *', async () => {
    console.log('[Scheduler] RSS 抓取開始');
    try {
      const result = await fetchAllRssSources();
      console.log(`[Scheduler] RSS 抓取完成: ${result.fetched} 篇`);
      if (result.errors.length) {
        console.warn('[Scheduler] RSS 錯誤:', result.errors);
      }
    } catch (e) {
      console.error('[Scheduler] RSS 抓取失敗:', e.message);
    }
  });

  // 每天凌晨 3:00 清理 30 天前的舊資料
  cron.schedule('0 3 * * *', async () => {
    console.log('[Scheduler] 清理舊資料開始');
    try {
      const articles = await cleanOldArticles(30);
      const digests = await cleanOldDigests(30);
      console.log(`[Scheduler] 清理完成: ${articles} 篇文章, ${digests} 篇摘要`);
    } catch (e) {
      console.error('[Scheduler] 清理失敗:', e.message);
    }
  });

  // ============================================
  // 點數到期提醒推播
  // 每年 3/15 上午 10:00 自動推播，提醒所有會員點數即將到期
  // 規則：兩年一期（2025-2026→2027/3/31、2027-2028→2029/3/31）
  // 在到期年（奇數年）的 3/15 發送提醒
  // ============================================
  cron.schedule('0 10 15 3 *', async () => {
    const year = new Date().getFullYear();
    // 只在奇數年發送（到期年：2027, 2029, 2031...）
    if (year % 2 === 0) {
      console.log(`[Scheduler] ${year} 為偶數年，非點數到期年，跳過推播`);
      return;
    }

    console.log(`[Scheduler] ${year}/3/15 點數到期提醒推播開始`);
    try {
      const expiryDate = `${year}/03/31`;
      const notification = await prisma.pushNotification.create({
        data: {
          title: '點數到期提醒',
          body: `您的點數將於 ${expiryDate} 到期歸零，請儘快至「點數兌換」使用您的點數！`,
          targetType: 'ALL',
          status: 'SCHEDULED',
          scheduledAt: new Date(),
        },
      });

      await sendPushNotification(notification);
      console.log(`[Scheduler] 點數到期提醒推播已發送（到期日：${expiryDate}）`);
    } catch (e) {
      console.error('[Scheduler] 點數到期提醒推播失敗:', e.message);
    }
  });

  // ============================================
  // 活動狀態自動更新
  // 每 5 分鐘檢查：startTime 已過切 ONGOING，endTime 已過切 ENDED
  // ============================================
  cron.schedule('*/5 * * * *', async () => {
    try {
      const now = new Date();

      // endTime 已過 → ENDED
      const ended = await prisma.event.updateMany({
        where: {
          endTime: { lte: now },
          status: { notIn: ['ENDED', 'CANCELLED', 'DRAFT'] },
        },
        data: { status: 'ENDED' },
      });

      // startTime 已過但 endTime 未到 → ONGOING（從 OPEN 或 CLOSED 轉換）
      const ongoing = await prisma.event.updateMany({
        where: {
          startTime: { lte: now },
          endTime: { gt: now },
          status: { in: ['OPEN', 'CLOSED'] },
        },
        data: { status: 'ONGOING' },
      });

      if (ended.count > 0 || ongoing.count > 0) {
        console.log(`[Scheduler] 活動狀態更新: ${ended.count} 已結束, ${ongoing.count} 進行中`);
      }
    } catch (e) {
      console.error('[Scheduler] 活動狀態更新失敗:', e.message);
    }
  });

  console.log('[Scheduler] RSS 抓取 + 自動清理 + 點數到期提醒 + 活動狀態排程已啟動');

  // 啟動時立即抓取一次 RSS（避免重啟後等到下個排程才更新）
  setTimeout(async () => {
    try {
      console.log('[Scheduler] 啟動時 RSS 抓取開始');
      const result = await fetchAllRssSources();
      console.log(`[Scheduler] 啟動時 RSS 抓取完成: ${result.fetched} 篇`);
    } catch (e) {
      console.error('[Scheduler] 啟動時 RSS 抓取失敗:', e.message);
    }
  }, 5000); // 延遲 5 秒，等 DB 連線穩定
}

module.exports = { startDigestScheduler };

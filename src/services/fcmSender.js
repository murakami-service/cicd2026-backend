const prisma = require('../config/database');
const { sendToTokens, isAvailable } = require('./firebase');

/**
 * 根據推播通知的 targetType 找出目標會員的 FCM tokens
 */
async function getTargetTokens(notification) {
  const { targetType, targetId, targetValue } = notification;

  let memberIds = [];

  switch (targetType) {
    case 'ALL':
      // 全體會員
      const allMembers = await prisma.member.findMany({
        select: { id: true },
      });
      memberIds = allMembers.map((m) => m.id);
      break;

    case 'EVENT':
      // 活動參加者
      if (!targetId) break;
      const regs = await prisma.eventRegistration.findMany({
        where: { eventId: targetId, status: 'REGISTERED' },
        select: { memberId: true },
      });
      memberIds = regs.map((r) => r.memberId);
      break;

    case 'DISTRICT':
      // 地區
      if (!targetId) break;
      const districtMembers = await prisma.member.findMany({
        where: { districtId: targetId },
        select: { id: true },
      });
      memberIds = districtMembers.map((m) => m.id);
      break;

    case 'MEMBER':
      // 指定會員
      if (targetId) memberIds = [targetId];
      break;

    case 'TERM':
      // 指定期別
      if (!targetValue) break;
      const termMembers = await prisma.member.findMany({
        where: { termNumber: parseInt(targetValue) },
        select: { id: true },
      });
      memberIds = termMembers.map((m) => m.id);
      break;

    case 'CY_TERM':
      // 建青團期別
      if (!targetValue) break;
      const cyMembers = await prisma.member.findMany({
        where: { memberType: 'CY', termNumber: parseInt(targetValue) },
        select: { id: true },
      });
      memberIds = cyMembers.map((m) => m.id);
      break;

    default:
      break;
  }

  if (memberIds.length === 0) return [];

  // 查詢這些會員的 FCM tokens
  const pushTokens = await prisma.pushToken.findMany({
    where: { memberId: { in: memberIds } },
    select: { token: true },
  });

  return pushTokens.map((t) => t.token);
}

/**
 * 發送推播通知
 * @param {object} notification - PushNotification record
 * @returns {{ success: boolean, successCount: number, failureCount: number }}
 */
async function sendPushNotification(notification) {
  const now = new Date();

  // 取得目標 tokens
  const tokens = await getTargetTokens(notification);

  if (tokens.length === 0) {
    // 沒有目標 token，仍標記為已發送（只是沒有裝置接收）
    await prisma.pushNotification.update({
      where: { id: notification.id },
      data: { status: 'SENT', sentAt: now },
    });
    return { success: true, successCount: 0, failureCount: 0 };
  }

  if (!isAvailable()) {
    // Firebase 未設定，標記已發送（開發模式）
    console.log(`[FCM] Firebase 未啟用，跳過實際發送（${tokens.length} 目標 token）`);
    await prisma.pushNotification.update({
      where: { id: notification.id },
      data: { status: 'SENT', sentAt: now },
    });
    return { success: true, successCount: 0, failureCount: 0 };
  }

  try {
    const result = await sendToTokens(
      tokens,
      notification.title,
      notification.body,
      { notificationId: notification.id }
    );

    // 清理失效的 tokens（分批刪除，每批 1000）
    if (result.failedTokens.length > 0) {
      const CHUNK_SIZE = 1000;
      for (let i = 0; i < result.failedTokens.length; i += CHUNK_SIZE) {
        const chunk = result.failedTokens.slice(i, i + CHUNK_SIZE);
        await prisma.pushToken.deleteMany({
          where: { token: { in: chunk } },
        });
      }
      console.log(`[FCM] 清理 ${result.failedTokens.length} 個失效 token`);
    }

    await prisma.pushNotification.update({
      where: { id: notification.id },
      data: { status: 'SENT', sentAt: now },
    });

    return {
      success: true,
      successCount: result.successCount,
      failureCount: result.failureCount,
    };
  } catch (err) {
    console.error('[FCM] 發送失敗:', err.message);
    await prisma.pushNotification.update({
      where: { id: notification.id },
      data: { status: 'FAILED' },
    });
    return { success: false, successCount: 0, failureCount: 0 };
  }
}

/**
 * 處理排程推播（由 cron 呼叫）
 */
async function processScheduledNotifications() {
  const now = new Date();
  const scheduled = await prisma.pushNotification.findMany({
    where: {
      status: 'SCHEDULED',
      scheduledAt: { lte: now },
    },
  });

  if (scheduled.length === 0) return;

  console.log(`[FCM] 處理 ${scheduled.length} 筆排程推播`);

  for (const notification of scheduled) {
    await sendPushNotification(notification);
  }
}

module.exports = { sendPushNotification, processScheduledNotifications };

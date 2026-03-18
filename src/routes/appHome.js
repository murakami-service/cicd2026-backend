const express = require('express');
const prisma = require('../config/database');
const { verifyToken } = require('../middleware/auth');
const { checkPaymentStatus } = require('../services/paymentVerification');

const router = express.Router();

// ============================================
// 共用層快取（30 秒）
// ============================================

let sharedCache = null;
let sharedCacheTime = 0;
const CACHE_TTL = 30 * 1000; // 30 秒

const eventSelect = {
  id: true,
  title: true,
  startTime: true,
  endTime: true,
  location: true,
  status: true,
  targetType: true,
  districtId: true,
  termNumber: true,
  points: true,
  maxParticipants: true,
  registrationDeadline: true,
  coverImage: true,
  district: { select: { name: true } },
  _count: { select: { registrations: { where: { status: 'REGISTERED' } } } },
};

const visibleStatuses = ['OPEN', 'CLOSED', 'ONGOING', 'ENDED', 'CANCELLED'];

// ≤2 則只回 1 則，3 則以上回最多 3 則
function applyMinRule(list) {
  if (list.length <= 2) return list.slice(0, 1);
  return list.slice(0, 3);
}

async function getSharedData() {
  const now = Date.now();
  if (sharedCache && (now - sharedCacheTime) < CACHE_TTL) {
    return sharedCache;
  }

  const result = {};

  // 總會活動（不限數量）
  try {
    result.generalEvents = await prisma.event.findMany({
      where: { targetType: 'GENERAL', status: { in: visibleStatuses } },
      select: eventSelect,
      orderBy: { startTime: 'desc' },
      take: 50,
    });
  } catch (err) { console.error('[appHome] generalEvents 查詢失敗:', err.message); result.generalEvents = []; }

  // 地區活動（全部地區混合）
  try {
    const all = await prisma.event.findMany({
      where: { targetType: 'DISTRICT', status: { in: visibleStatuses } },
      select: eventSelect,
      orderBy: { startTime: 'desc' },
      take: 5,
    });
    result.districtEvents = applyMinRule(all);
  } catch (err) { console.error('[appHome] districtEvents 查詢失敗:', err.message); result.districtEvents = []; }

  // 特別區活動
  try {
    const all = await prisma.event.findMany({
      where: { targetType: 'SPECIAL', status: { in: visibleStatuses } },
      select: eventSelect,
      orderBy: { startTime: 'desc' },
      take: 5,
    });
    result.specialEvents = applyMinRule(all);
  } catch (err) { console.error('[appHome] specialEvents 查詢失敗:', err.message); result.specialEvents = []; }

  // 建青團活動
  try {
    const all = await prisma.event.findMany({
      where: { targetType: 'CY', status: { in: visibleStatuses } },
      select: eventSelect,
      orderBy: { startTime: 'desc' },
      take: 5,
    });
    result.cyEvents = applyMinRule(all);
  } catch (err) { console.error('[appHome] cyEvents 查詢失敗:', err.message); result.cyEvents = []; }

  // AI 摘要通用版
  try {
    result.generalDigests = await prisma.aiDigest.findMany({
      where: { isDeleted: false, isGeneral: true },
      orderBy: { publishDate: 'desc' },
      take: 5,
    });
  } catch (err) { console.error('[appHome] generalDigests 查詢失敗:', err.message); result.generalDigests = []; }

  sharedCache = result;
  sharedCacheTime = now;
  return result;
}

// ============================================
// APP 首頁 API
// ============================================

router.get('/', verifyToken, async (req, res, next) => {
  try {
    if (!req.member) {
      return res.status(401).json({ error: '請使用會員身分登入' });
    }

    const memberId = req.member.id;
    const memberTermNumber = req.member.termNumber;

    // 共用層（快取）
    const shared = await getSharedData();

    // 個人層（每次查，3 個輕量查詢）
    let unreadCount = 0;
    let termEvents = [];
    let digests = shared.generalDigests;

    // 1. 未讀推播數量（排除已清除的）
    try {
      const readStatus = await prisma.pushReadStatus.findUnique({
        where: { memberId },
      });
      const lastReadAt = readStatus?.lastReadAt || new Date(0);
      const clearedAt = readStatus?.clearedAt || new Date(0);

      // sentAt 必須同時 > lastReadAt 和 > clearedAt
      const afterDate = lastReadAt > clearedAt ? lastReadAt : clearedAt;

      unreadCount = await prisma.pushNotification.count({
        where: {
          status: 'SENT',
          sentAt: { gt: afterDate },
          OR: [
            { targetType: 'ALL' },
            { targetType: 'MEMBER', targetId: memberId },
            { targetType: 'DISTRICT', targetId: req.member.districtId },
          ],
        },
      });
    } catch (err) { console.error('[appHome] unreadCount 查詢失敗:', err.message); unreadCount = 0; }

    // 2. 期別活動（依會員 termNumber）
    try {
      const all = await prisma.event.findMany({
        where: {
          targetType: 'TERM',
          termNumber: memberTermNumber,
          status: { in: visibleStatuses },
        },
        select: eventSelect,
        orderBy: { startTime: 'desc' },
        take: 5,
      });
      termEvents = applyMinRule(all);
    } catch (err) { console.error('[appHome] termEvents 查詢失敗:', err.message); termEvents = []; }

    // 3. AI 摘要（依繳費狀態切換）
    try {
      const paymentResult = await checkPaymentStatus(memberId, 'GENERAL');
      if (paymentResult.hasPaid) {
        // 已繳費 → 客製化摘要（若有），否則回通用
        const custom = await prisma.aiDigest.findMany({
          where: { isDeleted: false, isGeneral: false },
          orderBy: { publishDate: 'desc' },
          take: 5,
        });
        if (custom.length > 0) digests = custom;
      }
    } catch (err) { console.error('[appHome] digests 查詢失敗:', err.message); /* 保持通用摘要 */ }

    // 4. 未繳費帳單數量（決定首頁浮動繳費鈕顯隱）
    let unpaidBillCount = 0;
    try {
      unpaidBillCount = await prisma.bill.count({
        where: { memberId, status: 'UNPAID' },
      });
    } catch (err) { console.error('[appHome] unpaidBillCount 查詢失敗:', err.message); unpaidBillCount = 0; }

    res.json({
      unreadCount,
      unpaidBillCount,
      generalEvents: shared.generalEvents,
      districtEvents: shared.districtEvents,
      termEvents,
      specialEvents: shared.specialEvents,
      cyEvents: shared.cyEvents,
      digests,
    });
  } catch (err) {
    next(err);
  }
});

// 全部已讀（將 lastReadAt 更新為現在，未讀數歸零）
router.put('/read-push', verifyToken, async (req, res, next) => {
  try {
    if (!req.member) {
      return res.status(401).json({ error: '請使用會員身分登入' });
    }

    await prisma.pushReadStatus.upsert({
      where: { memberId: req.member.id },
      update: { lastReadAt: new Date() },
      create: { memberId: req.member.id, lastReadAt: new Date() },
    });

    res.json({ message: '已全部標記已讀' });
  } catch (err) {
    next(err);
  }
});

// 全部清除（設定 clearedAt，APP 推播列表只顯示此時間之後的推播）
router.put('/clear-push', verifyToken, async (req, res, next) => {
  try {
    if (!req.member) {
      return res.status(401).json({ error: '請使用會員身分登入' });
    }

    const now = new Date();
    await prisma.pushReadStatus.upsert({
      where: { memberId: req.member.id },
      update: { clearedAt: now, lastReadAt: now },
      create: { memberId: req.member.id, lastReadAt: now, clearedAt: now },
    });

    res.json({ message: '已全部清除' });
  } catch (err) {
    next(err);
  }
});

// 取得單筆推播詳情
router.get('/push/:id', verifyToken, async (req, res, next) => {
  try {
    const push = await prisma.pushNotification.findUnique({
      where: { id: parseInt(req.params.id) },
      select: { id: true, title: true, body: true, sentAt: true, targetType: true },
    });
    if (!push) return res.status(404).json({ error: '找不到通知' });
    res.json(push);
  } catch (err) {
    next(err);
  }
});

// 單筆刪除（隱藏）推播
router.delete('/push/:id', verifyToken, async (req, res, next) => {
  try {
    if (!req.member) {
      return res.status(401).json({ error: '請使用會員身分登入' });
    }
    const pushId = parseInt(req.params.id);
    const memberId = req.member.id;

    const readStatus = await prisma.pushReadStatus.upsert({
      where: { memberId },
      update: {},
      create: { memberId, lastReadAt: new Date() },
    });

    const dismissed = JSON.parse(readStatus.dismissedIds || '[]');
    if (!dismissed.includes(pushId)) {
      dismissed.push(pushId);
      await prisma.pushReadStatus.update({
        where: { memberId },
        data: { dismissedIds: JSON.stringify(dismissed) },
      });
    }

    res.json({ message: '已刪除' });
  } catch (err) {
    next(err);
  }
});

// APP 推播列表（只顯示 clearedAt 之後的推播，排除已刪除）
router.get('/push-list', verifyToken, async (req, res, next) => {
  try {
    if (!req.member) {
      return res.status(401).json({ error: '請使用會員身分登入' });
    }

    const { page = 1, limit = 20 } = req.query;
    const memberId = req.member.id;

    // 取得清除時間點和已刪除列表
    const readStatus = await prisma.pushReadStatus.findUnique({
      where: { memberId },
    });
    const clearedAt = readStatus?.clearedAt || new Date(0);
    const lastReadAt = readStatus?.lastReadAt || new Date(0);
    const dismissedIds = JSON.parse(readStatus?.dismissedIds || '[]');

    const where = {
      status: 'SENT',
      sentAt: { gt: clearedAt },
      ...(dismissedIds.length > 0 ? { id: { notIn: dismissedIds } } : {}),
      OR: [
        { targetType: 'ALL' },
        { targetType: 'MEMBER', targetId: memberId },
        { targetType: 'DISTRICT', targetId: req.member.districtId },
      ],
    };

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [notifications, total] = await Promise.all([
      prisma.pushNotification.findMany({
        where,
        orderBy: { sentAt: 'desc' },
        skip,
        take: parseInt(limit),
      }),
      prisma.pushNotification.count({ where }),
    ]);

    // 標記每則是否已讀
    const data = notifications.map((n) => ({
      ...n,
      isRead: n.sentAt <= lastReadAt,
    }));

    res.json({
      data,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

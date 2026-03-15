const express = require('express');
const prisma = require('../config/database');
const { verifyToken, scopeByAdmin } = require('../middleware/auth');
const { sendPushNotification } = require('../services/fcmSender');

const router = express.Router();

// 推播紀錄列表
router.get('/', verifyToken, async (req, res, next) => {
  try {
    const { status, page = 1, limit = 10 } = req.query;
    const skip = (page - 1) * limit;

    const where = {};
    if (status) where.status = status;

    const [notifications, total] = await Promise.all([
      prisma.pushNotification.findMany({
        where,
        skip: parseInt(skip),
        take: parseInt(limit),
        orderBy: { createdAt: 'desc' },
      }),
      prisma.pushNotification.count({ where }),
    ]);

    res.json({
      data: notifications,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    next(err);
  }
});

// 取得可選活動（進行中或已結束，供推播選擇）
router.get('/events', verifyToken, async (req, res, next) => {
  try {
    const events = await prisma.event.findMany({
      where: { status: { not: 'DRAFT' } },
      select: { id: true, title: true, status: true, startTime: true },
      orderBy: { startTime: 'desc' },
      take: 50,
    });
    res.json(events);
  } catch (err) {
    next(err);
  }
});

// 取得地區列表
router.get('/districts', verifyToken, async (req, res, next) => {
  try {
    const districts = await prisma.district.findMany({
      select: { id: true, name: true, type: true },
      orderBy: { name: 'asc' },
    });
    res.json(districts);
  } catch (err) {
    next(err);
  }
});

// 取得期別列表（從會員資料中抓取不重複的期別）
router.get('/terms', verifyToken, async (req, res, next) => {
  try {
    const terms = await prisma.member.groupBy({
      by: ['termNumber'],
      where: { termNumber: { not: null } },
      orderBy: { termNumber: 'desc' },
    });
    res.json(terms.map(t => t.termNumber));
  } catch (err) {
    next(err);
  }
});

// 取得建青團期別列表（memberType=CY 的 termNumber）
router.get('/cy-terms', verifyToken, async (req, res, next) => {
  try {
    const terms = await prisma.member.groupBy({
      by: ['termNumber'],
      where: { memberType: 'CY', termNumber: { not: null } },
      orderBy: { termNumber: 'desc' },
    });
    res.json(terms.map(t => t.termNumber));
  } catch (err) {
    next(err);
  }
});

// 發送推播
router.post('/', verifyToken, scopeByAdmin, async (req, res, next) => {
  try {
    const { title, body, targetType, targetId, targetValue, scheduledAt } = req.body;

    if (!title || !body || !targetType) {
      return res.status(400).json({ error: '標題、內容與對象為必填' });
    }

    const notification = await prisma.pushNotification.create({
      data: {
        title,
        body,
        targetType,
        targetId: targetId ? parseInt(targetId) : null,
        targetValue: targetValue || null,
        scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
        status: scheduledAt ? 'SCHEDULED' : 'PENDING',
      },
    });

    // 非排程 → 立即發送
    if (!scheduledAt) {
      const result = await sendPushNotification(notification);
      return res.status(201).json({
        ...notification,
        status: 'SENT',
        sentAt: new Date(),
        fcm: {
          successCount: result.successCount,
          failureCount: result.failureCount,
        },
      });
    }

    res.status(201).json(notification);
  } catch (err) {
    next(err);
  }
});

module.exports = router;

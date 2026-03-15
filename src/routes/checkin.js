const express = require('express');
const prisma = require('../config/database');
const { verifyToken } = require('../middleware/auth');

const router = express.Router();

// QR Code 簽到
router.post('/scan', verifyToken, async (req, res, next) => {
  try {
    const { qrCode, memberId } = req.body;

    if (!qrCode || !memberId) {
      return res.status(400).json({ error: '缺少必要參數' });
    }

    // 找到對應活動
    const event = await prisma.event.findUnique({
      where: { qrCode },
    });

    if (!event) {
      return res.status(404).json({ error: '無效的 QR Code' });
    }

    // 檢查活動狀態（只有 CLOSED 或 ONGOING 才可簽到）
    if (!['CLOSED', 'ONGOING'].includes(event.status)) {
      const statusMsg = {
        DRAFT: '活動尚未發布',
        OPEN: '活動尚在報名中，尚未開放簽到',
        ENDED: '活動已結束',
        CANCELLED: '活動已取消',
      };
      return res.status(400).json({ error: statusMsg[event.status] || '目前無法簽到' });
    }

    // 檢查簽到時間：活動開始前2小時才可簽到
    const now = new Date();
    const twoHoursBefore = new Date(event.startTime.getTime() - 2 * 60 * 60 * 1000);
    const eventDay = event.startTime.toDateString();
    const today = now.toDateString();

    if (today !== eventDay || now < twoHoursBefore) {
      return res.status(400).json({ error: '尚未開放簽到（活動開始前2小時開放）' });
    }

    // 檢查是否已報名（isFreeOpen = 不限區別報名，仍需完成報名流程才可簽到）
    const registration = await prisma.eventRegistration.findUnique({
      where: {
        eventId_memberId: {
          eventId: event.id,
          memberId: parseInt(memberId),
        },
      },
    });

    if (!registration || registration.status !== 'REGISTERED') {
      return res.status(400).json({ error: '您尚未報名此活動' });
    }

    // 檢查是否已簽到
    const existing = await prisma.checkin.findUnique({
      where: {
        eventId_memberId: {
          eventId: event.id,
          memberId: parseInt(memberId),
        },
      },
    });

    if (existing) {
      return res.status(400).json({ error: '您已簽到過此活動' });
    }

    // 執行簽到 + 發放點數（原子事務，確保一致性）
    let pointsAwarded = 0;
    const result = await prisma.$transaction(async (tx) => {
      // 事務內再次確認未重複簽到（防止並發請求）
      const duplicate = await tx.checkin.findUnique({
        where: { eventId_memberId: { eventId: event.id, memberId: parseInt(memberId) } },
      });
      if (duplicate) {
        throw Object.assign(new Error('您已簽到過此活動'), { statusCode: 400 });
      }

      const checkin = await tx.checkin.create({
        data: {
          eventId: event.id,
          memberId: parseInt(memberId),
        },
      });

      // 如果活動有點數，在同一事務內發放
      if (event.points > 0) {
        const now = new Date();
        const year = now.getFullYear();
        const expiryYear = year % 2 === 1 ? year + 2 : year + 1;
        const expiresAt = new Date(`${expiryYear}-03-31T23:59:59`);

        await tx.pointRecord.create({
          data: {
            memberId: parseInt(memberId),
            points: event.points,
            type: 'CHECKIN',
            source: event.title,
            eventId: event.id,
            expiresAt,
          },
        });
        pointsAwarded = event.points;
      }

      return checkin;
    });

    res.json({
      message: '簽到成功',
      checkin: result,
      pointsAwarded,
    });
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    next(err);
  }
});

// 活動簽到紀錄（支援分頁）
router.get('/event/:eventId', verifyToken, async (req, res, next) => {
  try {
    const { page = 1, limit = 50 } = req.query;
    const skip = (page - 1) * limit;
    const eventId = parseInt(req.params.eventId);

    const [checkins, total] = await Promise.all([
      prisma.checkin.findMany({
        where: { eventId },
        skip: parseInt(skip),
        take: parseInt(limit),
        include: {
          member: {
            select: { account: true, name: true, district: { select: { name: true } } },
          },
        },
        orderBy: { checkinAt: 'asc' },
      }),
      prisma.checkin.count({ where: { eventId } }),
    ]);

    res.json({
      data: checkins,
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

module.exports = router;

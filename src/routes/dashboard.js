const express = require('express');
const prisma = require('../config/database');
const { verifyToken, scopeByAdmin } = require('../middleware/auth');

const router = express.Router();

// 後台首頁 Dashboard
router.get('/', verifyToken, scopeByAdmin, async (req, res, next) => {
  try {
    const now = new Date();

    // 1. 目前會員數 + 2 & 3. 總會已繳費批次（並行查詢）
    const [totalMembers, generalBatch] = await Promise.all([
      prisma.member.count({
        where: { isActive: true },
      }),
      prisma.billingBatch.findFirst({
        where: {
          targetType: 'GENERAL',
          status: 'ACTIVE',
          endDate: { gte: now },
        },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    let paidMembers = 0;
    let unpaidMembers = 0;
    let paymentRate = '0';

    if (generalBatch) {
      const billStats = await prisma.bill.groupBy({
        by: ['status'],
        where: { batchId: generalBatch.id },
        _count: true,
      });
      const totalBills = billStats.reduce((sum, s) => sum + s._count, 0);
      const paidCount = billStats
        .filter(s => s.status === 'PAID' || s.status === 'MANUAL')
        .reduce((sum, s) => sum + s._count, 0);

      paidMembers = paidCount;
      unpaidMembers = totalBills - paidCount;
      paymentRate = totalBills > 0 ? ((paidCount / totalBills) * 100).toFixed(1) : '0';
    }

    // 4. 上月總會活動參與度
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);

    const lastMonthEvents = await prisma.event.findMany({
      where: {
        targetType: 'GENERAL',
        startTime: { gte: lastMonthStart, lte: lastMonthEnd },
        status: { notIn: ['DRAFT', 'CANCELLED'] },
      },
      include: {
        _count: { select: { registrations: { where: { status: 'REGISTERED' } }, checkins: true } },
      },
    });

    let lastMonthParticipation = '0';
    if (lastMonthEvents.length > 0) {
      const totalRate = lastMonthEvents.reduce((sum, event) => {
        const rate = event._count.registrations > 0
          ? (event._count.checkins / event._count.registrations) * 100
          : 0;
        return sum + rate;
      }, 0);
      lastMonthParticipation = (totalRate / lastMonthEvents.length).toFixed(1);
    }

    // 5. 最近活動列表 + 7. 繳費比例（並行查詢）
    const [recentEvents, activeBatches] = await Promise.all([
      prisma.event.findMany({
        where: {
          status: { notIn: ['DRAFT', 'CANCELLED'] },
        },
        include: {
          district: { select: { name: true } },
          _count: { select: { registrations: { where: { status: 'REGISTERED' } }, checkins: true } },
        },
        orderBy: { startTime: 'desc' },
        take: 10,
      }),
      prisma.billingBatch.findMany({
        where: { status: 'ACTIVE' },
        include: {
          district: { select: { name: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 5,
      }),
    ]);

    const activeBatchIds = activeBatches.map(b => b.id);
    const allActiveBillStats = activeBatchIds.length > 0
      ? await prisma.bill.groupBy({
          by: ['batchId', 'status'],
          where: { batchId: { in: activeBatchIds } },
          _count: true,
        })
      : [];

    const activeBillMap = new Map();
    for (const row of allActiveBillStats) {
      if (!activeBillMap.has(row.batchId)) activeBillMap.set(row.batchId, []);
      activeBillMap.get(row.batchId).push(row);
    }

    const batchStats = activeBatches.map(batch => {
      const stats = activeBillMap.get(batch.id) || [];
      const total = stats.reduce((sum, s) => sum + s._count, 0);
      const paid = stats
        .filter(s => s.status === 'PAID' || s.status === 'MANUAL')
        .reduce((sum, s) => sum + s._count, 0);
      return {
        id: batch.id,
        title: batch.title,
        district: batch.district?.name || '總會',
        total,
        paid,
        unpaid: total - paid,
        rate: total > 0 ? ((paid / total) * 100).toFixed(1) : '0',
      };
    });

    // 8. 最近繳費 + A. 待辦提醒（並行查詢）
    const weekLater = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const [recentPayments, upcomingEvents, expiringBatches, activeElections, pendingPush] = await Promise.all([
      // 8. 最近繳費名單（最新 10 筆）
      prisma.bill.findMany({
        where: {
          status: { in: ['PAID', 'MANUAL'] },
          paymentDate: { not: null },
        },
        include: {
          member: { select: { account: true, name: true } },
          batch: { select: { title: true } },
        },
        orderBy: { paymentDate: 'desc' },
        take: 10,
      }),
      // A-1. 本週即將開始的活動
      prisma.event.findMany({
        where: {
          status: { in: ['OPEN', 'CLOSED'] },
          startTime: { gte: now, lte: weekLater },
        },
        select: { id: true, title: true, startTime: true, status: true },
        orderBy: { startTime: 'asc' },
        take: 5,
      }),
      // A-2. 即將截止的繳費批次（7 天內到期）
      prisma.billingBatch.findMany({
        where: {
          status: 'ACTIVE',
          endDate: { gte: now, lte: weekLater },
        },
        select: { id: true, title: true, endDate: true },
        orderBy: { endDate: 'asc' },
        take: 5,
      }),
      // A-3. 進行中的投票
      prisma.election.findMany({
        where: {
          status: 'OPEN',
          endTime: { gte: now },
        },
        select: { id: true, title: true, endTime: true },
        orderBy: { endTime: 'asc' },
        take: 5,
      }),
      // A-4. 待發送的排程推播
      prisma.pushNotification.count({
        where: { status: 'PENDING' },
      }),
    ]);

    const todos = {
      upcomingEvents: upcomingEvents.map(e => ({
        id: e.id,
        type: 'event',
        title: e.title,
        deadline: e.startTime,
        label: '活動即將開始',
      })),
      expiringBatches: expiringBatches.map(b => ({
        id: b.id,
        type: 'billing',
        title: b.title,
        deadline: b.endDate,
        label: '繳費即將截止',
      })),
      activeElections: activeElections.map(el => ({
        id: el.id,
        type: 'election',
        title: el.title,
        deadline: el.endTime,
        label: '投票進行中',
      })),
      pendingPushCount: pendingPush,
    };

    // B. 推播統計（並行查詢）
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [pushStats, recentPushList] = await Promise.all([
      prisma.pushNotification.groupBy({
        by: ['status'],
        where: { createdAt: { gte: thirtyDaysAgo } },
        _count: true,
      }),
      prisma.pushNotification.findMany({
        where: { createdAt: { gte: thirtyDaysAgo } },
        select: { id: true, title: true, targetType: true, status: true, sentAt: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 5,
      }),
    ]);

    const pushSummary = {
      total: pushStats.reduce((sum, s) => sum + s._count, 0),
      sent: pushStats.filter(s => s.status === 'SENT').reduce((sum, s) => sum + s._count, 0),
      pending: pushStats.filter(s => s.status === 'PENDING').reduce((sum, s) => sum + s._count, 0),
      failed: pushStats.filter(s => s.status === 'FAILED').reduce((sum, s) => sum + s._count, 0),
      recentList: recentPushList,
    };

    // C. 點數概況（並行查詢）
    const [pointsIssued, pointsRedeemed, topProducts] = await Promise.all([
      prisma.pointRecord.aggregate({
        where: {
          type: { in: ['CHECKIN', 'MANUAL'] },
          expiresAt: { gt: now }, // 未過期的
        },
        _sum: { points: true },
        _count: true,
      }),
      prisma.pointRedemption.aggregate({
        _sum: { points: true },
        _count: true,
      }),
      // 熱門兌換商品 TOP 3
      prisma.pointRedemption.groupBy({
        by: ['productId'],
        _count: { productId: true },
        _sum: { points: true },
        orderBy: { _count: { productId: 'desc' } },
        take: 3,
      }),
    ]);

    let topProductDetails = [];
    if (topProducts.length > 0) {
      const productIds = topProducts.map(p => p.productId);
      const products = await prisma.redeemProduct.findMany({
        where: { id: { in: productIds } },
        select: { id: true, name: true, points: true },
      });
      const productMap = new Map(products.map(p => [p.id, p]));

      topProductDetails = topProducts.map(tp => ({
        productId: tp.productId,
        name: productMap.get(tp.productId)?.name || '未知商品',
        costPoints: productMap.get(tp.productId)?.points || 0,
        redeemCount: typeof tp._count === 'object' ? tp._count.productId : tp._count,
        totalPoints: tp._sum.points || 0,
      }));
    }

    const pointsSummary = {
      totalIssued: pointsIssued._sum.points || 0,
      issuedCount: pointsIssued._count,
      totalRedeemed: pointsRedeemed._sum.points || 0,
      redeemedCount: pointsRedeemed._count,
      topProducts: topProductDetails,
    };

    res.json({
      totalMembers,
      paidMembers,
      unpaidMembers,
      lastMonthParticipation: `${lastMonthParticipation}%`,
      lastMonthEventCount: lastMonthEvents.length,
      recentEvents: recentEvents.map((e) => ({
        id: e.id,
        title: e.title,
        startTime: e.startTime,
        location: e.location,
        district: e.district?.name || '總會',
        status: e.status,
        registrations: e._count.registrations,
        checkins: e._count.checkins,
      })),
      paymentRate: `${paymentRate}%`,
      batchStats,
      recentPayments: recentPayments.map((p) => ({
        memberAccount: p.member?.account || '未知',
        memberName: p.member?.name || '未知',
        batchTitle: p.batch?.title || '未知',
        amount: p.amount,
        paymentMethod: p.paymentMethod,
        paymentDate: p.paymentDate,
        status: p.status,
      })),
      // 新增
      todos,
      pushSummary,
      pointsSummary,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

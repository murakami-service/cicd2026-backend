const express = require('express');
const prisma = require('../config/database');
const { verifyToken, scopeByAdmin } = require('../middleware/auth');

const router = express.Router();

// 後台首頁 Dashboard
router.get('/', verifyToken, scopeByAdmin, async (req, res, next) => {
  try {
    const now = new Date();

    // 1. 目前會員數
    const totalMembers = await prisma.member.count({
      where: { isActive: true },
    });

    // 2 & 3. 總會已繳費 / 未繳費會員數
    // 找到目前有效的總會繳費批次
    const generalBatch = await prisma.billingBatch.findFirst({
      where: {
        targetType: 'GENERAL',
        status: 'ACTIVE',
        endDate: { gte: now },
      },
      orderBy: { createdAt: 'desc' },
    });

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

    // 5. 最近活動列表（最近 10 筆）
    const recentEvents = await prisma.event.findMany({
      where: {
        status: { notIn: ['DRAFT', 'CANCELLED'] },
      },
      include: {
        district: { select: { name: true } },
        _count: { select: { registrations: { where: { status: 'REGISTERED' } }, checkins: true } },
      },
      orderBy: { startTime: 'desc' },
      take: 10,
    });

    // 7. 繳費比例（所有進行中的批次）
    const activeBatches = await prisma.billingBatch.findMany({
      where: { status: 'ACTIVE' },
      include: {
        district: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });

    // 批次查詢所有 active batch 的繳費統計（避免 N+1）
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

    // 8. 最近繳費名單（最新 10 筆）
    const recentPayments = await prisma.bill.findMany({
      where: {
        status: { in: ['PAID', 'MANUAL'] },
      },
      include: {
        member: { select: { account: true, name: true } },
        batch: { select: { title: true } },
      },
      orderBy: { paymentDate: 'desc' },
      take: 10,
    });

    res.json({
      // 1. 會員總數
      totalMembers,
      // 2. 總會已繳費
      paidMembers,
      // 3. 未繳費
      unpaidMembers,
      // 4. 上月活動參與度
      lastMonthParticipation: `${lastMonthParticipation}%`,
      lastMonthEventCount: lastMonthEvents.length,
      // 5. 最近活動
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
      // 7. 繳費比例
      paymentRate: `${paymentRate}%`,
      batchStats,
      // 8. 最近繳費名單
      recentPayments: recentPayments.map((p) => ({
        memberAccount: p.member.account,
        memberName: p.member.name,
        batchTitle: p.batch.title,
        amount: p.amount,
        paymentMethod: p.paymentMethod,
        paymentDate: p.paymentDate,
        status: p.status,
      })),
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

const express = require('express');
const prisma = require('../config/database');
const { verifyToken, scopeByAdmin } = require('../middleware/auth');

const router = express.Router();

// 繳費批次列表
router.get('/batches', verifyToken, scopeByAdmin, async (req, res, next) => {
  try {
    const { status, targetType, page = 1, limit = 10 } = req.query;
    const skip = (page - 1) * limit;

    const where = {};
    if (req.scope.districtId) where.districtId = req.scope.districtId;
    if (req.scope.termNumber) where.termNumber = req.scope.termNumber;
    if (status) where.status = status;
    if (targetType) where.targetType = targetType;

    const [batches, total] = await Promise.all([
      prisma.billingBatch.findMany({
        where,
        skip: parseInt(skip),
        take: parseInt(limit),
        include: {
          district: { select: { name: true } },
          _count: { select: { bills: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.billingBatch.count({ where }),
    ]);

    // 批次查詢所有繳費統計（避免 N+1）
    const batchIds = batches.map(b => b.id);
    const allBillStats = batchIds.length > 0
      ? await prisma.bill.groupBy({
          by: ['batchId', 'status'],
          where: { batchId: { in: batchIds } },
          _count: true,
          _sum: { amount: true },
        })
      : [];

    // 建立 batchId → stats 的映射
    const statsMap = new Map();
    for (const row of allBillStats) {
      if (!statsMap.has(row.batchId)) statsMap.set(row.batchId, []);
      statsMap.get(row.batchId).push(row);
    }

    const batchesWithStats = batches.map(batch => {
      const stats = statsMap.get(batch.id) || [];
      const totalBills = batch._count.bills;
      const paidCount = stats
        .filter(s => s.status === 'PAID' || s.status === 'MANUAL')
        .reduce((sum, s) => sum + s._count, 0);
      const paidAmount = stats
        .filter(s => s.status === 'PAID' || s.status === 'MANUAL')
        .reduce((sum, s) => sum + (Number(s._sum.amount) || 0), 0);

      return {
        ...batch,
        stats: {
          total: totalBills,
          paid: paidCount,
          unpaid: totalBills - paidCount,
          paidAmount,
          paymentRate: totalBills > 0 ? ((paidCount / totalBills) * 100).toFixed(1) : '0',
        },
      };
    });

    res.json({
      data: batchesWithStats,
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

// 發行繳費單
router.post('/batches', verifyToken, scopeByAdmin, async (req, res, next) => {
  try {
    const { title, amount, billingType, targetType, districtId, termNumber, memberType, note, startDate, endDate } = req.body;

    if (!title || !amount || !targetType || !startDate || !endDate) {
      return res.status(400).json({ error: '請填寫所有必填欄位' });
    }

    // 建立批次
    const batch = await prisma.billingBatch.create({
      data: {
        title,
        amount: parseFloat(amount),
        billingType: billingType || 'ANNUAL',
        targetType,
        districtId: districtId ? parseInt(districtId) : null,
        termNumber: termNumber ? parseInt(termNumber) : null,
        memberType: memberType || null,
        note,
        startDate: new Date(startDate),
        endDate: new Date(endDate),
        createdById: req.admin.id,
      },
    });

    // 查詢目標會員
    const memberWhere = {};
    switch (targetType) {
      case 'GENERAL':
        break; // 全體會員
      case 'DISTRICT':
        memberWhere.districtId = parseInt(districtId);
        break;
      case 'TERM':
        memberWhere.termNumber = parseInt(termNumber);
        break;
      case 'CY':
        memberWhere.memberType = 'CY';
        break;
      case 'SPECIAL':
        // 特別區需透過 MemberSpecialDistrict 查詢
        break;
    }

    let members;
    if (targetType === 'SPECIAL') {
      const specialMembers = await prisma.memberSpecialDistrict.findMany({
        where: { districtId: parseInt(districtId) },
        select: { memberId: true },
      });
      members = specialMembers.map((m) => ({ id: m.memberId }));
    } else {
      members = await prisma.member.findMany({
        where: { ...memberWhere, isActive: true },
        select: { id: true },
      });
    }

    // 批次建立繳費單
    if (members.length > 0) {
      await prisma.bill.createMany({
        data: members.map((m) => ({
          batchId: batch.id,
          memberId: m.id,
          amount: parseFloat(amount),
          status: 'UNPAID',
        })),
      });
    }

    res.status(201).json({
      batch,
      billCount: members.length,
      message: `已對 ${members.length} 人發行繳費單`,
    });
  } catch (err) {
    next(err);
  }
});

// 批次統計（全域，不受分頁影響）
router.get('/batches/:batchId/stats', verifyToken, scopeByAdmin, async (req, res, next) => {
  try {
    const batchId = parseInt(req.params.batchId);
    const [batch, statusCounts] = await Promise.all([
      prisma.billingBatch.findUnique({
        where: { id: batchId },
        select: { id: true, title: true, amount: true, billingType: true, targetType: true, startDate: true, endDate: true, note: true, createdAt: true },
      }),
      prisma.bill.groupBy({
        by: ['status'],
        where: { batchId },
        _count: true,
      }),
    ]);
    if (!batch) return res.status(404).json({ error: '找不到此繳費批次' });

    const counts = { UNPAID: 0, PAID: 0, MANUAL: 0, VOIDED: 0 };
    statusCounts.forEach(s => { counts[s.status] = s._count; });
    const total = counts.UNPAID + counts.PAID + counts.MANUAL + counts.VOIDED;
    const paidTotal = counts.PAID + counts.MANUAL;

    res.json({
      ...batch,
      stats: {
        total,
        paid: paidTotal,
        unpaid: counts.UNPAID,
        voided: counts.VOIDED,
        paidRate: total > 0 ? Math.round((paidTotal / (total - counts.VOIDED)) * 100) : 0,
      },
    });
  } catch (err) {
    next(err);
  }
});

// 批次內繳費明細
router.get('/batches/:batchId/bills', verifyToken, scopeByAdmin, async (req, res, next) => {
  try {
    const { status, search, page = 1, limit = 10 } = req.query;
    const batchId = parseInt(req.params.batchId);
    const skip = (page - 1) * limit;

    const where = { batchId };
    if (status) where.status = status;
    if (search) {
      where.member = {
        OR: [
          { account: { contains: search } },
          { name: { contains: search } },
        ],
      };
    }

    const [bills, total] = await Promise.all([
      prisma.bill.findMany({
        where,
        skip: parseInt(skip),
        take: parseInt(limit),
        include: {
          member: {
            select: { account: true, name: true, districtId: true, termNumber: true, district: { select: { name: true } } },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.bill.count({ where }),
    ]);

    res.json({
      data: bills,
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

// 手動入帳
router.put('/bills/:billId/manual-pay', verifyToken, scopeByAdmin, async (req, res, next) => {
  try {
    const { paymentMethod, bankAccount, transferTime, receiptUrl, note } = req.body;

    if (!paymentMethod) {
      return res.status(400).json({ error: '請選擇繳款方式' });
    }

    const bill = await prisma.bill.update({
      where: { id: parseInt(req.params.billId) },
      data: {
        status: 'MANUAL',
        paymentMethod,
        paymentDate: new Date(),
        bankAccount,
        transferTime: transferTime ? new Date(transferTime) : null,
        receiptUrl,
        operatorName: req.admin.name || req.admin.username,
        note,
      },
    });

    res.json(bill);
  } catch (err) {
    next(err);
  }
});

// 作廢繳費單
router.put('/bills/:billId/void', verifyToken, scopeByAdmin, async (req, res, next) => {
  try {
    const bill = await prisma.bill.update({
      where: { id: parseInt(req.params.billId) },
      data: { status: 'VOIDED' },
    });

    res.json(bill);
  } catch (err) {
    next(err);
  }
});

// 刪除繳費批次（僅 SUPER 管理者）
router.delete('/batches/:batchId', verifyToken, scopeByAdmin, async (req, res, next) => {
  try {
    if (!req.admin || req.admin.role !== 'SUPER') {
      return res.status(403).json({ error: '僅總管理者可刪除繳費批次' });
    }

    const batchId = parseInt(req.params.batchId);

    // 確認批次存在
    const batch = await prisma.billingBatch.findUnique({ where: { id: batchId } });
    if (!batch) {
      return res.status(404).json({ error: '找不到該繳費批次' });
    }

    // 先刪除所有關聯帳單，再刪除批次（cascade）
    await prisma.$transaction([
      prisma.bill.deleteMany({ where: { batchId } }),
      prisma.billingBatch.delete({ where: { id: batchId } }),
    ]);

    res.json({ message: `已刪除繳費批次「${batch.title}」及所有關聯帳單` });
  } catch (err) {
    next(err);
  }
});

// 會員繳費總覽（跨批次）
router.get('/overview', verifyToken, scopeByAdmin, async (req, res, next) => {
  try {
    const { search, status, page = 1, limit = 10 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // 找出有繳費單的會員，加上搜尋條件
    const memberWhere = {
      bills: { some: {} },
    };
    if (req.scope.districtId) memberWhere.districtId = req.scope.districtId;
    if (search) {
      memberWhere.OR = [
        { account: { contains: search } },
        { name: { contains: search } },
      ];
    }

    // 先查所有符合條件的會員 + 帳單統計
    const allMembers = await prisma.member.findMany({
      where: memberWhere,
      select: {
        id: true,
        account: true,
        name: true,
        districtId: true,
        district: { select: { name: true } },
        bills: {
          where: { status: { not: 'VOIDED' } },
          select: { status: true, amount: true },
        },
      },
      orderBy: { account: 'asc' },
    });

    // 計算每位會員的統計
    const membersWithStats = allMembers.map((m) => {
      const totalBills = m.bills.length;
      const paidCount = m.bills.filter(
        (b) => b.status === 'PAID' || b.status === 'MANUAL'
      ).length;
      const unpaidCount = m.bills.filter((b) => b.status === 'UNPAID').length;
      const paidAmount = m.bills
        .filter((b) => b.status === 'PAID' || b.status === 'MANUAL')
        .reduce((sum, b) => sum + Number(b.amount), 0);

      return {
        id: m.id,
        account: m.account,
        name: m.name,
        district: m.district?.name || '-',
        totalBills,
        paidCount,
        unpaidCount,
        paidAmount,
      };
    });

    // 依 status 篩選
    let filtered = membersWithStats;
    if (status === 'has_unpaid') {
      filtered = filtered.filter((m) => m.unpaidCount > 0);
    } else if (status === 'all_paid') {
      filtered = filtered.filter((m) => m.unpaidCount === 0);
    }

    const total = filtered.length;
    const data = filtered.slice(skip, skip + parseInt(limit));

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

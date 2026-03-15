const express = require('express');
const prisma = require('../config/database');
const { verifyToken, scopeByAdmin } = require('../middleware/auth');

const router = express.Router();

// 會員點數餘額查詢
router.get('/balance/:memberId', verifyToken, async (req, res, next) => {
  try {
    const memberId = parseInt(req.params.memberId);
    const now = new Date();

    const records = await prisma.pointRecord.findMany({
      where: {
        memberId,
        expiresAt: { gt: now },
      },
    });

    const balance = records.reduce((sum, r) => sum + r.points, 0);

    res.json({ memberId, balance });
  } catch (err) {
    next(err);
  }
});

// 點數紀錄（支援分頁）
router.get('/history/:memberId', verifyToken, async (req, res, next) => {
  try {
    const { page = 1, limit = 25 } = req.query;
    const skip = (page - 1) * limit;
    const memberId = parseInt(req.params.memberId);

    const [records, total] = await Promise.all([
      prisma.pointRecord.findMany({
        where: { memberId },
        skip: parseInt(skip),
        take: parseInt(limit),
        orderBy: { createdAt: 'desc' },
      }),
      prisma.pointRecord.count({ where: { memberId } }),
    ]);

    res.json({
      data: records,
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

// 人工送點
router.post('/manual', verifyToken, scopeByAdmin, async (req, res, next) => {
  try {
    const { memberId, points, source } = req.body;

    if (!memberId || !points || !source) {
      return res.status(400).json({ error: '會員、點數與原因為必填' });
    }

    const now = new Date();
    // 點數到期日：兩年一期歸零
    // 2025-2026 → 2027/3/31、2027-2028 → 2029/3/31（奇數年+2，偶數年+1）
    const year = now.getFullYear();
    const expiryYear = year % 2 === 1 ? year + 2 : year + 1;
    const expiresAt = new Date(`${expiryYear}-03-31T23:59:59`);

    const record = await prisma.pointRecord.create({
      data: {
        memberId: parseInt(memberId),
        points: parseInt(points),
        type: 'MANUAL',
        source,
        expiresAt,
      },
    });

    res.status(201).json(record);
  } catch (err) {
    next(err);
  }
});

// 兌換商品列表（前台 — 僅上架商品）
router.get('/products', verifyToken, async (req, res, next) => {
  try {
    const { category } = req.query;
    const where = { status: 'ACTIVE' };
    if (category) where.categoryId = parseInt(category);

    const products = await prisma.redeemProduct.findMany({
      where,
      include: { category: { select: { name: true } } },
      orderBy: { sortOrder: 'asc' },
    });

    res.json(products);
  } catch (err) {
    next(err);
  }
});

// 兌換商品
router.post('/redeem', verifyToken, async (req, res, next) => {
  try {
    const { memberId, productId } = req.body;
    const now = new Date();

    const product = await prisma.redeemProduct.findUnique({
      where: { id: parseInt(productId) },
    });

    if (!product || product.status !== 'ACTIVE') {
      return res.status(404).json({ error: '商品不存在或已下架' });
    }

    if (product.stock <= 0) {
      return res.status(400).json({ error: '商品已無庫存' });
    }

    // 查詢可用點數
    const records = await prisma.pointRecord.findMany({
      where: { memberId: parseInt(memberId), expiresAt: { gt: now } },
    });
    const balance = records.reduce((sum, r) => sum + r.points, 0);

    if (balance < product.pointCost) {
      return res.status(400).json({ error: `點數不足，需要 ${product.pointCost} 點，目前餘額 ${balance} 點` });
    }

    // 扣除點數 + 減庫存 + 兌換次數+1
    // 扣點紀錄不過期（永久保留帳務記錄）
    const expiresAt = new Date('2099-12-31T23:59:59');

    await prisma.$transaction([
      prisma.pointRecord.create({
        data: {
          memberId: parseInt(memberId),
          points: -product.pointCost,
          type: 'REDEEM',
          source: `兌換商品：${product.name}`,
          expiresAt,
        },
      }),
      prisma.pointRedemption.create({
        data: {
          memberId: parseInt(memberId),
          productId: parseInt(productId),
          points: product.pointCost,
        },
      }),
      prisma.redeemProduct.update({
        where: { id: parseInt(productId) },
        data: {
          stock: { decrement: 1 },
          redeemCount: { increment: 1 },
        },
      }),
    ]);

    res.json({ message: `成功兌換 ${product.name}` });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

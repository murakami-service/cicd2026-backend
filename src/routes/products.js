const express = require('express');
const multer = require('multer');
const path = require('path');
const prisma = require('../config/database');
const { verifyToken, requireRole } = require('../middleware/auth');

const router = express.Router();

// 所有操作限定總管理者
router.use(verifyToken, requireRole('SUPER'));

// ============================================
// 商品分類
// ============================================

// 分類列表
router.get('/categories', async (req, res, next) => {
  try {
    const categories = await prisma.productCategory.findMany({
      include: { _count: { select: { products: true } } },
      orderBy: { sortOrder: 'asc' },
    });

    res.json(categories);
  } catch (err) {
    next(err);
  }
});

// 新增分類
router.post('/categories', async (req, res, next) => {
  try {
    const { name, sortOrder } = req.body;

    if (!name) {
      return res.status(400).json({ error: '分類名稱為必填' });
    }

    const category = await prisma.productCategory.create({
      data: { name, sortOrder: sortOrder || 0, isActive: true },
    });

    res.status(201).json(category);
  } catch (err) {
    if (err.code === 'P2002') {
      return res.status(409).json({ error: '此分類名稱已存在' });
    }
    next(err);
  }
});

// 修改分類
router.put('/categories/:id', async (req, res, next) => {
  try {
    const { name, sortOrder, isActive } = req.body;

    const category = await prisma.productCategory.update({
      where: { id: parseInt(req.params.id) },
      data: { name, sortOrder, isActive },
    });

    res.json(category);
  } catch (err) {
    next(err);
  }
});

// 刪除分類
router.delete('/categories/:id', async (req, res, next) => {
  try {
    // 檢查是否有商品使用此分類
    const count = await prisma.redeemProduct.count({
      where: { categoryId: parseInt(req.params.id) },
    });

    if (count > 0) {
      return res.status(400).json({ error: `此分類下有 ${count} 個商品，請先移除或變更商品分類` });
    }

    await prisma.productCategory.delete({
      where: { id: parseInt(req.params.id) },
    });

    res.json({ message: '已刪除' });
  } catch (err) {
    next(err);
  }
});

// ============================================
// 商品管理
// ============================================

// 商品列表（後台 — 含所有狀態）
router.get('/', async (req, res, next) => {
  try {
    const { category, status, search, page = 1, limit = 10 } = req.query;
    const skip = (page - 1) * limit;

    const where = {};
    if (category) where.categoryId = parseInt(category);
    if (status) where.status = status;
    if (search) where.name = { contains: search };

    const [products, total] = await Promise.all([
      prisma.redeemProduct.findMany({
        where,
        skip: parseInt(skip),
        take: parseInt(limit),
        include: {
          category: { select: { name: true } },
          _count: { select: { redemptions: true } },
        },
        orderBy: { sortOrder: 'asc' },
      }),
      prisma.redeemProduct.count({ where }),
    ]);

    res.json({
      data: products,
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

// 單一商品詳情
router.get('/:id', async (req, res, next) => {
  try {
    const product = await prisma.redeemProduct.findUnique({
      where: { id: parseInt(req.params.id) },
      include: {
        category: true,
        redemptions: {
          include: {
            member: { select: { account: true, name: true } },
          },
          orderBy: { createdAt: 'desc' },
          take: 20,
        },
      },
    });

    if (!product) {
      return res.status(404).json({ error: '找不到此商品' });
    }

    res.json(product);
  } catch (err) {
    next(err);
  }
});

// 新增商品
router.post('/', async (req, res, next) => {
  try {
    const { categoryId, name, description, imageUrl, pointCost, stock, sortOrder } = req.body;

    if (!name || !pointCost) {
      return res.status(400).json({ error: '商品名稱與所需點數為必填' });
    }

    const product = await prisma.redeemProduct.create({
      data: {
        categoryId: categoryId ? parseInt(categoryId) : null,
        name,
        description,
        imageUrl,
        pointCost: parseInt(pointCost),
        stock: stock ? parseInt(stock) : 0,
        sortOrder: sortOrder || 0,
        status: 'ACTIVE',
      },
      include: { category: { select: { name: true } } },
    });

    res.status(201).json(product);
  } catch (err) {
    next(err);
  }
});

// 修改商品
router.put('/:id', async (req, res, next) => {
  try {
    const { categoryId, name, description, imageUrl, pointCost, stock, sortOrder, status } = req.body;

    const product = await prisma.redeemProduct.update({
      where: { id: parseInt(req.params.id) },
      data: {
        categoryId: categoryId !== undefined ? (categoryId ? parseInt(categoryId) : null) : undefined,
        name,
        description,
        imageUrl,
        pointCost: pointCost ? parseInt(pointCost) : undefined,
        stock: stock !== undefined ? parseInt(stock) : undefined,
        sortOrder,
        status,
      },
      include: { category: { select: { name: true } } },
    });

    res.json(product);
  } catch (err) {
    next(err);
  }
});

// 刪除商品
router.delete('/:id', async (req, res, next) => {
  try {
    // 檢查是否有兌換紀錄
    const count = await prisma.pointRedemption.count({
      where: { productId: parseInt(req.params.id) },
    });

    if (count > 0) {
      // 有兌換紀錄改為下架，不刪除
      await prisma.redeemProduct.update({
        where: { id: parseInt(req.params.id) },
        data: { status: 'INACTIVE' },
      });
      return res.json({ message: '商品已有兌換紀錄，已改為下架' });
    }

    await prisma.redeemProduct.delete({
      where: { id: parseInt(req.params.id) },
    });

    res.json({ message: '已刪除' });
  } catch (err) {
    next(err);
  }
});

// 商品圖片上傳
const productStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, '../../uploads/products')),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `product-${req.params.id}-${Date.now()}${ext}`);
  },
});
const uploadProductImage = multer({ storage: productStorage, limits: { fileSize: 2 * 1024 * 1024 } });

router.post('/:id/image', uploadProductImage.single('image'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: '請選擇圖片' });
    }

    const imageUrl = `/uploads/products/${req.file.filename}`;
    const product = await prisma.redeemProduct.update({
      where: { id: parseInt(req.params.id) },
      data: { imageUrl },
    });

    res.json({ imageUrl: product.imageUrl });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

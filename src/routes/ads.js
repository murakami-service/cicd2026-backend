const express = require('express');
const multer = require('multer');
const prisma = require('../config/database');
const { verifyToken, requireRole } = require('../middleware/auth');
const firebaseStorage = require('../services/firebaseStorage');

const router = express.Router();

const uploadAd = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// 取得目前有效廣告（前台/APP 用，不需驗證）
router.get('/active', async (req, res, next) => {
  try {
    const now = new Date();
    const ads = await prisma.ad.findMany({
      where: {
        isActive: true,
        startDate: { lte: now },
        endDate: { gte: now },
      },
      orderBy: { sortOrder: 'asc' },
    });

    res.json(ads);
  } catch (err) {
    next(err);
  }
});

// 以下路由限定總管理者
router.use(verifyToken, requireRole('SUPER'));

// 廣告列表（後台）
router.get('/', async (req, res, next) => {
  try {
    const ads = await prisma.ad.findMany({
      orderBy: { createdAt: 'desc' },
    });

    res.json(ads);
  } catch (err) {
    next(err);
  }
});

// 上傳廣告圖片（Firebase Storage）
router.post('/upload', (req, res, next) => {
  uploadAd.single('image')(req, res, async (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: '圖片大小不可超過 10MB' });
      }
      return res.status(400).json({ error: err.message });
    }
    if (!req.file) {
      return res.status(400).json({ error: '請選擇圖片' });
    }
    try {
      const url = await firebaseStorage.uploadFile(req.file, 'ads', `ad-${Date.now()}`);
      res.json({ url });
    } catch (e) {
      next(e);
    }
  });
});

// 新增廣告
router.post('/', async (req, res, next) => {
  try {
    const { title, imageUrl, linkUrl, startDate, endDate, sortOrder } = req.body;

    if (!title || !imageUrl || !startDate || !endDate) {
      return res.status(400).json({ error: '標題、圖片、上架/下架時間為必填' });
    }

    const ad = await prisma.ad.create({
      data: {
        title,
        imageUrl,
        linkUrl,
        startDate: new Date(startDate),
        endDate: new Date(endDate),
        sortOrder: sortOrder || 0,
      },
    });

    res.status(201).json(ad);
  } catch (err) {
    next(err);
  }
});

// 修改廣告
router.put('/:id', async (req, res, next) => {
  try {
    const { title, imageUrl, linkUrl, startDate, endDate, isActive, sortOrder } = req.body;

    const ad = await prisma.ad.update({
      where: { id: parseInt(req.params.id) },
      data: {
        title, imageUrl, linkUrl,
        startDate: startDate ? new Date(startDate) : undefined,
        endDate: endDate ? new Date(endDate) : undefined,
        isActive, sortOrder,
      },
    });

    res.json(ad);
  } catch (err) {
    next(err);
  }
});

// 刪除廣告
router.delete('/:id', async (req, res, next) => {
  try {
    await prisma.ad.delete({
      where: { id: parseInt(req.params.id) },
    });

    res.json({ message: '已刪除' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

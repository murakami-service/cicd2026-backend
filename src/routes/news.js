const express = require('express');
const prisma = require('../config/database');
const { verifyToken, requireRole } = require('../middleware/auth');

const router = express.Router();

// 新聞列表（公開，APP/前台用）
router.get('/', async (req, res, next) => {
  try {
    const { category, page = 1, limit = 10 } = req.query;
    const skip = (page - 1) * limit;

    const where = { isDeleted: false };
    if (category) where.category = category;

    const [news, total] = await Promise.all([
      prisma.news.findMany({
        where,
        skip: parseInt(skip),
        take: parseInt(limit),
        select: {
          id: true, title: true, category: true, imageUrl: true,
          isDeleted: true, createdAt: true, updatedAt: true,
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.news.count({ where }),
    ]);

    res.json({
      data: news,
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

// 以下路由限定總管理者
router.use(verifyToken, requireRole('SUPER'));

// 新增新聞
router.post('/', async (req, res, next) => {
  try {
    const { title, content, category, imageUrl } = req.body;

    if (!title || !content || !category) {
      return res.status(400).json({ error: '標題、內容與分類為必填' });
    }

    const news = await prisma.news.create({
      data: { title, content, category, imageUrl },
    });

    res.status(201).json(news);
  } catch (err) {
    next(err);
  }
});

// 修改新聞
router.put('/:id', async (req, res, next) => {
  try {
    const { title, content, category, imageUrl } = req.body;

    const news = await prisma.news.update({
      where: { id: parseInt(req.params.id) },
      data: { title, content, category, imageUrl },
    });

    res.json(news);
  } catch (err) {
    next(err);
  }
});

// 刪除新聞
router.delete('/:id', async (req, res, next) => {
  try {
    await prisma.news.update({
      where: { id: parseInt(req.params.id) },
      data: { isDeleted: true },
    });

    res.json({ message: '已刪除' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

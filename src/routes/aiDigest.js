const express = require('express');
const prisma = require('../config/database');
const { verifyToken } = require('../middleware/auth');
const { fetchAllRssSources } = require('../services/rssService');
const { runDailyDigestGeneration, cleanOldDigests } = require('../services/digestGenerator');

const router = express.Router();

// ============================================
// RSS 來源管理（放在 /:id 前面避免路由衝突）
// ============================================

// RSS 來源列表
router.get('/rss-sources', verifyToken, async (req, res, next) => {
  try {
    const { region } = req.query;
    const where = {};
    if (region) where.region = region;

    const sources = await prisma.rssSource.findMany({
      where,
      orderBy: [{ region: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { articles: true } } },
    });

    res.json(sources);
  } catch (err) {
    next(err);
  }
});

// 新增 RSS 來源
router.post('/rss-sources', verifyToken, async (req, res, next) => {
  try {
    const { name, url, region, category } = req.body;
    if (!name || !url || !region) {
      return res.status(400).json({ error: '名稱、URL、區域為必填' });
    }
    if (!['INTERNATIONAL', 'DOMESTIC'].includes(region)) {
      return res.status(400).json({ error: '區域必須是 INTERNATIONAL 或 DOMESTIC' });
    }

    const source = await prisma.rssSource.create({
      data: { name, url, region, category: category || null },
    });
    res.status(201).json(source);
  } catch (err) {
    next(err);
  }
});

// 修改 RSS 來源
router.put('/rss-sources/:id', verifyToken, async (req, res, next) => {
  try {
    const { name, url, region, category, isActive } = req.body;
    const source = await prisma.rssSource.update({
      where: { id: parseInt(req.params.id) },
      data: {
        ...(name !== undefined && { name }),
        ...(url !== undefined && { url }),
        ...(region !== undefined && { region }),
        ...(category !== undefined && { category }),
        ...(isActive !== undefined && { isActive }),
      },
    });
    res.json(source);
  } catch (err) {
    next(err);
  }
});

// 刪除 RSS 來源（含所屬文章）
router.delete('/rss-sources/:id', verifyToken, async (req, res, next) => {
  try {
    await prisma.rssSource.delete({
      where: { id: parseInt(req.params.id) },
    });
    res.json({ message: '已刪除' });
  } catch (err) {
    next(err);
  }
});

// ============================================
// 統計 & 操作（放在 /:id 前面）
// ============================================

// 統計資訊
router.get('/stats/overview', verifyToken, async (req, res, next) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [totalDigests, todayDigests, totalArticles, activeSources, uniqueCombos] = await Promise.all([
      prisma.aiDigest.count(),
      prisma.aiDigest.count({ where: { publishDate: { gte: today } } }),
      prisma.rssArticle.count(),
      prisma.rssSource.count({ where: { isActive: true } }),
      prisma.aiDigest.groupBy({ by: ['comboKey'] }).then(r => r.length),
    ]);

    res.json({ totalDigests, todayDigests, totalArticles, activeSources, uniqueCombos });
  } catch (err) {
    next(err);
  }
});

// 手動觸發 RSS 抓取
router.post('/fetch-rss', verifyToken, async (req, res, next) => {
  try {
    const result = await fetchAllRssSources();
    res.json({ message: 'RSS 抓取完成', ...result });
  } catch (err) {
    next(err);
  }
});

// 手動觸發摘要生成
router.post('/generate', verifyToken, async (req, res, next) => {
  try {
    const results = await runDailyDigestGeneration();
    res.json({ message: '摘要生成完成', results });
  } catch (err) {
    next(err);
  }
});

// 手動清理舊資料
router.post('/cleanup', verifyToken, async (req, res, next) => {
  try {
    const { days = 30 } = req.body;
    const count = await cleanOldDigests(parseInt(days));
    res.json({ message: `已清理 ${count} 篇舊摘要` });
  } catch (err) {
    next(err);
  }
});

// ============================================
// AI 摘要 CRUD
// ============================================

// 摘要列表
router.get('/', verifyToken, async (req, res, next) => {
  try {
    const { region, perspective, page = 1, limit = 10 } = req.query;
    const skip = (page - 1) * limit;

    const where = {};
    if (region) where.region = region;
    if (perspective) where.perspective = perspective;

    const [digests, total] = await Promise.all([
      prisma.aiDigest.findMany({
        where,
        skip: parseInt(skip),
        take: parseInt(limit),
        orderBy: { publishDate: 'desc' },
      }),
      prisma.aiDigest.count({ where }),
    ]);

    const data = digests.map(d => ({
      ...d,
      interests: JSON.parse(d.interests || '[]'),
      industries: JSON.parse(d.industries || '[]'),
      sourceUrls: JSON.parse(d.sourceUrls || '[]'),
    }));

    res.json({
      data,
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

// 單篇摘要詳情
router.get('/:id', verifyToken, async (req, res, next) => {
  try {
    const digest = await prisma.aiDigest.findUnique({
      where: { id: parseInt(req.params.id) },
    });
    if (!digest) return res.status(404).json({ error: '找不到此摘要' });

    res.json({
      ...digest,
      interests: JSON.parse(digest.interests || '[]'),
      industries: JSON.parse(digest.industries || '[]'),
      sourceUrls: JSON.parse(digest.sourceUrls || '[]'),
    });
  } catch (err) {
    next(err);
  }
});

// 刪除摘要
router.delete('/:id', verifyToken, async (req, res, next) => {
  try {
    await prisma.aiDigest.delete({
      where: { id: parseInt(req.params.id) },
    });
    res.json({ message: '已刪除' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

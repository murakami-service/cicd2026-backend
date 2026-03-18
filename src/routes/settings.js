const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { verifyToken, requireRole } = require('../middleware/auth');

// GET /api/settings/:key — 取得單一設定（公開，APP 也能用）
router.get('/:key', async (req, res, next) => {
  try {
    const setting = await prisma.systemSetting.findUnique({
      where: { key: req.params.key },
    });
    if (!setting) {
      return res.json({ key: req.params.key, value: null });
    }
    res.json({ key: setting.key, value: JSON.parse(setting.value) });
  } catch (err) {
    next(err);
  }
});

// PUT /api/settings/:key — 更新設定（僅 SUPER/ADMIN）
router.put('/:key', verifyToken, requireRole('SUPER', 'ADMIN'), async (req, res, next) => {
  try {
    const { value } = req.body;
    const setting = await prisma.systemSetting.upsert({
      where: { key: req.params.key },
      create: { key: req.params.key, value: JSON.stringify(value) },
      update: { value: JSON.stringify(value) },
    });
    res.json({ key: setting.key, value: JSON.parse(setting.value) });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

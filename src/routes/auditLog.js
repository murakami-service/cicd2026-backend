const express = require('express');
const prisma = require('../config/database');
const { verifyToken, scopeByAdmin } = require('../middleware/auth');

const router = express.Router();

// 審計日誌列表（分頁+篩選）
router.get('/', verifyToken, scopeByAdmin, async (req, res, next) => {
  try {
    const { page = 1, limit = 10, module, action, adminId, search, startDate, endDate } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where = {};
    if (module) where.module = module;
    if (action) where.action = action;
    if (adminId) where.adminId = parseInt(adminId);
    if (search) {
      where.OR = [
        { targetName: { contains: search, mode: 'insensitive' } },
        { adminName: { contains: search, mode: 'insensitive' } },
        { detail: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate);
      if (endDate) where.createdAt.lte = new Date(`${endDate}T23:59:59`);
    }

    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: parseInt(limit),
      }),
      prisma.auditLog.count({ where }),
    ]);

    res.json({
      data: logs,
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

// 取得可用的 module / action 選項（供前端篩選下拉）
router.get('/options', verifyToken, scopeByAdmin, async (req, res, next) => {
  try {
    const [modules, actions] = await Promise.all([
      prisma.auditLog.findMany({ select: { module: true }, distinct: ['module'], orderBy: { module: 'asc' } }),
      prisma.auditLog.findMany({ select: { action: true }, distinct: ['action'], orderBy: { action: 'asc' } }),
    ]);
    res.json({
      modules: modules.map((m) => m.module),
      actions: actions.map((a) => a.action),
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

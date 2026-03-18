const express = require('express');
const bcrypt = require('bcryptjs');
const prisma = require('../config/database');
const { verifyToken, requireRole } = require('../middleware/auth');

const router = express.Router();

// 所有路由需要登入 + 總管理者權限
router.use(verifyToken);
router.use(requireRole('SUPER'));

// ============================================
// 1. GET / - 管理者列表
// ============================================

router.get('/', async (req, res, next) => {
  try {
    const { role, search, page = 1, limit = 10 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where = {};
    if (role) where.role = role;
    if (search) {
      where.OR = [
        { username: { contains: search, mode: 'insensitive' } },
        { name: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [admins, total] = await Promise.all([
      prisma.admin.findMany({
        where,
        skip,
        take: parseInt(limit),
        select: {
          id: true,
          username: true,
          name: true,
          role: true,
          districtId: true,
          termNumber: true,
          memberType: true,
          isActive: true,
          createdAt: true,
          district: { select: { name: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.admin.count({ where }),
    ]);

    res.json({
      data: admins,
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

// ============================================
// 2. GET /:id - 管理者詳情
// ============================================

router.get('/:id', async (req, res, next) => {
  try {
    const admin = await prisma.admin.findUnique({
      where: { id: parseInt(req.params.id) },
      select: {
        id: true,
        username: true,
        name: true,
        role: true,
        districtId: true,
        termNumber: true,
        memberType: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
        district: { select: { id: true, name: true } },
      },
    });

    if (!admin) {
      return res.status(404).json({ error: '找不到此管理者' });
    }

    res.json(admin);
  } catch (err) {
    next(err);
  }
});

// ============================================
// 3. POST / - 新增管理者
// ============================================

router.post('/', async (req, res, next) => {
  try {
    const { username, password, name, role, districtId, termNumber, memberType } = req.body;

    if (!username || !password || !name || !role) {
      return res.status(400).json({ error: '帳號、密碼、姓名、角色為必填' });
    }

    const validRoles = ['SUPER', 'DISTRICT', 'TERM', 'SPECIAL', 'CY_TERM'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({ error: '無效的角色' });
    }

    // 檢查帳號重複
    const existing = await prisma.admin.findUnique({ where: { username } });
    if (existing) {
      return res.status(409).json({ error: '帳號已存在' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const data = {
      username,
      password: hashedPassword,
      name,
      role,
    };

    // 依角色設定關聯欄位
    if (role === 'DISTRICT' || role === 'SPECIAL') {
      data.districtId = districtId ? parseInt(districtId) : null;
    }
    if (role === 'TERM') {
      data.termNumber = termNumber ? parseInt(termNumber) : null;
    }
    if (role === 'CY_TERM') {
      data.termNumber = termNumber ? parseInt(termNumber) : null;
      data.memberType = 'CY';
    }

    const admin = await prisma.admin.create({ data });

    const { password: _, ...result } = admin;
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

// ============================================
// 4. PUT /:id - 更新管理者
// ============================================

router.put('/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    const { name, role, districtId, termNumber, memberType, isActive } = req.body;

    const data = {};
    if (name !== undefined) data.name = name;
    if (role !== undefined) data.role = role;
    if (isActive !== undefined) data.isActive = isActive;

    // 依角色更新關聯欄位
    if (role === 'DISTRICT' || role === 'SPECIAL') {
      data.districtId = districtId ? parseInt(districtId) : null;
      data.termNumber = null;
      data.memberType = null;
    } else if (role === 'TERM') {
      data.termNumber = termNumber ? parseInt(termNumber) : null;
      data.districtId = null;
      data.memberType = null;
    } else if (role === 'CY_TERM') {
      data.termNumber = termNumber ? parseInt(termNumber) : null;
      data.memberType = 'CY';
      data.districtId = null;
    } else if (role === 'SUPER') {
      data.districtId = null;
      data.termNumber = null;
      data.memberType = null;
    }

    const admin = await prisma.admin.update({
      where: { id },
      data,
    });

    const { password: _, ...result } = admin;
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// ============================================
// 5. POST /:id/reset-password - 重設密碼
// ============================================

router.post('/:id/reset-password', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    const { password } = req.body;

    if (!password || password.length < 4) {
      return res.status(400).json({ error: '密碼至少 4 碼' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    await prisma.admin.update({
      where: { id },
      data: { password: hashedPassword },
    });

    res.json({ message: '密碼已重設' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

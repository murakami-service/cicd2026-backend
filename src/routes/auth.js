const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const prisma = require('../config/database');
const { generateToken, generateMemberToken, verifyToken } = require('../middleware/auth');
const { writeAuditLog } = require('../services/auditLog');

const JWT_SECRET = process.env.JWT_SECRET || 'change-this-secret';

const router = express.Router();

// 管理者登入
router.post('/login', async (req, res, next) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: '請填入帳號與密碼' });
    }

    const admin = await prisma.admin.findUnique({
      where: { username },
    });

    if (!admin || !admin.isActive) {
      return res.status(401).json({ error: '帳號或密碼錯誤' });
    }

    const valid = await bcrypt.compare(password, admin.password);
    if (!valid) {
      return res.status(401).json({ error: '帳號或密碼錯誤' });
    }

    const token = generateToken(admin);

    const ip = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '';
    await writeAuditLog({
      action: 'LOGIN', module: 'AUTH',
      adminId: admin.id, adminName: admin.username, ip,
    });

    res.json({
      token,
      admin: {
        id: admin.id,
        username: admin.username,
        name: admin.name,
        role: admin.role,
        districtId: admin.districtId,
        termNumber: admin.termNumber,
      },
    });
  } catch (err) {
    next(err);
  }
});

// 取得當前管理者資訊
router.get('/me', verifyToken, async (req, res, next) => {
  try {
    const admin = await prisma.admin.findUnique({
      where: { id: req.admin.id },
      select: {
        id: true,
        username: true,
        name: true,
        role: true,
        districtId: true,
        termNumber: true,
        district: { select: { name: true } },
      },
    });

    if (!admin) {
      return res.status(404).json({ error: '找不到管理者' });
    }

    res.json(admin);
  } catch (err) {
    next(err);
  }
});

// 會員登入（APP 端）
router.post('/member-login', async (req, res, next) => {
  try {
    const { account, password } = req.body;

    if (!account || !password) {
      return res.status(400).json({ error: '請填入帳號與密碼' });
    }

    const member = await prisma.member.findUnique({
      where: { account },
    });

    if (!member || !member.isActive) {
      return res.status(401).json({ error: '帳號或密碼錯誤' });
    }

    const valid = await bcrypt.compare(password, member.password);
    if (!valid) {
      return res.status(401).json({ error: '帳號或密碼錯誤' });
    }

    const token = generateMemberToken(member);

    res.json({
      token,
      member: {
        id: member.id,
        account: member.account,
        name: member.name,
        memberType: member.memberType,
        districtId: member.districtId,
        termNumber: member.termNumber,
      },
    });
  } catch (err) {
    next(err);
  }
});

// 忘記密碼 — 發送驗證碼
router.post('/forgot-password', async (req, res, next) => {
  try {
    const { account, email } = req.body;

    if (!account || !email) {
      return res.status(400).json({ error: '請填入帳號與 Email' });
    }

    const member = await prisma.member.findUnique({
      where: { account },
    });

    if (!member || !member.isActive) {
      return res.status(404).json({ error: '查無此帳號' });
    }

    if (!member.email || member.email.toLowerCase() !== email.toLowerCase()) {
      return res.status(400).json({ error: '帳號與 Email 不符' });
    }

    // 產生 6 位數驗證碼
    const resetCode = String(Math.floor(100000 + Math.random() * 900000));
    const resetCodeExpiry = new Date(Date.now() + 10 * 60 * 1000); // 10 分鐘後到期

    await prisma.member.update({
      where: { id: member.id },
      data: { resetCode, resetCodeExpiry },
    });

    // TODO: 正式環境改為寄送 Email，目前先回傳驗證碼供測試
    res.json({
      message: '驗證碼已發送',
      // DEV ONLY — 正式環境移除此欄位
      ...(process.env.NODE_ENV !== 'production' && { code: resetCode }),
    });
  } catch (err) {
    next(err);
  }
});

// 驗證重設密碼驗證碼
router.post('/verify-reset-code', async (req, res, next) => {
  try {
    const { account, code } = req.body;

    if (!account || !code) {
      return res.status(400).json({ error: '請填入帳號與驗證碼' });
    }

    const member = await prisma.member.findUnique({
      where: { account },
    });

    if (!member) {
      return res.status(404).json({ error: '查無此帳號' });
    }

    if (!member.resetCode || member.resetCode !== code) {
      return res.status(400).json({ error: '驗證碼錯誤' });
    }

    if (!member.resetCodeExpiry || new Date() > member.resetCodeExpiry) {
      return res.status(400).json({ error: '驗證碼已過期，請重新取得' });
    }

    // 產生一次性 resetToken (10 分鐘有效)
    const resetToken = jwt.sign(
      { memberId: member.id, purpose: 'reset-password' },
      JWT_SECRET,
      { expiresIn: '10m' }
    );

    res.json({ valid: true, resetToken });
  } catch (err) {
    next(err);
  }
});

// 重設密碼
router.post('/reset-password', async (req, res, next) => {
  try {
    const { resetToken, newPassword } = req.body;

    if (!resetToken || !newPassword) {
      return res.status(400).json({ error: '缺少必要欄位' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ error: '密碼至少需 6 個字元' });
    }

    // 驗證 resetToken
    let decoded;
    try {
      decoded = jwt.verify(resetToken, JWT_SECRET);
    } catch (err) {
      return res.status(400).json({ error: '重設令牌無效或已過期' });
    }

    if (decoded.purpose !== 'reset-password') {
      return res.status(400).json({ error: '無效的重設令牌' });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await prisma.member.update({
      where: { id: decoded.memberId },
      data: {
        password: hashedPassword,
        resetCode: null,
        resetCodeExpiry: null,
      },
    });

    res.json({ message: '密碼已重設' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

const jwt = require('jsonwebtoken');
const prisma = require('../config/database');

const JWT_SECRET = process.env.JWT_SECRET || 'change-this-secret';

// 驗證 JWT Token（支援管理者 + 會員雙身分）
function verifyToken(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: '未提供認證令牌' });
  }

  try {
    const token = header.split('Bearer ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role) {
      req.admin = decoded; // 管理者
    }
    if (decoded.memberType !== undefined && decoded.account) {
      req.member = decoded; // 會員
    }
    next();
  } catch (err) {
    return res.status(401).json({ error: '認證令牌無效或已過期' });
  }
}

// 驗證管理者角色 + 資料隔離
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.admin) {
      return res.status(401).json({ error: '未登入' });
    }
    if (!roles.includes(req.admin.role)) {
      return res.status(403).json({ error: '權限不足' });
    }
    next();
  };
}

// 資料隔離 middleware — 非總管理者只能存取自己管轄的資料
function scopeByAdmin(req, res, next) {
  if (!req.admin) {
    return res.status(401).json({ error: '未登入' });
  }

  // 總管理者不受限制
  if (req.admin.role === 'SUPER') {
    req.scope = {};
    return next();
  }

  const scope = {};

  switch (req.admin.role) {
    case 'DISTRICT':
    case 'SPECIAL':
      scope.districtId = req.admin.districtId;
      break;
    case 'TERM':
      scope.termNumber = req.admin.termNumber;
      break;
    case 'CY_TERM':
      scope.memberType = 'CY';
      scope.termNumber = req.admin.termNumber;
      break;
  }

  req.scope = scope;
  next();
}

// 產生管理者 JWT Token
function generateToken(admin) {
  return jwt.sign(
    {
      id: admin.id,
      username: admin.username,
      role: admin.role,
      districtId: admin.districtId,
      termNumber: admin.termNumber,
      memberType: admin.memberType,
    },
    JWT_SECRET,
    { expiresIn: '12h' }
  );
}

// 產生會員 JWT Token
function generateMemberToken(member) {
  return jwt.sign(
    {
      id: member.id,
      account: member.account,
      name: member.name,
      memberType: member.memberType,
      districtId: member.districtId,
      termNumber: member.termNumber,
    },
    JWT_SECRET,
    { expiresIn: '30d' }
  );
}

module.exports = { verifyToken, requireRole, scopeByAdmin, generateToken, generateMemberToken };

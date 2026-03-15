const express = require('express');
const bcrypt = require('bcrypt');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const prisma = require('../config/database');
const { verifyToken, scopeByAdmin } = require('../middleware/auth');

const router = express.Router();

// 大頭照上傳設定
const avatarStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '../../uploads/avatars');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, `member-${req.params.id}-${Date.now()}${ext}`);
  },
});
const avatarUpload = multer({
  storage: avatarStorage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.webp'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error('僅支援 JPG、PNG、WebP 格式'));
  },
});

// ============================================
// 工具函式
// ============================================

// 西元 Date 轉民國格式字串（1949-11-24 → 038/11/24）
function dateToRoc(date) {
  if (!date) return null;
  const d = new Date(date);
  const rocYear = String(d.getFullYear() - 1911).padStart(3, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${rocYear}/${month}/${day}`;
}

// 民國生日轉西元 Date（038/11/24 → 1949-11-24）
function rocBirthdayToDate(rocStr) {
  if (!rocStr) return null;
  const parts = rocStr.replace(/\s/g, '').split('/');
  if (parts.length !== 3) return null;
  const year = parseInt(parts[0]) + 1911;
  const month = parseInt(parts[1]);
  const day = parseInt(parts[2]);
  if (isNaN(year) || isNaN(month) || isNaN(day)) return null;
  return new Date(year, month - 1, day);
}

// 民國生日產生預設密碼 7碼
function rocBirthdayToPassword(rocStr) {
  if (!rocStr) return '0000000';
  const parts = rocStr.replace(/\s/g, '').split('/');
  if (parts.length !== 3) return '0000000';
  const rocYear = String(parseInt(parts[0])).padStart(2, '0');
  const month = String(parseInt(parts[1])).padStart(2, '0');
  const day = String(parseInt(parts[2])).padStart(2, '0');
  let pw = rocYear + month + day;
  if (pw.length === 6) pw = '0' + pw;
  return pw;
}

// 區別文字轉 districtId
async function resolveDistrictId(districtName) {
  if (!districtName) return null;
  const map = { '北': '北區', '中': '中區', '南': '南區', '東': '東區' };
  const name = map[districtName] || districtName;
  if (name === '建青團') return null;
  const district = await prisma.district.findUnique({ where: { name } });
  return district ? district.id : null;
}

// 解析帳號取得期別和學號
function parseAccount(account) {
  if (!account) return { termNumber: 0, studentNumber: 0, memberType: 'GENERAL' };
  const str = String(account).trim();
  if (str.toUpperCase().startsWith('CY')) {
    const num = str.substring(2);
    const term = parseInt(num.substring(0, 2)) || 0;
    const student = parseInt(num.substring(2)) || 0;
    return { termNumber: term, studentNumber: student, memberType: 'CY' };
  }
  const term = parseInt(str.substring(0, 2)) || 0;
  const student = parseInt(str.substring(2)) || 0;
  return { termNumber: term, studentNumber: student, memberType: 'GENERAL' };
}

// ============================================
// APP 端會員 API（固定路徑，必須放在 /:id 之前）
// ============================================

// APP — 取得個人資料（含繳費狀態）
router.get('/app/profile', verifyToken, async (req, res, next) => {
  try {
    if (!req.member) {
      return res.status(401).json({ error: '請使用會員身分登入' });
    }

    const member = await prisma.member.findUnique({
      where: { id: req.member.id },
      include: {
        district: { select: { name: true } },
        specialDistricts: { include: { district: { select: { name: true } } } },
      },
    });

    if (!member) {
      return res.status(404).json({ error: '會員不存在' });
    }

    const { checkPaymentStatus } = require('../services/paymentVerification');
    const [generalPayment, districtPayment, termPayment] = await Promise.all([
      checkPaymentStatus(member.id, 'GENERAL'),
      member.districtId ? checkPaymentStatus(member.id, 'DISTRICT', { districtId: member.districtId }) : { hasPaid: false, noBatch: true },
      checkPaymentStatus(member.id, 'TERM', { termNumber: member.termNumber }),
    ]);

    const { password, ...memberData } = member;

    res.json({
      ...memberData,
      birthdayRoc: dateToRoc(member.birthday),
      paymentStatus: {
        general: { paid: generalPayment.hasPaid, noBatch: generalPayment.noBatch },
        district: { paid: districtPayment.hasPaid, noBatch: districtPayment.noBatch },
        term: { paid: termPayment.hasPaid, noBatch: termPayment.noBatch },
      },
    });
  } catch (err) {
    next(err);
  }
});

// APP — 編輯個人資料
router.put('/app/profile', verifyToken, async (req, res, next) => {
  try {
    if (!req.member) {
      return res.status(401).json({ error: '請使用會員身分登入' });
    }

    const {
      phone, email, gender, avatar,
      company, jobTitle, industry, businessItems, brand, website, companyPhone, fax,
      address, city, area, contactPerson, contactPhone,
      introduction, education, experience, currentPosition
    } = req.body;

    const member = await prisma.member.update({
      where: { id: req.member.id },
      data: {
        phone, email, gender, avatar,
        company, jobTitle, industry, businessItems, brand, website, companyPhone, fax,
        address, city, area, contactPerson, contactPhone,
        introduction, education, experience, currentPosition,
      },
    });

    const { password, ...memberData } = member;
    res.json(memberData);
  } catch (err) {
    next(err);
  }
});

// APP — 上傳大頭照
router.post('/app/avatar', verifyToken, (req, res, next) => {
  if (!req.member) {
    return res.status(401).json({ error: '請使用會員身分登入' });
  }
  req.params.id = String(req.member.id);
  avatarUpload.single('avatar')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message || '上傳失敗' });
    if (!req.file) return res.status(400).json({ error: '請選擇圖片' });
    try {
      const old = await prisma.member.findUnique({ where: { id: req.member.id }, select: { avatar: true } });
      if (old?.avatar) {
        const oldPath = path.join(__dirname, '../../', old.avatar);
        if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
      }
      const avatarUrl = `/uploads/avatars/${req.file.filename}`;
      await prisma.member.update({ where: { id: req.member.id }, data: { avatar: avatarUrl } });
      res.json({ avatar: avatarUrl });
    } catch (e) { next(e); }
  });
});

// APP — 繳費紀錄列表
router.get('/app/bills', verifyToken, async (req, res, next) => {
  try {
    if (!req.member) {
      return res.status(401).json({ error: '請使用會員身分登入' });
    }

    const { status, page = 1, limit = 25 } = req.query;
    const skip = (page - 1) * limit;

    const where = { memberId: req.member.id };
    if (status) where.status = status;

    const [bills, total] = await Promise.all([
      prisma.bill.findMany({
        where,
        skip: parseInt(skip),
        take: parseInt(limit),
        include: {
          batch: {
            select: {
              title: true, billingType: true, targetType: true,
              startDate: true, endDate: true,
              district: { select: { name: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.bill.count({ where }),
    ]);

    res.json({
      data: bills,
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

// APP — 活動參加紀錄
router.get('/app/events', verifyToken, async (req, res, next) => {
  try {
    if (!req.member) {
      return res.status(401).json({ error: '請使用會員身分登入' });
    }

    const { page = 1, limit = 25 } = req.query;
    const skip = (page - 1) * limit;

    const [registrations, total] = await Promise.all([
      prisma.eventRegistration.findMany({
        where: { memberId: req.member.id },
        skip: parseInt(skip),
        take: parseInt(limit),
        include: {
          event: {
            select: {
              id: true, title: true, status: true,
              startTime: true, endTime: true, location: true, points: true,
              coverImage: true,
              district: { select: { name: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.eventRegistration.count({ where: { memberId: req.member.id } }),
    ]);

    // 批次查詢簽到狀態（避免 N+1）
    const eventIds = registrations.map(r => r.eventId);
    const checkins = eventIds.length > 0
      ? await prisma.checkin.findMany({
          where: { memberId: req.member.id, eventId: { in: eventIds } },
          select: { eventId: true, checkinAt: true },
        })
      : [];
    const checkinMap = new Map(checkins.map(c => [c.eventId, c.checkinAt]));

    const regWithCheckin = registrations.map(reg => ({
      ...reg,
      checkedIn: checkinMap.has(reg.eventId),
      checkinAt: checkinMap.get(reg.eventId) || null,
    }));

    res.json({
      data: regWithCheckin,
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

// ============================================
// CSV 匯入（固定路徑，必須放在 /:id 之前）
// ============================================

router.post('/import', verifyToken, scopeByAdmin, async (req, res, next) => {
  try {
    const { members } = req.body;

    if (!Array.isArray(members) || members.length === 0) {
      return res.status(400).json({ error: '請提供會員資料陣列' });
    }

    const fieldMap = {
      '學號': 'account', '會員編號': 'account',
      '會員姓名': 'name',
      '區別': 'district',
      '性別': 'gender',
      '手機': 'phone', '行動電話': 'phone',
      '生日': 'birthday',
      '公司名稱': 'company',
      '公司職稱': 'jobTitle',
      '聯絡地址': 'address',
      '電話號碼': 'companyPhone', '電話號碼一': 'companyPhone',
      '傳真': 'fax',
      '電子信箱': 'email', 'email_主': 'email',
      '公司網址': 'website',
      '產業別': 'industry',
      '營業項目': 'businessItems',
      '經營品牌': 'brand',
    };

    let created = 0;
    let skipped = 0;
    const errors = [];

    for (const raw of members) {
      const row = {};
      for (const [key, value] of Object.entries(raw)) {
        const mappedKey = fieldMap[key.trim()] || key.trim();
        row[mappedKey] = typeof value === 'string' ? value.trim() : value;
      }

      if (!row.account || !row.name) {
        skipped++;
        errors.push({ account: row.account, reason: '缺少帳號或姓名' });
        continue;
      }

      const existing = await prisma.member.findUnique({ where: { account: row.account } });
      if (existing) {
        skipped++;
        errors.push({ account: row.account, reason: '帳號已存在' });
        continue;
      }

      const { termNumber, studentNumber, memberType } = parseAccount(row.account);
      const birthdayDate = rocBirthdayToDate(row.birthday);
      const defaultPassword = rocBirthdayToPassword(row.birthday);
      const hashedPassword = await bcrypt.hash(defaultPassword, 10);
      const districtId = await resolveDistrictId(row.district);

      await prisma.member.create({
        data: {
          account: row.account,
          password: hashedPassword,
          name: row.name,
          gender: row.gender || null,
          email: row.email || null,
          phone: row.phone || null,
          birthday: birthdayDate,
          company: row.company || null,
          jobTitle: row.jobTitle || null,
          industry: row.industry || null,
          businessItems: row.businessItems || null,
          brand: row.brand || null,
          website: row.website || null,
          companyPhone: row.companyPhone || null,
          fax: row.fax || null,
          address: row.address || null,
          memberType,
          termNumber,
          studentNumber,
          districtId,
        },
      });
      created++;
    }

    res.status(201).json({
      message: `匯入完成：成功 ${created} 筆，略過 ${skipped} 筆`,
      created,
      skipped,
      errors: errors.slice(0, 50),
    });
  } catch (err) {
    next(err);
  }
});

// ============================================
// 繳費年資匯入（CSV: account, name, paymentYears）
// ============================================

router.post('/import-payment-years', verifyToken, scopeByAdmin, async (req, res, next) => {
  try {
    const { members } = req.body;

    if (!Array.isArray(members) || members.length === 0) {
      return res.status(400).json({ error: '請提供資料陣列' });
    }

    let updated = 0;
    let skipped = 0;
    const errors = [];

    for (const raw of members) {
      const account = (raw.account || raw['帳號'] || '').trim();
      const name = (raw.name || raw['姓名'] || '').trim();
      const years = parseInt(raw.paymentYears || raw['繳費年資'] || '0');

      if (!account) {
        skipped++;
        errors.push({ account: account || '(空)', reason: '缺少帳號' });
        continue;
      }

      if (isNaN(years) || years < 0) {
        skipped++;
        errors.push({ account, reason: '繳費年資須為正整數' });
        continue;
      }

      const member = await prisma.member.findUnique({ where: { account } });
      if (!member) {
        skipped++;
        errors.push({ account, reason: '找不到此會員' });
        continue;
      }

      // 有帶姓名時做交叉驗證
      if (name && member.name !== name) {
        skipped++;
        errors.push({ account, reason: `姓名不符（系統:${member.name}，匯入:${name}）` });
        continue;
      }

      await prisma.member.update({
        where: { account },
        data: { paymentYears: years },
      });
      updated++;
    }

    res.json({
      message: `匯入完成：更新 ${updated} 筆，略過 ${skipped} 筆`,
      updated,
      skipped,
      errors: errors.slice(0, 50),
    });
  } catch (err) {
    next(err);
  }
});

// ============================================
// 後台管理 API
// ============================================

// 區域列表（供前端下拉選單）
router.get('/districts', verifyToken, async (req, res, next) => {
  try {
    const districts = await prisma.district.findMany({
      select: { id: true, name: true, type: true },
      orderBy: { id: 'asc' },
    });
    res.json(districts);
  } catch (err) {
    next(err);
  }
});

// 新增特別區
router.post('/districts', verifyToken, scopeByAdmin, async (req, res, next) => {
  try {
    const { name } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: '名稱為必填' });
    }
    const district = await prisma.district.create({
      data: { name: name.trim(), type: 'SPECIAL' },
    });
    res.status(201).json(district);
  } catch (err) {
    if (err.code === 'P2002') {
      return res.status(400).json({ error: '此名稱已存在' });
    }
    next(err);
  }
});

// 修改特別區名稱
router.put('/districts/:districtId', verifyToken, scopeByAdmin, async (req, res, next) => {
  try {
    const { name } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: '名稱為必填' });
    }
    const district = await prisma.district.update({
      where: { id: parseInt(req.params.districtId) },
      data: { name: name.trim() },
    });
    res.json(district);
  } catch (err) {
    if (err.code === 'P2002') {
      return res.status(400).json({ error: '此名稱已存在' });
    }
    next(err);
  }
});

// 刪除特別區
router.delete('/districts/:districtId', verifyToken, scopeByAdmin, async (req, res, next) => {
  try {
    const districtId = parseInt(req.params.districtId);
    const district = await prisma.district.findUnique({ where: { id: districtId } });
    if (!district || district.type !== 'SPECIAL') {
      return res.status(400).json({ error: '只能刪除特別區' });
    }
    // 先刪除關聯
    await prisma.memberSpecialDistrict.deleteMany({ where: { districtId } });
    await prisma.district.delete({ where: { id: districtId } });
    res.json({ message: '已刪除' });
  } catch (err) {
    next(err);
  }
});

// 更新單一會員的特別區
router.put('/:id/special-districts', verifyToken, scopeByAdmin, async (req, res, next) => {
  try {
    const memberId = parseInt(req.params.id);
    const { specialDistrictIds } = req.body;
    if (!Array.isArray(specialDistrictIds)) {
      return res.status(400).json({ error: 'specialDistrictIds 必須為陣列' });
    }
    // 刪除舊的，新增新的
    await prisma.memberSpecialDistrict.deleteMany({ where: { memberId } });
    if (specialDistrictIds.length > 0) {
      await prisma.memberSpecialDistrict.createMany({
        data: specialDistrictIds.map((districtId) => ({ memberId, districtId: parseInt(districtId) })),
      });
    }
    const member = await prisma.member.findUnique({
      where: { id: memberId },
      include: { specialDistricts: { include: { district: true } } },
    });
    res.json(member.specialDistricts);
  } catch (err) {
    next(err);
  }
});

// 會員列表（依管理者權限過濾）
router.get('/', verifyToken, scopeByAdmin, async (req, res, next) => {
  try {
    const { search, district, term, industry, memberType, page = 1, limit = 10 } = req.query;
    const skip = (page - 1) * limit;

    const where = {};

    if (req.scope.districtId) where.districtId = req.scope.districtId;
    if (req.scope.termNumber) where.termNumber = req.scope.termNumber;
    if (req.scope.memberType) where.memberType = req.scope.memberType;

    if (search) {
      where.OR = [
        { account: { contains: search } },
        { name: { contains: search } },
        { company: { contains: search } },
      ];
    }
    if (district === 'unassigned') {
      where.districtId = null;
    } else if (district) {
      where.districtId = parseInt(district);
    }
    if (term === 'unassigned') {
      where.termNumber = null;
    } else if (term) {
      where.termNumber = parseInt(term);
    }
    if (industry) where.industry = { contains: industry };
    if (memberType) where.memberType = memberType;

    const [members, total] = await Promise.all([
      prisma.member.findMany({
        where,
        skip: parseInt(skip),
        take: parseInt(limit),
        include: {
          district: { select: { name: true } },
          points: {
            where: { expiresAt: { gt: new Date() } },
            select: { points: true },
          },
        },
        orderBy: { account: 'asc' },
      }),
      prisma.member.count({ where }),
    ]);

    // 計算每位會員的點數餘額（只算未過期，REDEEM 已存負值）
    const data = members.map((m) => {
      const balance = (m.points || []).reduce((sum, r) => sum + r.points, 0);
      const { points: _pts, ...rest } = m;
      return { ...rest, pointBalance: balance };
    });

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

// 單一會員詳情（放在固定路徑之後）
router.get('/:id', verifyToken, scopeByAdmin, async (req, res, next) => {
  try {
    const member = await prisma.member.findUnique({
      where: { id: parseInt(req.params.id) },
      include: {
        district: true,
        specialDistricts: { include: { district: true } },
        organizationRoles: {
          include: { group: true, position: true },
        },
      },
    });

    if (!member) {
      return res.status(404).json({ error: '找不到此會員' });
    }

    res.json(member);
  } catch (err) {
    next(err);
  }
});

// 批次設定會籍（期別/地區/特別區）
router.patch('/batch-assign', verifyToken, scopeByAdmin, async (req, res, next) => {
  try {
    const { memberIds, termNumber, districtId, memberType, specialDistrictIds } = req.body;

    if (!Array.isArray(memberIds) || memberIds.length === 0) {
      return res.status(400).json({ error: '請選擇至少一位會員' });
    }

    const data = {};
    if (termNumber !== undefined) data.termNumber = termNumber ? parseInt(termNumber) : null;
    if (districtId !== undefined) data.districtId = districtId ? parseInt(districtId) : null;
    if (memberType !== undefined) data.memberType = memberType;

    // 批次更新會員基本會籍欄位
    if (Object.keys(data).length > 0) {
      await prisma.member.updateMany({
        where: { id: { in: memberIds.map(Number) } },
        data,
      });
    }

    // 批次設定特別區（多對多）
    if (Array.isArray(specialDistrictIds)) {
      for (const memberId of memberIds) {
        const mid = Number(memberId);
        // 先清除該會員現有特別區
        await prisma.memberSpecialDistrict.deleteMany({ where: { memberId: mid } });
        // 再寫入新的
        if (specialDistrictIds.length > 0) {
          await prisma.memberSpecialDistrict.createMany({
            data: specialDistrictIds.map((did) => ({
              memberId: mid,
              districtId: Number(did),
            })),
          });
        }
      }
    }

    res.json({ message: `已更新 ${memberIds.length} 位會員`, count: memberIds.length });
  } catch (err) {
    next(err);
  }
});

// 新增會員（後台開立）
router.post('/', verifyToken, scopeByAdmin, async (req, res, next) => {
  try {
    const {
      account, name, password, email, phone, birthday, birthdayRoc, gender,
      company, jobTitle, industry, businessItems, brand, website, companyPhone, fax,
      address, memberType, termNumber, studentNumber, districtId
    } = req.body;

    if (!account || !name) {
      return res.status(400).json({ error: '會員帳號與姓名為必填' });
    }

    // 解析生日：優先使用民國格式，其次西元格式
    let birthdayDate = null;
    if (birthdayRoc) {
      birthdayDate = rocBirthdayToDate(birthdayRoc);
      if (!birthdayDate) {
        return res.status(400).json({ error: '生日格式錯誤，請使用民國格式如 078/05/12' });
      }
    } else if (birthday) {
      birthdayDate = new Date(birthday);
    }

    if (!birthdayDate) {
      return res.status(400).json({ error: '生日為必填' });
    }

    // 密碼：前端指定 > 民國生日自動產生
    let finalPassword = password;
    if (!finalPassword) {
      finalPassword = birthdayRoc ? rocBirthdayToPassword(birthdayRoc) : '0000000';
    }

    const hashedPassword = await bcrypt.hash(finalPassword, 10);

    const member = await prisma.member.create({
      data: {
        account,
        password: hashedPassword,
        name,
        email, phone, gender,
        birthday: birthdayDate,
        company, jobTitle, industry, businessItems, brand, website, companyPhone, fax,
        address,
        memberType: memberType || 'GENERAL',
        termNumber: termNumber ? parseInt(termNumber) : null,
        studentNumber: studentNumber ? parseInt(studentNumber) : null,
        districtId: districtId ? parseInt(districtId) : null,
      },
    });

    res.status(201).json(member);
  } catch (err) {
    if (err.code === 'P2002') {
      return res.status(409).json({ error: '此帳號已存在' });
    }
    next(err);
  }
});

// 重設會員密碼（後台管理者操作）
router.post('/:id/reset-password', verifyToken, scopeByAdmin, async (req, res, next) => {
  try {
    const { password } = req.body;
    if (!password || password.trim().length < 4) {
      return res.status(400).json({ error: '密碼至少需 4 個字元' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    await prisma.member.update({
      where: { id: parseInt(req.params.id) },
      data: { password: hashedPassword },
    });

    res.json({ message: '密碼已重設' });
  } catch (err) {
    next(err);
  }
});

// 修改會員（後台）
// 上傳大頭照
router.post('/:id/avatar', verifyToken, scopeByAdmin, (req, res, next) => {
  avatarUpload.single('avatar')(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ error: err.message || '上傳失敗' });
    }
    if (!req.file) {
      return res.status(400).json({ error: '請選擇圖片' });
    }
    try {
      const memberId = parseInt(req.params.id);
      // 刪除舊大頭照
      const old = await prisma.member.findUnique({ where: { id: memberId }, select: { avatar: true } });
      if (old?.avatar) {
        const oldPath = path.join(__dirname, '../../', old.avatar);
        if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
      }
      const avatarUrl = `/uploads/avatars/${req.file.filename}`;
      await prisma.member.update({
        where: { id: memberId },
        data: { avatar: avatarUrl },
      });
      res.json({ avatar: avatarUrl });
    } catch (e) {
      next(e);
    }
  });
});

router.put('/:id', verifyToken, scopeByAdmin, async (req, res, next) => {
  try {
    const {
      name, email, phone, gender, company, jobTitle, industry,
      businessItems, brand, website, companyPhone, fax, address,
      city, area, contactPerson, contactPhone,
      introduction, education, experience, currentPosition,
      districtId, memberType, termNumber, isActive, birthdayRoc,
      paymentYears
    } = req.body;

    const data = {
      name, email, phone, gender, company, jobTitle, industry,
      businessItems, brand, website, companyPhone, fax, address,
      city, area, contactPerson, contactPhone,
      introduction, education, experience, currentPosition,
      isActive,
    };

    if (memberType !== undefined) data.memberType = memberType;
    if (termNumber !== undefined) data.termNumber = termNumber === '' || termNumber === null ? null : parseInt(termNumber);
    if (districtId !== undefined) data.districtId = districtId === '' || districtId === null ? null : parseInt(districtId);
    if (paymentYears !== undefined) data.paymentYears = parseInt(paymentYears) || 0;

    // 民國生日轉西元
    if (birthdayRoc !== undefined) {
      data.birthday = birthdayRoc ? rocBirthdayToDate(birthdayRoc) : null;
    }

    const member = await prisma.member.update({
      where: { id: parseInt(req.params.id) },
      data,
    });

    res.json(member);
  } catch (err) {
    next(err);
  }
});

module.exports = router;

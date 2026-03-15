const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const prisma = require('../config/database');
const { verifyToken } = require('../middleware/auth');

const router = express.Router();

// 所有路由都需要會員身分驗證
router.use(verifyToken);
router.use((req, res, next) => {
  if (!req.member) {
    return res.status(401).json({ error: '請使用會員身分登入' });
  }
  next();
});

// ============================================
// 大頭照上傳設定
// ============================================

const avatarStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '../../uploads/avatars');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, `member-${req.member.id}-${Date.now()}${ext}`);
  },
});
const avatarUpload = multer({
  storage: avatarStorage,
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.webp'];
    const allowedMime = ['image/jpeg', 'image/png', 'image/webp'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext) || allowedMime.includes(file.mimetype)) cb(null, true);
    else cb(new Error('僅支援 JPG、PNG、WebP 格式'));
  },
});

// 允許會員自行更新的欄位
const ALLOWED_UPDATE_FIELDS = [
  'email', 'phone', 'company', 'jobTitle', 'industry',
  'businessItems', 'brand', 'website', 'companyPhone', 'fax',
  'address', 'city', 'area', 'contactPerson', 'contactPhone',
  'introduction', 'education', 'experience', 'currentPosition',
  'birthday', 'gender',
];

// ============================================
// 1. GET /profile - 取得會員完整資料
// ============================================

router.get('/profile', async (req, res, next) => {
  try {
    const member = await prisma.member.findUnique({
      where: { id: req.member.id },
      include: {
        district: { select: { name: true } },
        specialDistricts: {
          include: { district: { select: { name: true } } },
        },
      },
    });

    if (!member) {
      return res.status(404).json({ error: '找不到會員資料' });
    }

    // 排除密碼
    const { password, ...profile } = member;
    res.json(profile);
  } catch (err) {
    next(err);
  }
});

// ============================================
// 2. PUT /profile - 更新自己的資料（限定欄位）
// ============================================

router.put('/profile', async (req, res, next) => {
  try {
    const data = {};
    for (const field of ALLOWED_UPDATE_FIELDS) {
      if (req.body[field] !== undefined) {
        if (field === 'birthday' && req.body[field]) {
          data[field] = new Date(req.body[field]);
        } else {
          data[field] = req.body[field];
        }
      }
    }

    const updated = await prisma.member.update({
      where: { id: req.member.id },
      data,
      include: {
        district: { select: { name: true } },
        specialDistricts: {
          include: { district: { select: { name: true } } },
        },
      },
    });

    const { password, ...profile } = updated;
    res.json(profile);
  } catch (err) {
    next(err);
  }
});

// ============================================
// 3. POST /avatar - 上傳大頭照
// ============================================

router.post('/avatar', avatarUpload.single('avatar'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: '請上傳圖片檔案' });
    }

    const avatarPath = `/uploads/avatars/${req.file.filename}`;
    await prisma.member.update({
      where: { id: req.member.id },
      data: { avatar: avatarPath },
    });

    res.json({ avatar: avatarPath });
  } catch (err) {
    next(err);
  }
});

// ============================================
// 4. GET /events - 可參加的活動列表
// ============================================

const visibleStatuses = ['OPEN', 'CLOSED', 'ONGOING', 'ENDED'];

router.get('/events', async (req, res, next) => {
  try {
    const { page = 1, limit = 20, status, keyword } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const memberId = req.member.id;

    // 取得會員的特別區 ID 列表
    const specialDistricts = await prisma.memberSpecialDistrict.findMany({
      where: { memberId },
      select: { districtId: true },
    });
    const specialDistrictIds = specialDistricts.map((sd) => sd.districtId);

    // 建立活動篩選條件：符合會員身分的活動
    const targetConditions = [
      { targetType: 'GENERAL' },
    ];

    // 依會員類型
    if (req.member.memberType === 'CY') {
      targetConditions.push({ targetType: 'CY' });
    }

    // 依地區
    if (req.member.districtId) {
      targetConditions.push({
        targetType: 'DISTRICT',
        districtId: req.member.districtId,
      });
    }

    // 依期別
    if (req.member.termNumber) {
      targetConditions.push({
        targetType: 'TERM',
        termNumber: req.member.termNumber,
      });
    }

    // 依特別區
    if (specialDistrictIds.length > 0) {
      targetConditions.push({
        targetType: 'SPECIAL',
        districtId: { in: specialDistrictIds },
      });
    }

    // 允許跨區報名的活動也要顯示
    targetConditions.push({ allowCrossDistrict: true });

    const where = {
      status: { in: visibleStatuses },
      OR: targetConditions,
    };

    // 活動篩選：依狀態
    if (status && visibleStatuses.includes(status)) {
      where.status = status;
    }

    // 活動篩選：依關鍵字（標題或地點）
    if (keyword && keyword.trim()) {
      const kw = keyword.trim();
      where.AND = [
        {
          OR: [
            { title: { contains: kw, mode: 'insensitive' } },
            { location: { contains: kw, mode: 'insensitive' } },
          ],
        },
      ];
    }

    const [events, total] = await Promise.all([
      prisma.event.findMany({
        where,
        skip,
        take: parseInt(limit),
        include: {
          district: { select: { name: true } },
          _count: { select: { registrations: { where: { status: 'REGISTERED' } } } },
          registrations: {
            where: { memberId, status: 'REGISTERED' },
            select: { id: true, status: true },
          },
        },
        orderBy: { startTime: 'desc' },
      }),
      prisma.event.count({ where }),
    ]);

    // 整理回傳格式
    const data = events.map((event) => {
      const { registrations, ...rest } = event;
      return {
        ...rest,
        isRegistered: registrations.length > 0,
        myRegistration: registrations[0] || null,
      };
    });

    res.json({
      data,
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
// 5. GET /events/:id - 活動詳情
// ============================================

router.get('/events/:id', async (req, res, next) => {
  try {
    const eventId = parseInt(req.params.id);
    const memberId = req.member.id;

    const event = await prisma.event.findUnique({
      where: { id: eventId },
      include: {
        district: { select: { name: true } },
        formFields: { orderBy: { sortOrder: 'asc' } },
        _count: { select: { registrations: { where: { status: 'REGISTERED' } } } },
        registrations: {
          where: { memberId },
          include: { answers: true },
        },
      },
    });

    if (!event) {
      return res.status(404).json({ error: '找不到此活動' });
    }

    const { registrations, ...rest } = event;
    res.json({
      ...rest,
      isRegistered: registrations.some((r) => r.status === 'REGISTERED'),
      myRegistration: registrations[0] || null,
    });
  } catch (err) {
    next(err);
  }
});

// ============================================
// 5-1. GET /events/:id/participants - 查看報名會員
// ============================================

router.get('/events/:id/participants', async (req, res, next) => {
  try {
    const eventId = parseInt(req.params.id);

    const registrations = await prisma.eventRegistration.findMany({
      where: { eventId, status: 'REGISTERED' },
      include: {
        member: {
          select: { id: true, name: true, avatar: true, company: true, jobTitle: true, district: { select: { name: true } } },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json(registrations.map((r) => ({
      id: r.member.id,
      name: r.member.name,
      avatar: r.member.avatar,
      company: r.member.company,
      jobTitle: r.member.jobTitle,
      district: r.member.district?.name || null,
      registeredAt: r.createdAt,
    })));
  } catch (err) {
    next(err);
  }
});

// ============================================
// 6. POST /events/:id/register - 報名活動
// ============================================

router.post('/events/:id/register', async (req, res, next) => {
  try {
    const eventId = parseInt(req.params.id);
    const memberId = req.member.id;
    const { formData } = req.body; // JSON for custom form fields

    // 使用完整資格驗證（含會員類型、繳費狀態、人數上限等）
    const { verifyEventEligibility } = require('../services/paymentVerification');
    const eligibility = await verifyEventEligibility(memberId, eventId);

    if (!eligibility.eligible) {
      return res.status(400).json({ error: eligibility.reason });
    }

    // 在事務內完成報名，防止並發請求導致超額
    const registration = await prisma.$transaction(async (tx) => {
      // 事務內再次檢查：是否已報名（防止快速連點重複報名）
      const existing = await tx.eventRegistration.findUnique({
        where: { eventId_memberId: { eventId, memberId } },
      });

      if (existing && existing.status === 'REGISTERED') {
        throw Object.assign(new Error('您已報名此活動'), { statusCode: 400 });
      }

      // 事務內再次檢查：人數上限（防止並發超額）
      const event = await tx.event.findUnique({
        where: { id: eventId },
        select: { maxParticipants: true, _count: { select: { registrations: { where: { status: 'REGISTERED' } } } } },
      });

      if (event.maxParticipants && event._count.registrations >= event.maxParticipants) {
        throw Object.assign(new Error('此活動報名人數已額滿'), { statusCode: 400 });
      }

      let reg;
      if (existing) {
        // 之前取消過，重新報名
        reg = await tx.eventRegistration.update({
          where: { id: existing.id },
          data: { status: 'REGISTERED' },
        });
      } else {
        reg = await tx.eventRegistration.create({
          data: { eventId, memberId, status: 'REGISTERED' },
        });
      }

      // 儲存表單回答
      if (formData && typeof formData === 'object') {
        await tx.eventRegistrationAnswer.deleteMany({
          where: { registrationId: reg.id },
        });

        const answers = Object.entries(formData)
          .filter(([fieldId]) => !isNaN(parseInt(fieldId)))
          .map(([fieldId, answer]) => ({
            registrationId: reg.id,
            fieldId: parseInt(fieldId),
            answer: String(answer),
          }));

        if (answers.length > 0) {
          await tx.eventRegistrationAnswer.createMany({ data: answers });
        }
      }

      return reg;
    });

    res.json({ message: '報名成功', registration });
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    next(err);
  }
});

// ============================================
// 7. DELETE /events/:id/register - 取消報名
// ============================================

router.delete('/events/:id/register', async (req, res, next) => {
  try {
    const eventId = parseInt(req.params.id);
    const memberId = req.member.id;

    const event = await prisma.event.findUnique({ where: { id: eventId } });
    if (!event) {
      return res.status(404).json({ error: '找不到此活動' });
    }

    // 只有 OPEN 或 CLOSED 狀態可取消（ONGOING/ENDED/CANCELLED 不可取消）
    if (!['OPEN', 'CLOSED'].includes(event.status)) {
      return res.status(400).json({ error: '活動已開始或已結束，無法取消報名' });
    }

    // 活動開始時間已過也不可取消（cron 可能尚未更新狀態為 ONGOING）
    if (new Date() >= event.startTime) {
      return res.status(400).json({ error: '活動即將開始，已無法取消報名' });
    }

    const registration = await prisma.eventRegistration.findUnique({
      where: { eventId_memberId: { eventId, memberId } },
    });

    if (!registration || registration.status !== 'REGISTERED') {
      return res.status(400).json({ error: '您尚未報名此活動' });
    }

    await prisma.eventRegistration.update({
      where: { id: registration.id },
      data: { status: 'CANCELLED' },
    });

    res.json({ message: '已取消報名' });
  } catch (err) {
    next(err);
  }
});

// ============================================
// 8. GET /my-events - 我的報名活動
// ============================================

router.get('/my-events', async (req, res, next) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const memberId = req.member.id;

    const where = { memberId };

    const [registrations, total] = await Promise.all([
      prisma.eventRegistration.findMany({
        where,
        skip,
        take: parseInt(limit),
        include: {
          event: {
            include: {
              district: { select: { name: true } },
              _count: { select: { registrations: { where: { status: 'REGISTERED' } } } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.eventRegistration.count({ where }),
    ]);

    res.json({
      data: registrations,
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
// 9. GET /billing - 我的繳費紀錄
// ============================================

router.get('/billing', async (req, res, next) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const memberId = req.member.id;

    const where = { memberId };

    const [bills, total] = await Promise.all([
      prisma.bill.findMany({
        where,
        skip,
        take: parseInt(limit),
        include: {
          batch: { select: { title: true, billingType: true, startDate: true, endDate: true } },
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
        totalPages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (err) {
    next(err);
  }
});

// ============================================
// 9b. POST /billing/bank-transfer — 銀行匯款資訊
// ============================================

router.post('/billing/bank-transfer', async (req, res, next) => {
  try {
    const memberId = req.member.id;
    const { billIds, bankAccount, transferTime } = req.body;

    if (!billIds || !Array.isArray(billIds) || billIds.length === 0) {
      return res.status(400).json({ error: '請選擇帳單' });
    }
    if (!bankAccount || bankAccount.length < 5) {
      return res.status(400).json({ error: '請輸入帳號後五碼' });
    }

    // 確認帳單屬於該會員且為 UNPAID
    const bills = await prisma.bill.findMany({
      where: { id: { in: billIds.map(Number) }, memberId, status: 'UNPAID' },
    });

    if (bills.length !== billIds.length) {
      return res.status(400).json({ error: '部分帳單不存在或已繳費' });
    }

    // 更新帳單（標記匯款資訊，狀態維持 UNPAID 等管理員手動確認）
    await prisma.bill.updateMany({
      where: { id: { in: billIds.map(Number) }, memberId },
      data: {
        paymentMethod: 'BANK',
        bankAccount: bankAccount.slice(-5),
        transferTime: transferTime ? new Date(transferTime) : new Date(),
      },
    });

    res.json({ message: '匯款資訊已送出，待管理員確認' });
  } catch (err) {
    next(err);
  }
});

// ============================================
// 10. GET /points - 我的點數
// ============================================

router.get('/points', async (req, res, next) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const memberId = req.member.id;

    // 計算有效點數餘額（未過期的）
    const balanceResult = await prisma.pointRecord.aggregate({
      where: {
        memberId,
        expiresAt: { gt: new Date() },
      },
      _sum: { points: true },
    });
    const balance = balanceResult._sum.points || 0;

    // 最近到期日（取最早的未過期正值紀錄的 expiresAt）
    const nearestExpiry = await prisma.pointRecord.findFirst({
      where: {
        memberId,
        points: { gt: 0 },
        expiresAt: { gt: new Date() },
      },
      orderBy: { expiresAt: 'asc' },
      select: { expiresAt: true },
    });
    const expiryDate = nearestExpiry?.expiresAt || null;

    // 最近點數紀錄
    const where = { memberId };

    const [records, total] = await Promise.all([
      prisma.pointRecord.findMany({
        where,
        skip,
        take: parseInt(limit),
        include: {
          event: { select: { title: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.pointRecord.count({ where }),
    ]);

    res.json({
      balance,
      expiryDate,
      data: records,
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
// 11. GET /points/products - 可兌換商品列表
// ============================================

router.get('/points/products', async (req, res, next) => {
  try {
    const products = await prisma.redeemProduct.findMany({
      where: {
        status: 'ACTIVE',
        stock: { gt: 0 },
      },
      include: {
        category: { select: { name: true } },
      },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
    });

    res.json({ data: products });
  } catch (err) {
    next(err);
  }
});

// ============================================
// 11.5 GET /points/products/:id - 商品詳情
// ============================================

router.get('/points/products/:id', async (req, res, next) => {
  try {
    const product = await prisma.redeemProduct.findUnique({
      where: { id: parseInt(req.params.id) },
      include: {
        category: { select: { name: true } },
      },
    });
    if (!product || product.status !== 'ACTIVE') {
      return res.status(404).json({ error: '找不到此商品或已下架' });
    }
    res.json(product);
  } catch (err) {
    next(err);
  }
});

// ============================================
// 12. POST /points/redeem/:productId - 兌換商品
// ============================================

router.post('/points/redeem/:productId', async (req, res, next) => {
  try {
    const productId = parseInt(req.params.productId);
    const memberId = req.member.id;

    // 所有檢查 + 扣除在同一個事務內完成，消除競態條件
    const result = await prisma.$transaction(async (tx) => {
      // 1. 事務內查詢商品（鎖定行，防止並發超賣）
      const product = await tx.redeemProduct.findUnique({
        where: { id: productId },
      });

      if (!product || product.status !== 'ACTIVE') {
        throw Object.assign(new Error('找不到此商品或已下架'), { statusCode: 404 });
      }

      if (product.stock <= 0) {
        throw Object.assign(new Error('此商品已無庫存'), { statusCode: 400 });
      }

      // 2. 事務內查詢餘額（防止並發扣成負數）
      const balanceResult = await tx.pointRecord.aggregate({
        where: {
          memberId,
          expiresAt: { gt: new Date() },
        },
        _sum: { points: true },
      });
      const balance = balanceResult._sum.points || 0;

      if (balance < product.pointCost) {
        throw Object.assign(new Error('點數不足'), { statusCode: 400, balance, required: product.pointCost });
      }

      // 3. 建立兌換紀錄
      const redemption = await tx.pointRedemption.create({
        data: {
          memberId,
          productId,
          points: product.pointCost,
        },
      });

      // 4. 扣點（建立負值點數紀錄）
      await tx.pointRecord.create({
        data: {
          memberId,
          points: -product.pointCost,
          type: 'REDEEM',
          source: `兌換商品：${product.name}`,
          expiresAt: new Date('2099-12-31T23:59:59'), // 扣除紀錄不過期
        },
      });

      // 5. 扣庫存 + 增加兌換次數
      await tx.redeemProduct.update({
        where: { id: productId },
        data: {
          stock: { decrement: 1 },
          redeemCount: { increment: 1 },
        },
      });

      return redemption;
    });

    res.json({ message: '兌換成功', redemption: result });
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({
        error: err.message,
        ...(err.balance !== undefined && { balance: err.balance, required: err.required }),
      });
    }
    next(err);
  }
});

// ============================================
// 13. GET /news - 新聞列表
// ============================================

router.get('/news', async (req, res, next) => {
  try {
    const { category, page = 1, limit = 20 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where = { isDeleted: false };
    if (category) where.category = category;

    const [news, total] = await Promise.all([
      prisma.news.findMany({
        where,
        skip,
        take: parseInt(limit),
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
        totalPages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (err) {
    next(err);
  }
});

// ============================================
// 13-1. GET /news/:id - 單一新聞詳情
// ============================================

router.get('/news/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const news = await prisma.news.findUnique({
      where: { id: parseInt(id) },
      select: {
        id: true,
        title: true,
        content: true,
        category: true,
        imageUrl: true,
        createdAt: true,
        updatedAt: true,
        isDeleted: true,
      },
    });

    if (!news || news.isDeleted) {
      return res.status(404).json({ error: '找不到此公告' });
    }

    const { isDeleted, ...data } = news;
    res.json({ data });
  } catch (err) {
    next(err);
  }
});

// ============================================
// 14. GET /stores - 優惠店家列表
// ============================================

router.get('/stores', async (req, res, next) => {
  try {
    const { search } = req.query;
    const where = { isActive: true };

    if (search && search.trim()) {
      where.OR = [
        { name: { contains: search.trim(), mode: 'insensitive' } },
        { address: { contains: search.trim(), mode: 'insensitive' } },
      ];
    }

    const stores = await prisma.store.findMany({
      where,
      include: {
        offers: true,
        member: { select: { name: true, company: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ data: stores });
  } catch (err) {
    next(err);
  }
});

// ============================================
// 15. POST /push-token - 註冊推播 Token
// ============================================

router.post('/push-token', async (req, res, next) => {
  try {
    const { token, platform } = req.body;
    const memberId = req.member.id;

    if (!token || !platform) {
      return res.status(400).json({ error: 'token 與 platform 為必填' });
    }

    // 用 memberId + token 做 upsert
    const existing = await prisma.pushToken.findFirst({
      where: { memberId, token },
    });

    if (existing) {
      await prisma.pushToken.update({
        where: { id: existing.id },
        data: { platform, updatedAt: new Date() },
      });
    } else {
      await prisma.pushToken.create({
        data: { memberId, token, platform },
      });
    }

    res.json({ message: '推播 Token 已註冊' });
  } catch (err) {
    next(err);
  }
});

// ============================================
// 16. GET /digest-preferences - 取得摘要偏好
// ============================================

router.get('/digest-preferences', async (req, res, next) => {
  try {
    const pref = await prisma.memberPreference.findUnique({
      where: { memberId: req.member.id },
    });

    if (!pref) {
      return res.json({ hasPreference: false, data: null });
    }

    res.json({
      hasPreference: true,
      data: {
        interests: pref.interests ? JSON.parse(pref.interests) : [],
        industries: pref.industries ? JSON.parse(pref.industries) : [],
        perspective: pref.perspective || null,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ============================================
// 17. PUT /digest-preferences - 設定/更新摘要偏好
// ============================================

router.put('/digest-preferences', async (req, res, next) => {
  try {
    const { interests, industries, perspective } = req.body;

    if ((!interests || interests.length === 0) && (!industries || industries.length === 0) && !perspective) {
      return res.status(400).json({ error: '至少需設定一項偏好' });
    }

    if (interests && interests.length > 3) {
      return res.status(400).json({ error: '主題最多選 3 個' });
    }
    if (industries && industries.length > 3) {
      return res.status(400).json({ error: '產業最多選 3 個' });
    }

    const data = {
      interests: interests ? JSON.stringify(interests) : '[]',
      industries: industries ? JSON.stringify(industries) : '[]',
      perspective: perspective || null,
    };

    const pref = await prisma.memberPreference.upsert({
      where: { memberId: req.member.id },
      create: { memberId: req.member.id, ...data },
      update: data,
    });

    res.json({
      message: '偏好已儲存',
      data: {
        interests: JSON.parse(pref.interests || '[]'),
        industries: JSON.parse(pref.industries || '[]'),
        perspective: pref.perspective,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ============================================
// 18. GET /digests - APP 取得個人化摘要列表（懶生成：首次開啟才觸發 AI）
// ============================================

const { buildComboKey, generateDigestsForCombo } = require('../services/digestGenerator');

router.get('/digests', async (req, res, next) => {
  try {
    const { days = 7 } = req.query;

    // 取得會員偏好
    const pref = await prisma.memberPreference.findUnique({
      where: { memberId: req.member.id },
    });

    const interests = pref?.interests ? JSON.parse(pref.interests) : [];
    const industries = pref?.industries ? JSON.parse(pref.industries) : [];
    const perspective = pref?.perspective || '';

    // 偏好不完整 → 回傳空並提示設定
    if (!interests.length || !industries.length || !perspective) {
      return res.json({ data: [], needSetup: true });
    }

    const comboKey = buildComboKey(interests, industries, perspective);

    // 檢查今天是否已有摘要
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const todayDigests = await prisma.aiDigest.findMany({
      where: { comboKey, publishDate: { gte: today } },
    });

    // 懶生成：今天還沒有 → 即時生成（失敗不阻塞，回傳空資料）
    if (todayDigests.length < 2) {
      try {
        const combo = { comboKey, interests, industries, perspective };
        await generateDigestsForCombo(combo);
      } catch (genErr) {
        console.error('[Digests] 生成失敗:', genErr.message);
      }
    }

    // 查詢最近 N 天
    const sinceDate = new Date();
    sinceDate.setDate(sinceDate.getDate() - parseInt(days));

    const digests = await prisma.aiDigest.findMany({
      where: { comboKey, publishDate: { gte: sinceDate } },
      orderBy: [{ publishDate: 'desc' }, { region: 'asc' }],
      select: {
        id: true,
        title: true,
        summary: true,
        region: true,
        interests: true,
        industries: true,
        perspective: true,
        sourceUrls: true,
        publishDate: true,
      },
    });

    // 按日期分組
    const grouped = {};
    for (const d of digests) {
      const dateKey = d.publishDate.toISOString().slice(0, 10);
      if (!grouped[dateKey]) grouped[dateKey] = { date: dateKey, international: null, domestic: null };
      const parsed = {
        ...d,
        interests: d.interests ? JSON.parse(d.interests) : [],
        industries: d.industries ? JSON.parse(d.industries) : [],
        sourceUrls: d.sourceUrls ? JSON.parse(d.sourceUrls) : [],
      };
      if (d.region === 'INTERNATIONAL') grouped[dateKey].international = parsed;
      else grouped[dateKey].domestic = parsed;
    }

    const data = Object.values(grouped).sort((a, b) => b.date.localeCompare(a.date));

    res.json({ data, needSetup: false });
  } catch (err) {
    next(err);
  }
});

// ============================================
// 19. GET /search - 搜尋會員
// ============================================

router.get('/search', async (req, res, next) => {
  try {
    const { keyword, districtId, termNumber, page = 1, limit = 20 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where = { isActive: true };

    if (keyword) {
      where.OR = [
        { account: { contains: keyword } },
        { name: { contains: keyword } },
        { company: { contains: keyword } },
        { industry: { contains: keyword } },
        { jobTitle: { contains: keyword } },
      ];
    }

    if (districtId) where.districtId = parseInt(districtId);
    if (termNumber) where.termNumber = parseInt(termNumber);

    const [members, total] = await Promise.all([
      prisma.member.findMany({
        where,
        skip,
        take: parseInt(limit),
        select: {
          id: true,
          name: true,
          avatar: true,
          company: true,
          industry: true,
          jobTitle: true,
          district: { select: { name: true } },
        },
        orderBy: { name: 'asc' },
      }),
      prisma.member.count({ where }),
    ]);

    res.json({
      data: members,
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
// 活動花絮 (APP 端) — 必須在 /:id 前面避免路由衝突
// ============================================

// GET /app/member/highlights - 活動花絮列表（已結束且有花絮的活動）
router.get('/highlights', async (req, res, next) => {
  try {
    const { page = 1, limit = 25, targetType } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where = {
      status: 'ENDED',
      highlights: { some: {} },
    };

    if (targetType) {
      where.targetType = targetType;
    }

    const [events, total] = await Promise.all([
      prisma.event.findMany({
        where,
        skip,
        take: parseInt(limit),
        select: {
          id: true,
          title: true,
          startTime: true,
          coverImage: true,
          targetType: true,
          district: { select: { name: true } },
          _count: { select: { highlights: true } },
        },
        orderBy: { startTime: 'desc' },
      }),
      prisma.event.count({ where }),
    ]);

    res.json({
      data: events,
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

// GET /app/member/highlights/:eventId - 單一活動花絮照片
router.get('/highlights/:eventId', async (req, res, next) => {
  try {
    const eventId = parseInt(req.params.eventId);
    if (isNaN(eventId)) {
      return res.status(400).json({ error: '無效的活動 ID' });
    }

    const event = await prisma.event.findUnique({
      where: { id: eventId },
      select: { id: true, title: true, status: true },
    });

    if (!event) {
      return res.status(404).json({ error: '找不到此活動' });
    }

    const highlights = await prisma.eventHighlight.findMany({
      where: { eventId },
      select: {
        id: true,
        imageUrl: true,
        caption: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({
      event: { id: event.id, title: event.title },
      data: highlights,
    });
  } catch (err) {
    next(err);
  }
});

// ============================================
// 隱私設定 (Privacy Settings) — 必須在 /:id 前面避免路由衝突
// ============================================

const PRIVACY_FIELDS = [
  'company', 'jobTitle', 'address', 'phone', 'fax', 'mobile',
  'website', 'email', 'industry', 'brand', 'businessScope',
  'contactPerson', 'contactPhone', 'qualifications',
];

// 手機/電話相關欄位預設不公開，其餘預設公開
const PRIVATE_BY_DEFAULT = ['phone', 'mobile', 'contactPhone'];

function getDefaultPrivacy() {
  const defaults = {};
  PRIVACY_FIELDS.forEach((field) => {
    defaults[field] = !PRIVATE_BY_DEFAULT.includes(field);
  });
  return defaults;
}

// GET /app/member/privacy - 取得隱私設定
router.get('/privacy', async (req, res, next) => {
  try {
    const member = await prisma.member.findUnique({
      where: { id: req.member.id },
      select: { privacySettings: true },
    });

    if (!member) {
      return res.status(404).json({ error: '找不到會員資料' });
    }

    let settings = getDefaultPrivacy();
    if (member.privacySettings) {
      try {
        const saved = JSON.parse(member.privacySettings);
        settings = { ...settings, ...saved };
      } catch (e) {
        // JSON 解析失敗，回傳預設值
      }
    }

    res.json({ data: settings });
  } catch (err) {
    next(err);
  }
});

// PUT /app/member/privacy - 更新隱私設定
router.put('/privacy', async (req, res, next) => {
  try {
    const body = req.body;

    if (!body || typeof body !== 'object') {
      return res.status(400).json({ error: '請提供隱私設定' });
    }

    const settings = {};
    PRIVACY_FIELDS.forEach((field) => {
      if (typeof body[field] === 'boolean') {
        settings[field] = body[field];
      }
    });

    const member = await prisma.member.findUnique({
      where: { id: req.member.id },
      select: { privacySettings: true },
    });

    let existing = getDefaultPrivacy();
    if (member && member.privacySettings) {
      try {
        existing = { ...existing, ...JSON.parse(member.privacySettings) };
      } catch (e) {
        // ignore parse error
      }
    }

    const merged = { ...existing, ...settings };

    await prisma.member.update({
      where: { id: req.member.id },
      data: { privacySettings: JSON.stringify(merged) },
    });

    res.json({ message: '隱私設定已更新', data: merged });
  } catch (err) {
    next(err);
  }
});

// ============================================
// 20. GET /:id - 查看其他會員公開資料
// 說明：會員搜尋結果點進去時，顯示該會員的名片式資料
// 僅回傳公開欄位，不含密碼、email、phone 等隱私資訊
// ============================================

router.get('/:id', async (req, res, next) => {
  try {
    const memberId = parseInt(req.params.id);
    if (isNaN(memberId)) {
      return res.status(400).json({ error: '無效的會員 ID' });
    }

    const member = await prisma.member.findUnique({
      where: { id: memberId },
      select: {
        id: true,
        account: true,
        name: true,
        avatar: true,
        company: true,
        jobTitle: true,
        industry: true,
        businessItems: true,
        brand: true,
        website: true,
        introduction: true,
        education: true,
        experience: true,
        currentPosition: true,
        memberType: true,
        termNumber: true,
        address: true,
        city: true,
        area: true,
        phone: true,
        companyPhone: true,
        fax: true,
        email: true,
        contactPerson: true,
        contactPhone: true,
        privacySettings: true,
        district: { select: { id: true, name: true } },
        specialDistricts: {
          include: { district: { select: { name: true } } },
        },
      },
    });

    if (!member) {
      return res.status(404).json({ error: '找不到此會員' });
    }

    // 套用隱私設定：隱藏未公開的欄位
    let privacy = getDefaultPrivacy();
    if (member.privacySettings) {
      try {
        privacy = { ...privacy, ...JSON.parse(member.privacySettings) };
      } catch (e) {}
    }

    const { privacySettings, ...memberData } = member;

    // 將隱私設定為 false 的欄位設為 null
    const privacyFieldMap = {
      company: 'company',
      jobTitle: 'jobTitle',
      address: 'address',
      phone: 'phone',
      fax: 'fax',
      mobile: 'companyPhone',
      website: 'website',
      email: 'email',
      industry: 'industry',
      brand: 'brand',
      businessScope: 'businessItems',
      contactPerson: 'contactPerson',
      contactPhone: 'contactPhone',
    };

    for (const [privacyKey, dbField] of Object.entries(privacyFieldMap)) {
      if (!privacy[privacyKey]) {
        memberData[dbField] = null;
      }
    }

    // 查詢是否已關注此會員
    const followRecord = await prisma.follow.findUnique({
      where: {
        followerId_followingId: {
          followerId: req.member.id,
          followingId: memberId,
        },
      },
    });

    res.json({
      ...memberData,
      isFollowed: !!followRecord,
    });
  } catch (err) {
    next(err);
  }
});

// ============================================
// 密碼修改
// ============================================
const bcrypt = require('bcrypt');

router.put('/password', async (req, res, next) => {
  try {
    const { oldPassword, newPassword } = req.body;

    if (!oldPassword || !newPassword) {
      return res.status(400).json({ error: '請填寫目前密碼和新密碼' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ error: '新密碼至少需要 6 個字元' });
    }

    const member = await prisma.member.findUnique({
      where: { id: req.member.id },
      select: { password: true },
    });

    const isMatch = await bcrypt.compare(oldPassword, member.password);
    if (!isMatch) {
      return res.status(400).json({ error: '目前密碼不正確' });
    }

    const hashed = await bcrypt.hash(newPassword, 10);
    await prisma.member.update({
      where: { id: req.member.id },
      data: { password: hashed },
    });

    res.json({ message: '密碼修改成功' });
  } catch (err) {
    next(err);
  }
});

// ============================================
// Endpoint: 關注的會員
// ============================================

// GET /app/member/followed - 取得我關注的會員列表
router.get('/followed', async (req, res, next) => {
  try {
    const follows = await prisma.follow.findMany({
      where: { followerId: req.member.id },
      include: {
        following: {
          select: {
            id: true,
            name: true,
            avatar: true,
            company: true,
            industry: true,
            jobTitle: true,
            district: { select: { name: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const data = follows.map((f) => f.following);
    res.json({ data });
  } catch (err) {
    next(err);
  }
});

// POST /app/member/follow/:id - 關注會員
router.post('/follow/:id', async (req, res, next) => {
  try {
    const followingId = parseInt(req.params.id);
    if (followingId === req.member.id) {
      return res.status(400).json({ error: '不能關注自己' });
    }

    const target = await prisma.member.findUnique({ where: { id: followingId } });
    if (!target) {
      return res.status(404).json({ error: '找不到該會員' });
    }

    await prisma.follow.upsert({
      where: {
        followerId_followingId: {
          followerId: req.member.id,
          followingId,
        },
      },
      create: { followerId: req.member.id, followingId },
      update: {},
    });

    res.json({ message: '已關注' });
  } catch (err) {
    next(err);
  }
});

// DELETE /app/member/follow/:id - 取消關注會員
router.delete('/follow/:id', async (req, res, next) => {
  try {
    const followingId = parseInt(req.params.id);

    await prisma.follow.deleteMany({
      where: {
        followerId: req.member.id,
        followingId,
      },
    });

    res.json({ message: '已取消關注' });
  } catch (err) {
    next(err);
  }
});

// ============================================
// 照片上傳 / 列表
// ============================================

const photoStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '../../uploads/photos');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, `photo-${req.member.id}-${Date.now()}${ext}`);
  },
});
const photoUpload = multer({
  storage: photoStorage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.webp'];
    const allowedMime = ['image/jpeg', 'image/png', 'image/webp'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext) || allowedMime.includes(file.mimetype)) cb(null, true);
    else cb(new Error('僅支援 JPG、PNG、WebP 格式'));
  },
});

// POST /app/member/photo/upload - 上傳活動照片
router.post('/photo/upload', photoUpload.single('upload_file'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: '請選擇照片' });
    }

    const { title, user_ids } = req.body;
    const imageUrl = `/uploads/photos/${req.file.filename}`;

    // 建立照片記錄
    const photo = await prisma.photo.create({
      data: {
        memberId: req.member.id,
        imageUrl,
        caption: title || null,
      },
    });

    // 處理標註人員
    const tagIds = new Set();
    tagIds.add(req.member.id); // 自己一定被標註
    if (user_ids) {
      const ids = String(user_ids).split(',').map(Number).filter(Boolean);
      ids.forEach((id) => tagIds.add(id));
    }

    if (tagIds.size > 0) {
      await prisma.photoTag.createMany({
        data: [...tagIds].map((memberId) => ({ photoId: photo.id, memberId })),
        skipDuplicates: true,
      });
    }

    res.json({ message: '已上傳完成', photoId: photo.id });
  } catch (err) {
    next(err);
  }
});

// GET /app/member/photos - 我上傳的照片
router.get('/photos', async (req, res, next) => {
  try {
    const photos = await prisma.photo.findMany({
      where: { memberId: req.member.id },
      include: {
        tags: {
          include: { member: { select: { id: true, name: true, avatar: true } } },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ data: photos });
  } catch (err) {
    next(err);
  }
});

// GET /app/member/photos/tagged - 被標註的照片
router.get('/photos/tagged', async (req, res, next) => {
  try {
    const tags = await prisma.photoTag.findMany({
      where: { memberId: req.member.id },
      include: {
        photo: {
          include: {
            member: { select: { id: true, name: true } },
            tags: {
              include: { member: { select: { id: true, name: true, avatar: true } } },
            },
          },
        },
      },
      orderBy: { photo: { createdAt: 'desc' } },
    });
    res.json({ data: tags.map((t) => t.photo) });
  } catch (err) {
    next(err);
  }
});

// PUT /app/member/photo/:id/tags - 更新照片標籤與說明
router.put('/photo/:id/tags', async (req, res, next) => {
  try {
    const photoId = parseInt(req.params.id);
    const { title, user_ids } = req.body;

    // 確認照片存在且為本人上傳
    const photo = await prisma.photo.findUnique({ where: { id: photoId } });
    if (!photo) {
      return res.status(404).json({ error: '照片不存在' });
    }
    if (photo.memberId !== req.member.id) {
      return res.status(403).json({ error: '只能編輯自己上傳的照片' });
    }

    // 更新說明文字
    await prisma.photo.update({
      where: { id: photoId },
      data: { caption: (title || '').trim() || null },
    });

    // 重建標籤：先刪除舊的，再新增
    await prisma.photoTag.deleteMany({ where: { photoId } });

    const tagIds = new Set();
    tagIds.add(req.member.id); // 上傳者一定被標註
    if (user_ids) {
      const ids = String(user_ids).split(',').map(Number).filter(Boolean);
      ids.forEach((id) => tagIds.add(id));
    }

    if (tagIds.size > 0) {
      await prisma.photoTag.createMany({
        data: [...tagIds].map((memberId) => ({ photoId, memberId })),
        skipDuplicates: true,
      });
    }

    // 回傳更新後的照片（含標籤）
    const updated = await prisma.photo.findUnique({
      where: { id: photoId },
      include: {
        tags: {
          include: { member: { select: { id: true, name: true, avatar: true } } },
        },
      },
    });

    res.json({ message: '已更新標籤', photo: updated });
  } catch (err) {
    next(err);
  }
});

// GET /app/member/search-taggable?q=xxx - 搜尋可標註的會員
router.get('/search-taggable', async (req, res, next) => {
  try {
    const q = (req.query.q || '').trim();
    if (!q) return res.json({ data: [] });

    const members = await prisma.member.findMany({
      where: {
        name: { contains: q },
      },
      select: { id: true, name: true, avatar: true, company: true },
      take: 20,
    });
    res.json({ data: members });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const path = require('path');
const prisma = require('../config/database');
const { verifyToken, scopeByAdmin } = require('../middleware/auth');
const { verifyEventEligibility } = require('../services/paymentVerification');

const router = express.Router();

// 自動更新過期活動狀態：endTime 已過且非 ENDED/CANCELLED 的活動自動切為 ENDED
async function autoUpdateEventStatus() {
  const now = new Date();
  await prisma.event.updateMany({
    where: {
      endTime: { lte: now },
      status: { notIn: ['ENDED', 'CANCELLED', 'DRAFT'] },
    },
    data: { status: 'ENDED' },
  });
}

// 活動列表
router.get('/', verifyToken, scopeByAdmin, async (req, res, next) => {
  try {
    await autoUpdateEventStatus();
    const { status, targetType, page = 1, limit = 10 } = req.query;
    const skip = (page - 1) * limit;

    const where = {};
    if (req.scope.districtId) where.districtId = req.scope.districtId;
    if (req.scope.termNumber) where.termNumber = req.scope.termNumber;
    if (status) where.status = status;
    if (targetType) where.targetType = targetType;
    // 前台只顯示非草稿、非取消的活動
    if (req.query.frontEnd === 'true') {
      where.status = { notIn: ['DRAFT', 'CANCELLED'] };
    }

    const [events, total] = await Promise.all([
      prisma.event.findMany({
        where,
        skip: parseInt(skip),
        take: parseInt(limit),
        include: {
          district: { select: { name: true } },
          _count: { select: { registrations: { where: { status: 'REGISTERED' } }, checkins: true } },
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
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    next(err);
  }
});

// 建立活動
router.post('/', verifyToken, scopeByAdmin, async (req, res, next) => {
  try {
    const {
      title, description, targetType, districtId, termNumber,
      startTime, endTime, location, address, maxParticipants,
      registrationDeadline, requirePayment, isFreeOpen,
      allowCrossDistrict, points, formFields, coverImage
    } = req.body;

    if (!title || !startTime) {
      return res.status(400).json({ error: '活動名稱與開始時間為必填' });
    }

    // 產生活動專屬 QR Code
    const qrCode = uuidv4();

    const event = await prisma.event.create({
      data: {
        title,
        description,
        targetType: targetType || 'GENERAL',
        status: 'DRAFT', // 新活動預設為草稿
        districtId: districtId ? parseInt(districtId) : null,
        termNumber: termNumber ? parseInt(termNumber) : null,
        startTime: new Date(startTime),
        endTime: endTime ? new Date(endTime) : null,
        location,
        address,
        coverImage,
        maxParticipants: maxParticipants ? parseInt(maxParticipants) : null,
        registrationDeadline: registrationDeadline ? new Date(registrationDeadline) : null,
        requirePayment: requirePayment || false,
        isFreeOpen: isFreeOpen || false,
        allowCrossDistrict: allowCrossDistrict || false,
        points: points ? parseInt(points) : 0,
        qrCode,
        formFields: formFields ? {
          create: formFields.map((field, index) => ({
            fieldName: field.fieldName,
            fieldType: field.fieldType,
            isRequired: field.isRequired || false,
            options: field.options ? JSON.stringify(field.options) : null,
            sortOrder: index,
          })),
        } : undefined,
      },
      include: { formFields: true },
    });

    res.status(201).json(event);
  } catch (err) {
    next(err);
  }
});

// 取得活動花絮列表（花絮管理用，放在 /:id 之前避免路由衝突）
// 回傳所有非草稿活動，前端依 status 判斷是否可上傳（僅 ENDED 可上傳）
router.get('/highlights/list', verifyToken, async (req, res, next) => {
  try {
    await autoUpdateEventStatus();
    const events = await prisma.event.findMany({
      where: { status: { not: 'DRAFT' } },
      include: {
        district: { select: { name: true } },
        _count: { select: { highlights: true, registrations: { where: { status: 'REGISTERED' } }, checkins: true } },
      },
      orderBy: { startTime: 'desc' },
    });

    res.json(events);
  } catch (err) {
    next(err);
  }
});

// 更新活動狀態（手動切換，含轉換規則驗證）
router.put('/:id/status', verifyToken, async (req, res, next) => {
  try {
    const { status } = req.body;
    const eventId = parseInt(req.params.id);
    const validStatuses = ['DRAFT', 'OPEN', 'CLOSED', 'ONGOING', 'ENDED', 'CANCELLED'];

    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: '無效的狀態值' });
    }

    // 取得目前狀態
    const current = await prisma.event.findUnique({
      where: { id: eventId },
      select: { status: true },
    });
    if (!current) {
      return res.status(404).json({ error: '找不到此活動' });
    }

    // 狀態轉換規則：CANCELLED 可從任何非 ENDED 狀態轉入
    const allowedTransitions = {
      DRAFT: ['OPEN', 'CANCELLED'],
      OPEN: ['CLOSED', 'ONGOING', 'CANCELLED'],
      CLOSED: ['OPEN', 'ONGOING', 'CANCELLED'],
      ONGOING: ['ENDED', 'CANCELLED'],
      ENDED: ['ARCHIVED'],
    };

    if (status !== 'CANCELLED') {
      const allowed = allowedTransitions[current.status] || [];
      if (!allowed.includes(status)) {
        return res.status(400).json({
          error: `無法從「${current.status}」轉換為「${status}」`,
        });
      }
    }

    // 取消活動時，連動處理報名紀錄
    if (status === 'CANCELLED') {
      await prisma.$transaction([
        // 更新活動狀態
        prisma.event.update({
          where: { id: eventId },
          data: { status },
        }),
        // 批次取消所有報名
        prisma.eventRegistration.updateMany({
          where: { eventId, status: 'REGISTERED' },
          data: { status: 'CANCELLED' },
        }),
      ]);

      // TODO: 發送推播通知已報名的會員
      const cancelledCount = await prisma.eventRegistration.count({
        where: { eventId, status: 'CANCELLED' },
      });

      return res.json({
        message: `活動已取消，${cancelledCount} 筆報名已連動取消`,
        status: 'CANCELLED',
      });
    }

    const event = await prisma.event.update({
      where: { id: eventId },
      data: { status },
    });

    res.json(event);
  } catch (err) {
    next(err);
  }
});

// 修改活動
router.put('/:id', verifyToken, async (req, res, next) => {
  try {
    const eventId = parseInt(req.params.id);
    const {
      title, description, coverImage, targetType, districtId, termNumber,
      startTime, endTime, location, address, maxParticipants,
      registrationDeadline, requirePayment, isFreeOpen,
      allowCrossDistrict, points, formFields
    } = req.body;

    const data = {
      title, description, coverImage, targetType,
      districtId: districtId !== undefined ? (districtId ? parseInt(districtId) : null) : undefined,
      termNumber: termNumber !== undefined ? (termNumber ? parseInt(termNumber) : null) : undefined,
      startTime: startTime ? new Date(startTime) : undefined,
      endTime: endTime ? new Date(endTime) : undefined,
      location, address, maxParticipants: maxParticipants !== undefined ? (maxParticipants ? parseInt(maxParticipants) : null) : undefined,
      registrationDeadline: registrationDeadline !== undefined ? (registrationDeadline ? new Date(registrationDeadline) : null) : undefined,
      requirePayment, isFreeOpen, allowCrossDistrict,
      points: points !== undefined ? parseInt(points) : undefined,
    };

    // 如果有傳 formFields，先刪除舊的再建立新的
    if (formFields !== undefined) {
      await prisma.eventFormField.deleteMany({ where: { eventId } });

      if (formFields.length > 0) {
        await prisma.eventFormField.createMany({
          data: formFields.map((field, index) => ({
            eventId,
            fieldName: field.fieldName,
            fieldType: field.fieldType,
            isRequired: field.isRequired || false,
            options: field.options ? JSON.stringify(field.options) : null,
            sortOrder: index,
          })),
        });
      }
    }

    const event = await prisma.event.update({
      where: { id: eventId },
      data,
      include: { formFields: { orderBy: { sortOrder: 'asc' } } },
    });

    res.json(event);
  } catch (err) {
    next(err);
  }
});

// 活動詳情
router.get('/:id', verifyToken, async (req, res, next) => {
  try {
    const event = await prisma.event.findUnique({
      where: { id: parseInt(req.params.id) },
      include: {
        district: true,
        formFields: { orderBy: { sortOrder: 'asc' } },
        _count: { select: { registrations: { where: { status: 'REGISTERED' } }, checkins: true } },
      },
    });

    if (!event) {
      return res.status(404).json({ error: '找不到此活動' });
    }

    res.json(event);
  } catch (err) {
    next(err);
  }
});

// 活動報名（含繳費資格驗證）
router.post('/:id/register', verifyToken, async (req, res, next) => {
  try {
    const eventId = parseInt(req.params.id);
    const { memberId, answers } = req.body;

    if (!memberId) {
      return res.status(400).json({ error: '會員 ID 為必填' });
    }

    // 繳費資格驗證
    const eligibility = await verifyEventEligibility(parseInt(memberId), eventId);
    if (!eligibility.eligible) {
      return res.status(403).json({ error: eligibility.reason });
    }

    // 建立報名
    const registration = await prisma.eventRegistration.create({
      data: {
        eventId,
        memberId: parseInt(memberId),
        status: 'REGISTERED',
        answers: answers ? {
          create: answers.map((a) => ({
            fieldId: parseInt(a.fieldId),
            answer: String(a.answer),
          })),
        } : undefined,
      },
      include: {
        member: { select: { account: true, name: true } },
        answers: { include: { field: true } },
      },
    });

    // TODO: 發送報名成功推播

    res.status(201).json(registration);
  } catch (err) {
    if (err.code === 'P2002') {
      return res.status(409).json({ error: '您已報名此活動' });
    }
    next(err);
  }
});

// 取消報名
router.put('/:id/cancel', verifyToken, async (req, res, next) => {
  try {
    const { memberId } = req.body;

    const registration = await prisma.eventRegistration.update({
      where: {
        eventId_memberId: {
          eventId: parseInt(req.params.id),
          memberId: parseInt(memberId),
        },
      },
      data: { status: 'CANCELLED' },
    });

    res.json({ message: '已取消報名', registration });
  } catch (err) {
    next(err);
  }
});

// 活動報名列表（支援分頁）
router.get('/:id/registrations', verifyToken, async (req, res, next) => {
  try {
    const { page = 1, limit = 50 } = req.query;
    const skip = (page - 1) * limit;
    const eventId = parseInt(req.params.id);

    const [registrations, total] = await Promise.all([
      prisma.eventRegistration.findMany({
        where: { eventId, status: 'REGISTERED' },
        skip: parseInt(skip),
        take: parseInt(limit),
        include: {
          member: {
            select: { id: true, account: true, name: true, district: { select: { name: true } } },
          },
          answers: { include: { field: { select: { id: true, fieldName: true, fieldType: true } } } },
        },
      }),
      prisma.eventRegistration.count({ where: { eventId, status: 'REGISTERED' } }),
    ]);

    res.json({
      data: registrations,
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

// 取得單一活動的花絮列表
router.get('/:id/highlights', verifyToken, async (req, res, next) => {
  try {
    const highlights = await prisma.eventHighlight.findMany({
      where: { eventId: parseInt(req.params.id) },
      orderBy: { createdAt: 'desc' },
    });

    res.json(highlights);
  } catch (err) {
    next(err);
  }
});

// 上傳活動花絮圖片（multer）
const highlightStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, '../../uploads/events')),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `highlight-${req.params.id}-${Date.now()}${ext}`);
  },
});
const uploadHighlight = multer({ storage: highlightStorage, limits: { fileSize: 2 * 1024 * 1024 } });

router.post('/:id/highlights', verifyToken, uploadHighlight.array('images', 50), async (req, res, next) => {
  try {
    const event = await prisma.event.findUnique({
      where: { id: parseInt(req.params.id) },
    });

    if (!event) {
      return res.status(404).json({ error: '找不到此活動' });
    }

    if (event.status !== 'ENDED') {
      return res.status(400).json({ error: '活動尚未結束，無法上傳花絮' });
    }

    const files = req.files || [];
    const captions = req.body.captions ? (Array.isArray(req.body.captions) ? req.body.captions : [req.body.captions]) : [];

    if (files.length === 0) {
      return res.status(400).json({ error: '請選擇至少一張圖片' });
    }

    const highlights = await prisma.eventHighlight.createMany({
      data: files.map((file, i) => ({
        eventId: event.id,
        imageUrl: `/uploads/events/${file.filename}`,
        caption: captions[i] || null,
      })),
    });

    res.status(201).json({ created: highlights.count });
  } catch (err) {
    next(err);
  }
});

// 刪除花絮
router.delete('/highlights/:highlightId', verifyToken, async (req, res, next) => {
  try {
    await prisma.eventHighlight.delete({
      where: { id: parseInt(req.params.highlightId) },
    });

    res.json({ message: '已刪除' });
  } catch (err) {
    next(err);
  }
});

// 上傳活動封面圖
const coverStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, '../../uploads/events')),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `event-${req.params.id}-${Date.now()}${ext}`);
  },
});
const uploadCover = multer({ storage: coverStorage, limits: { fileSize: 5 * 1024 * 1024 } });

router.post('/:id/cover', verifyToken, uploadCover.single('cover'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: '請選擇圖片' });
    }

    const coverImage = `/uploads/events/${req.file.filename}`;
    const event = await prisma.event.update({
      where: { id: parseInt(req.params.id) },
      data: { coverImage },
    });

    res.json({ coverImage: event.coverImage });
  } catch (err) {
    next(err);
  }
});

// 上傳活動描述內嵌圖片（富文本編輯器用）
const descImageStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, '../../uploads/events')),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `desc-${req.params.id}-${Date.now()}${ext}`);
  },
});
const uploadDescImage = multer({
  storage: descImageStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('只接受圖片檔案'), false);
    }
  },
});

router.post('/:id/description-image', verifyToken, uploadDescImage.single('image'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: '請選擇圖片' });
    }

    const url = `/uploads/events/${req.file.filename}`;
    res.json({ url });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

const express = require('express');
const multer = require('multer');
const path = require('path');
const prisma = require('../config/database');
const { verifyToken, requireRole } = require('../middleware/auth');
const firebaseStorage = require('../services/firebaseStorage');

const router = express.Router();

// 允許的檔案類型
const ALLOWED_EXTENSIONS = ['.doc', '.docx', '.csv', '.xls', '.xlsx', '.pdf', '.rar', '.jpg', '.jpeg', '.png'];
const ALLOWED_MIME_TYPES = [
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/csv',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/pdf',
  'application/x-rar-compressed',
  'application/vnd.rar',
  'image/jpeg',
  'image/png',
];

const uploadDoc = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 30 * 1024 * 1024 }, // 30MB
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ALLOWED_EXTENSIONS.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`不支援的檔案類型：${ext}。允許的類型：doc, docx, csv, xls, xlsx, pdf, rar, jpg, png`));
    }
  },
});

// 取得檔案類型（簡化顯示）
function getFileType(filename) {
  const ext = path.extname(filename).toLowerCase().replace('.', '');
  const mapping = { docx: 'doc', xlsx: 'xls', jpeg: 'jpg' };
  return mapping[ext] || ext;
}

// ========== 公開 API（APP 用）==========

// GET /public — 文件列表（APP 下載用，不需管理者驗證）
router.get('/public', async (req, res, next) => {
  try {
    const documents = await prisma.document.findMany({
      select: {
        id: true,
        fileName: true,
        fileType: true,
        fileSize: true,
        fileUrl: true,
        createdAt: true,
      },
      orderBy: [
        { sortOrder: 'asc' },
        { createdAt: 'desc' },
      ],
    });

    res.json(documents);
  } catch (err) {
    next(err);
  }
});

// ========== 以下限定總管理者 ==========
router.use(verifyToken, requireRole('SUPER'));

// GET / — 文件列表（後台管理）
router.get('/', async (req, res, next) => {
  try {
    const { page = '1', limit = '10', search = '' } = req.query;
    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.max(1, Math.min(100, parseInt(limit)));
    const skip = (pageNum - 1) * limitNum;

    const where = search
      ? { fileName: { contains: search, mode: 'insensitive' } }
      : {};

    const [data, total] = await Promise.all([
      prisma.document.findMany({
        where,
        orderBy: [
          { sortOrder: 'asc' },
          { createdAt: 'desc' },
        ],
        skip,
        take: limitNum,
      }),
      prisma.document.count({ where }),
    ]);

    res.json({
      data,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
      },
    });
  } catch (err) {
    next(err);
  }
});

// POST / — 上傳文件
router.post('/', (req, res, next) => {
  uploadDoc.single('file')(req, res, async (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: '檔案大小不可超過 30MB' });
      }
      return res.status(400).json({ error: err.message });
    }
    if (!req.file) {
      return res.status(400).json({ error: '請選擇檔案' });
    }

    try {
      const { description, sortOrder } = req.body;
      const fileName = req.file.originalname;
      const fileType = getFileType(fileName);
      const fileSize = req.file.size;

      // 上傳到 Firebase Storage
      const fileUrl = await firebaseStorage.uploadFile(
        req.file,
        'documents',
        `doc-${Date.now()}`
      );

      const document = await prisma.document.create({
        data: {
          fileName,
          fileType,
          fileSize,
          fileUrl,
          description: description || null,
          sortOrder: sortOrder ? parseInt(sortOrder) : 0,
        },
      });

      res.status(201).json(document);
    } catch (e) {
      next(e);
    }
  });
});

// PUT /reorder — 批次更新排序（放在 /:id 之前避免路由衝突）
router.put('/reorder', async (req, res, next) => {
  try {
    const { items } = req.body; // [{ id, sortOrder }]
    if (!Array.isArray(items)) {
      return res.status(400).json({ error: '請提供 items 陣列' });
    }

    await Promise.all(
      items.map(item =>
        prisma.document.update({
          where: { id: item.id },
          data: { sortOrder: item.sortOrder },
        })
      )
    );

    res.json({ message: '排序已更新' });
  } catch (err) {
    next(err);
  }
});

// PUT /:id — 更新文件資訊
router.put('/:id', async (req, res, next) => {
  try {
    const { fileName, description, sortOrder } = req.body;

    const data = {};
    if (fileName !== undefined) data.fileName = fileName;
    if (description !== undefined) data.description = description;
    if (sortOrder !== undefined) data.sortOrder = parseInt(sortOrder);

    const document = await prisma.document.update({
      where: { id: parseInt(req.params.id) },
      data,
    });

    res.json(document);
  } catch (err) {
    next(err);
  }
});

// DELETE /:id — 刪除文件
router.delete('/:id', async (req, res, next) => {
  try {
    const doc = await prisma.document.findUnique({
      where: { id: parseInt(req.params.id) },
    });

    if (!doc) {
      return res.status(404).json({ error: '文件不存在' });
    }

    // 嘗試從 Firebase Storage 刪除
    try {
      await firebaseStorage.deleteByUrl(doc.fileUrl);
    } catch (e) {
      console.error('[Documents] Firebase Storage 刪除失敗:', e.message);
    }

    await prisma.document.delete({
      where: { id: parseInt(req.params.id) },
    });

    res.json({ message: '已刪除' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

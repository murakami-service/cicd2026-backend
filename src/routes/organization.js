const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const prisma = require('../config/database');
const { verifyToken } = require('../middleware/auth');
const firebaseStorage = require('../services/firebaseStorage');

const router = express.Router();

// 組織架構列表（依分類/年度，支援父子層級）
router.get('/', verifyToken, async (req, res, next) => {
  try {
    const { year, groupType, parentId } = req.query;
    const where = {};
    if (year) where.year = parseInt(year);
    if (groupType) where.groupType = groupType;
    // parentId=null → 只取頂層；parentId=數字 → 取該父層下的子組織
    if (parentId === 'null' || parentId === '') {
      where.parentId = null;
    } else if (parentId) {
      where.parentId = parseInt(parentId);
    }

    const groups = await prisma.organizationGroup.findMany({
      where,
      include: {
        children: {
          include: {
            roles: {
              include: {
                member: { select: { id: true, account: true, name: true, avatar: true, currentPosition: true, experience: true, education: true } },
                position: true,
              },
            },
            _count: { select: { children: true } },
          },
          orderBy: { name: 'asc' },
        },
        roles: {
          include: {
            member: { select: { id: true, account: true, name: true, avatar: true, currentPosition: true, experience: true, education: true } },
            position: true,
          },
        },
        _count: { select: { children: true } },
      },
      orderBy: { name: 'asc' },
    });

    res.json(groups);
  } catch (err) {
    next(err);
  }
});

// 新增組織群組
router.post('/groups', verifyToken, async (req, res, next) => {
  try {
    const { name, groupType, year, parentId } = req.body;

    if (!name || !groupType) {
      return res.status(400).json({ error: '名稱與分類為必填' });
    }

    const validTypes = ['HEAD', 'REGIONAL', 'TERM', 'COMMITTEE', 'CY', 'LOCAL'];
    if (!validTypes.includes(groupType)) {
      return res.status(400).json({ error: '無效的組織分類' });
    }

    const group = await prisma.organizationGroup.create({
      data: {
        name,
        groupType,
        year: year ? parseInt(year) : null,
        parentId: parentId ? parseInt(parentId) : null,
      },
    });

    res.status(201).json(group);
  } catch (err) {
    if (err.code === 'P2002') {
      return res.status(409).json({ error: '此組織已存在' });
    }
    next(err);
  }
});

// 新增職位
router.post('/positions', verifyToken, async (req, res, next) => {
  try {
    const { name } = req.body;

    const position = await prisma.organizationPosition.create({
      data: { name },
    });

    res.status(201).json(position);
  } catch (err) {
    next(err);
  }
});

// 指派會員職位
router.post('/roles', verifyToken, async (req, res, next) => {
  try {
    const { memberId, groupId, positionId, year } = req.body;

    const role = await prisma.memberOrganizationRole.create({
      data: {
        memberId: parseInt(memberId),
        groupId: parseInt(groupId),
        positionId: parseInt(positionId),
        year: parseInt(year),
      },
      include: {
        member: { select: { name: true, account: true } },
        group: true,
        position: true,
      },
    });

    res.status(201).json(role);
  } catch (err) {
    next(err);
  }
});

// 修改會員職位指派
router.put('/roles/:id', verifyToken, async (req, res, next) => {
  try {
    const { positionId, year } = req.body;

    const role = await prisma.memberOrganizationRole.update({
      where: { id: parseInt(req.params.id) },
      data: {
        positionId: positionId ? parseInt(positionId) : undefined,
        year: year ? parseInt(year) : undefined,
      },
      include: {
        member: { select: { name: true, account: true } },
        group: true,
        position: true,
      },
    });

    res.json(role);
  } catch (err) {
    next(err);
  }
});

// 移除會員職位
router.delete('/roles/:id', verifyToken, async (req, res, next) => {
  try {
    await prisma.memberOrganizationRole.delete({
      where: { id: parseInt(req.params.id) },
    });

    res.json({ message: '已移除' });
  } catch (err) {
    next(err);
  }
});

// ============================================
// 歷屆理監事（靜態 JSON 資料）
// ============================================

const directorsDir = path.join(__dirname, '../../data/directors');

const DIRECTORS_FILES = [
  { key: 'org1_4', label: '第一屆至第四屆' },
  { key: 'org5_8', label: '第五屆至第八屆' },
  { key: 'org9_12', label: '第九屆至第十二屆' },
  { key: 'org13_16', label: '第十三屆至第十六屆' },
  { key: 'org17_18', label: '第十七屆至第十八屆' },
];

// 取得屆別列表
router.get('/directors/terms', verifyToken, (req, res) => {
  res.json(DIRECTORS_FILES.map(f => ({ key: f.key, label: f.label })));
});

// 取得指定屆別的理監事資料
router.get('/directors/:termKey', verifyToken, (req, res) => {
  const { termKey } = req.params;
  const entry = DIRECTORS_FILES.find(f => f.key === termKey);
  if (!entry) {
    return res.status(404).json({ error: '無此屆別資料' });
  }
  try {
    const filePath = path.join(directorsDir, `${termKey}.json`);
    const raw = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(raw);
    res.json({ label: entry.label, data });
  } catch (err) {
    res.status(500).json({ error: '讀取資料失敗' });
  }
});

// ============================================
// 組織架構圖（Firebase Storage）
// ============================================

const uploadChart = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// 記憶體快取架構圖列表（重啟後從 DB 載入）
let chartCache = [];
let chartCacheLoaded = false;

async function loadChartCache() {
  if (chartCacheLoaded) return;
  try {
    // 用 Prisma 的 $queryRawUnsafe 查詢，或用一個簡單的 JSON 設定
    // 這裡用一個設定表來存架構圖 URL
    const settings = await prisma.setting?.findMany?.({ where: { key: { startsWith: 'org-chart-' } } }).catch(() => []);
    if (settings?.length) {
      chartCache = settings.map(s => JSON.parse(s.value));
    }
  } catch { /* 無 setting 表則用空 */ }
  chartCacheLoaded = true;
}

// 取得所有架構圖
router.get('/chart', verifyToken, async (req, res) => {
  await loadChartCache();
  res.json(chartCache.sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime()));
});

// 上傳架構圖
router.post('/chart', verifyToken, uploadChart.single('image'), async (req, res, next) => {
  if (!req.file) {
    return res.status(400).json({ error: '請選擇圖片' });
  }
  try {
    const filename = `org-chart-${Date.now()}`;
    const url = await firebaseStorage.uploadFile(req.file, 'org-chart', filename);

    const chartData = { filename: `${filename}${path.extname(req.file.originalname)}`, url, uploadedAt: new Date().toISOString() };
    chartCache.push(chartData);

    res.status(201).json(chartData);
  } catch (err) {
    next(err);
  }
});

// 刪除架構圖
router.delete('/chart/:filename', verifyToken, async (req, res) => {
  const idx = chartCache.findIndex(c => c.filename === req.params.filename);
  if (idx === -1) {
    return res.status(404).json({ error: '檔案不存在' });
  }

  await firebaseStorage.deleteByUrl(chartCache[idx].url);
  chartCache.splice(idx, 1);
  res.json({ message: '已刪除' });
});

module.exports = router;

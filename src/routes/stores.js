const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const prisma = require('../config/database');
const { verifyToken, requireRole } = require('../middleware/auth');

// multer 本機儲存 — uploads/stores/
const storeUploadDir = path.join(__dirname, '../../uploads/stores');
if (!fs.existsSync(storeUploadDir)) {
  fs.mkdirSync(storeUploadDir, { recursive: true });
}

const storageStores = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, storeUploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const name = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`;
    cb(null, name);
  },
});

const uploadStoreImage = multer({
  storage: storageStores,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (_req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('僅支援 jpg/png/gif/webp 格式'));
    }
  },
});

const router = express.Router();

/**
 * 地址轉經緯度（使用 Nominatim OpenStreetMap 免費 API）
 */
async function geocodeAddress(address) {
  if (!address) return null;
  try {
    const encoded = encodeURIComponent(address);
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encoded}&countrycodes=tw&limit=1`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'CICD2026-App/1.0' },
    });
    const data = await res.json();
    if (data && data.length > 0) {
      return {
        latitude: parseFloat(data[0].lat),
        longitude: parseFloat(data[0].lon),
      };
    }
    return null;
  } catch (err) {
    console.error('[Geocode] 地址轉換失敗:', err.message);
    return null;
  }
}

// 所有操作限定總管理者
router.use(verifyToken, requireRole('SUPER'));

// 上傳店家/優惠圖片（本機 uploads/stores/）
router.post('/upload-image', (req, res, next) => {
  uploadStoreImage.single('image')(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: '圖片大小不可超過 5MB' });
      }
      return res.status(400).json({ error: err.message || '上傳失敗' });
    }
    if (!req.file) {
      return res.status(400).json({ error: '請選擇圖片' });
    }
    const url = `/uploads/stores/${req.file.filename}`;
    res.json({ url });
  });
});

// 統計數據
router.get('/stats', async (req, res, next) => {
  try {
    const [totalStores, activeStores, totalProducts, activeProducts, storesWithPromo] = await Promise.all([
      prisma.store.count(),
      prisma.store.count({ where: { isActive: true } }),
      prisma.storeOffer.count(),
      prisma.storeOffer.count({ where: { isActive: true } }),
      prisma.store.count({ where: { promoDescription: { not: null } } }),
    ]);

    const inactiveStores = totalStores - activeStores;
    const avgProductsPerStore = totalStores > 0 ? (totalProducts / totalStores) : 0;
    const avgOffersPerStore = totalStores > 0 ? (storesWithPromo / totalStores) : 0;
    const storeActiveRate = totalStores > 0 ? ((activeStores / totalStores) * 100).toFixed(1) : '0.0';
    const productActiveRate = totalProducts > 0 ? ((activeProducts / totalProducts) * 100).toFixed(1) : '0.0';

    res.json({
      totalStores,
      activeStores,
      inactiveStores,
      totalProducts,
      activeProducts,
      totalOffers: storesWithPromo,
      avgProductsPerStore: parseFloat(avgProductsPerStore.toFixed(1)),
      avgOffersPerStore: parseFloat(avgOffersPerStore.toFixed(1)),
      storeActiveRate,
      productActiveRate,
    });
  } catch (err) {
    next(err);
  }
});

// 優惠店家列表（後台：支援篩選全部/啟用/停用）
router.get('/', async (req, res, next) => {
  try {
    const { search, status, page = 1, limit = 10 } = req.query;
    const skip = (page - 1) * limit;

    const where = {};
    if (status === 'active') where.isActive = true;
    else if (status === 'inactive') where.isActive = false;

    if (search) {
      where.OR = [
        { name: { contains: search } },
        { address: { contains: search } },
        { member: { name: { contains: search } } },
        { member: { account: { contains: search } } },
      ];
    }

    const [stores, total] = await Promise.all([
      prisma.store.findMany({
        where,
        skip: parseInt(skip),
        take: parseInt(limit),
        include: {
          offers: true,
          member: { select: { id: true, name: true, account: true } },
        },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
      }),
      prisma.store.count({ where }),
    ]);

    res.json({
      data: stores,
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

// 取得單一店家
router.get('/:id', async (req, res, next) => {
  try {
    const store = await prisma.store.findUnique({
      where: { id: parseInt(req.params.id) },
      include: {
        offers: { orderBy: { sortOrder: 'asc' } },
        member: { select: { id: true, name: true, account: true } },
      },
    });
    if (!store) return res.status(404).json({ error: '店家不存在' });
    res.json(store);
  } catch (err) {
    next(err);
  }
});

// 新增店家（地址自動轉經緯度）
router.post('/', async (req, res, next) => {
  try {
    const {
      memberId, name, description, address, phone, latitude, longitude, imageUrl,
      sortOrder, website, promoUrl, promoDescription, promoStartDate, promoEndDate,
      offers,
    } = req.body;

    if (!name || !memberId) {
      return res.status(400).json({ error: '店家名稱與會員為必填' });
    }

    // 若沒有提供經緯度但有地址，自動地理編碼
    let lat = latitude ? parseFloat(latitude) : null;
    let lng = longitude ? parseFloat(longitude) : null;
    if (!lat && !lng && address) {
      const geo = await geocodeAddress(address);
      if (geo) {
        lat = geo.latitude;
        lng = geo.longitude;
      }
    }

    const store = await prisma.store.create({
      data: {
        memberId: parseInt(memberId),
        name,
        description,
        address,
        phone,
        latitude: lat,
        longitude: lng,
        imageUrl,
        sortOrder: sortOrder ? parseInt(sortOrder) : 0,
        website: website || null,
        promoUrl: promoUrl || null,
        promoDescription: promoDescription || null,
        promoStartDate: promoStartDate ? new Date(promoStartDate) : null,
        promoEndDate: promoEndDate ? new Date(promoEndDate) : null,
        offers: offers ? {
          create: offers.map((o) => ({
            title: o.title,
            description: o.description,
            imageUrl: o.imageUrl,
            extraInfo: o.extraInfo,
            sortOrder: o.sortOrder ? parseInt(o.sortOrder) : 0,
            isActive: o.isActive !== undefined ? o.isActive : true,
          })),
        } : undefined,
      },
      include: { offers: true, member: { select: { name: true, account: true } } },
    });

    res.status(201).json(store);
  } catch (err) {
    next(err);
  }
});

// 修改店家（地址變更時自動重新轉經緯度）
router.put('/:id', async (req, res, next) => {
  try {
    const {
      name, description, address, phone, latitude, longitude, imageUrl, isActive,
      sortOrder, website, promoUrl, promoDescription, promoStartDate, promoEndDate,
      offers,
    } = req.body;

    const data = { name, description, address, phone, imageUrl, isActive };
    if (sortOrder !== undefined) data.sortOrder = parseInt(sortOrder);
    if (website !== undefined) data.website = website || null;
    if (promoUrl !== undefined) data.promoUrl = promoUrl || null;
    if (promoDescription !== undefined) data.promoDescription = promoDescription || null;
    if (promoStartDate !== undefined) data.promoStartDate = promoStartDate ? new Date(promoStartDate) : null;
    if (promoEndDate !== undefined) data.promoEndDate = promoEndDate ? new Date(promoEndDate) : null;
    if (latitude !== undefined) data.latitude = latitude !== null ? parseFloat(latitude) : null;
    if (longitude !== undefined) data.longitude = longitude !== null ? parseFloat(longitude) : null;

    // 若地址有更新且沒有手動提供經緯度，自動地理編碼
    if (address && latitude === undefined && longitude === undefined) {
      const existing = await prisma.store.findUnique({ where: { id: parseInt(req.params.id) } });
      if (existing && existing.address !== address) {
        const geo = await geocodeAddress(address);
        if (geo) {
          data.latitude = geo.latitude;
          data.longitude = geo.longitude;
        }
      }
    }

    // 更新優惠項目（如果有提供）
    if (offers !== undefined) {
      await prisma.storeOffer.deleteMany({ where: { storeId: parseInt(req.params.id) } });
      if (offers.length > 0) {
        await prisma.storeOffer.createMany({
          data: offers.filter(o => o.title?.trim()).map(o => ({
            storeId: parseInt(req.params.id),
            title: o.title.trim(),
            description: o.description?.trim() || null,
            imageUrl: o.imageUrl || null,
            extraInfo: o.extraInfo?.trim() || null,
            sortOrder: o.sortOrder ? parseInt(o.sortOrder) : 0,
            isActive: o.isActive !== undefined ? o.isActive : true,
          })),
        });
      }
    }

    const store = await prisma.store.update({
      where: { id: parseInt(req.params.id) },
      data,
      include: { offers: true, member: { select: { name: true, account: true } } },
    });

    res.json(store);
  } catch (err) {
    next(err);
  }
});

// 刪除店家
router.delete('/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    const store = await prisma.store.findUnique({ where: { id } });
    if (!store) return res.status(404).json({ error: '店家不存在' });

    await prisma.store.delete({ where: { id } });
    res.json({ message: '店家已刪除' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

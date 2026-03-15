const express = require('express');
const prisma = require('../config/database');
const { verifyToken, requireRole } = require('../middleware/auth');

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

// 優惠店家列表
router.get('/', async (req, res, next) => {
  try {
    const { search, district, page = 1, limit = 10 } = req.query;
    const skip = (page - 1) * limit;

    const where = { isActive: true };
    if (search) {
      where.OR = [
        { name: { contains: search } },
        { address: { contains: search } },
      ];
    }

    const [stores, total] = await Promise.all([
      prisma.store.findMany({
        where,
        skip: parseInt(skip),
        take: parseInt(limit),
        include: { offers: true },
        orderBy: { createdAt: 'desc' },
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

// 新增店家（地址自動轉經緯度）
router.post('/', async (req, res, next) => {
  try {
    const { memberId, name, description, address, phone, latitude, longitude, imageUrl, offers } = req.body;

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
        offers: offers ? {
          create: offers.map((o) => ({
            title: o.title,
            description: o.description,
            imageUrl: o.imageUrl,
            extraInfo: o.extraInfo,
          })),
        } : undefined,
      },
      include: { offers: true },
    });

    res.status(201).json(store);
  } catch (err) {
    next(err);
  }
});

// 修改店家（地址變更時自動重新轉經緯度）
router.put('/:id', async (req, res, next) => {
  try {
    const { name, description, address, phone, latitude, longitude, imageUrl, isActive, offers } = req.body;

    const data = { name, description, address, phone, imageUrl, isActive };
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
          })),
        });
      }
    }

    const store = await prisma.store.update({
      where: { id: parseInt(req.params.id) },
      data,
      include: { offers: true },
    });

    res.json(store);
  } catch (err) {
    next(err);
  }
});

module.exports = router;

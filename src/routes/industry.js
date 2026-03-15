const router = require('express').Router();
const path = require('path');
const fs = require('fs');

// 讀取靜態 JSON（啟動時載入，快取於記憶體）
const dataPath = path.join(__dirname, '../../data/industry-classification.json');
const industryData = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));

// 資料來源與版本資訊
const meta = {
  source: '行政院主計總處',
  dataName: '行業標準分類',
  revision: '第12次修正（115年1月）',
  dataUrl: 'https://www.dgbas.gov.tw/public/data/open/stat/industrial.xml',
  importedAt: '2026-03-08 11:45',
  totalEntries: 880,
  structure: {
    majorCategories: 19,  // 大類 A~S
    midCategories: 90,    // 中類（2碼）
    minorCategories: 249, // 小類（3碼）
    detailCategories: 522 // 細類（4碼）
  }
};

// 扁平化清單（供搜尋用）
const flatList = [];
function flatten(items, parentCode) {
  for (const item of items) {
    flatList.push({ code: item.code, name: item.name, parentCode });
    if (item.children) {
      flatten(item.children, item.code);
    }
  }
}
flatten(industryData, null);

// GET /api/industry — 完整階層樹（含資料來源說明）
router.get('/', (req, res) => {
  res.json({ meta, data: industryData });
});

// GET /api/industry/flat — 扁平清單（含資料來源說明）
router.get('/flat', (req, res) => {
  res.json({ meta, data: flatList });
});

// GET /api/industry/search?q=xxx — 搜尋行業名稱
router.get('/search', (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json({ meta, data: [] });
  const results = flatList.filter(item =>
    item.name.includes(q) || item.code.includes(q)
  );
  res.json({ meta, data: results.slice(0, 50) });
});

module.exports = router;

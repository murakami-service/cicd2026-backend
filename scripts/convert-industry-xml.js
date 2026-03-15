/**
 * 將 industrial.xml 轉換為階層式 JSON
 * 用法：node scripts/convert-industry-xml.js
 * 輸出：data/industry-classification.json
 */
const fs = require('fs');
const path = require('path');

const xmlPath = path.join(__dirname, '..', 'data', 'industrial.xml');
const outPath = path.join(__dirname, '..', 'data', 'industry-classification.json');

const xml = fs.readFileSync(xmlPath, 'utf-8');

// 解析所有 <Row> 中的 Code + Content
const rows = [];
const rowRegex = /<Row>\s*<Code>(.*?)<\/Code>\s*<Content>(.*?)<\/Content>\s*<\/Row>/g;
let match;
while ((match = rowRegex.exec(xml)) !== null) {
  rows.push({ code: match[1].trim(), name: match[2].trim() });
}

console.log(`共解析 ${rows.length} 筆資料`);

// 依 code 長度分層：字母=大類, 2碼=中類, 3碼=小類, 4碼=細類
const majorCategories = []; // 大類 (A-S)
const midMap = {};   // 中類 code → obj
const minorMap = {};  // 小類 code → obj
const detailMap = {}; // 細類 code → obj

for (const row of rows) {
  const len = row.code.length;
  if (len === 1) {
    // 大類
    const cat = { code: row.code, name: row.name, children: [] };
    majorCategories.push(cat);
  } else if (len === 2) {
    // 中類
    const mid = { code: row.code, name: row.name, children: [] };
    midMap[row.code] = mid;
  } else if (len === 3) {
    // 小類
    const minor = { code: row.code, name: row.name, children: [] };
    minorMap[row.code] = minor;
  } else if (len === 4) {
    // 細類
    detailMap[row.code] = { code: row.code, name: row.name };
  }
}

// 組裝：細類 → 小類
for (const [code, detail] of Object.entries(detailMap)) {
  const parentCode = code.substring(0, 3);
  if (minorMap[parentCode]) {
    minorMap[parentCode].children.push(detail);
  }
}

// 組裝：小類 → 中類
for (const [code, minor] of Object.entries(minorMap)) {
  const parentCode = code.substring(0, 2);
  if (midMap[parentCode]) {
    midMap[parentCode].children.push(minor);
  }
}

// 組裝：中類 → 大類
// 需要找出中類屬於哪個大類：按 XML 順序，中類跟在大類後面
let currentMajor = null;
for (const row of rows) {
  if (row.code.length === 1) {
    currentMajor = majorCategories.find(m => m.code === row.code);
  } else if (row.code.length === 2 && currentMajor) {
    if (midMap[row.code]) {
      currentMajor.children.push(midMap[row.code]);
    }
  }
}

// 統計
let midCount = 0, minorCount = 0, detailCount = 0;
for (const major of majorCategories) {
  midCount += major.children.length;
  for (const mid of major.children) {
    minorCount += mid.children.length;
    for (const minor of mid.children) {
      detailCount += minor.children.length;
    }
  }
}

console.log(`大類: ${majorCategories.length}`);
console.log(`中類: ${midCount}`);
console.log(`小類: ${minorCount}`);
console.log(`細類: ${detailCount}`);
console.log(`合計: ${majorCategories.length + midCount + minorCount + detailCount}`);

// 輸出 JSON
fs.writeFileSync(outPath, JSON.stringify(majorCategories, null, 2), 'utf-8');
console.log(`\n已輸出至 ${outPath}`);

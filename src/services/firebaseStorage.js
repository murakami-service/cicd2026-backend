const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

// Firebase Storage bucket name（從 Firebase Console 取得）
const BUCKET_NAME = process.env.FIREBASE_STORAGE_BUCKET || 'cicd2026-907dc.firebasestorage.app';

// 本機 fallback 上傳目錄
const LOCAL_UPLOAD_DIR = path.join(__dirname, '../../uploads');

/**
 * 取得 Firebase Storage bucket
 */
function getBucket() {
  try {
    // 先確認 Firebase 已初始化
    if (admin.apps.length === 0) return null;
    return admin.storage().bucket(BUCKET_NAME);
  } catch (err) {
    console.error('[Firebase Storage] 取得 bucket 失敗:', err.message);
    return null;
  }
}

/**
 * 本機 fallback：將檔案存到 uploads/ 目錄
 */
function saveLocal(buffer, folder, filename) {
  const dir = path.join(LOCAL_UPLOAD_DIR, folder);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const filePath = path.join(dir, filename);
  fs.writeFileSync(filePath, buffer);
  // 回傳相對 URL，前端透過 /uploads/... 存取
  return `/uploads/${folder}/${filename}`;
}

/**
 * 上傳檔案到 Firebase Storage
 * @param {Buffer} buffer - 檔案 buffer
 * @param {object} options - { folder, filename, contentType }
 * @returns {Promise<string>} - 公開 URL
 */
async function uploadBuffer(buffer, options = {}) {
  const { folder = 'uploads', filename, contentType = 'image/jpeg' } = options;
  const finalFilename = filename || `${uuidv4()}${path.extname(options.originalname || '.jpg')}`;

  const bucket = getBucket();

  // Firebase 未初始化時 fallback 到本機存儲
  if (!bucket) {
    console.warn('[Firebase Storage] 未初始化，改用本機存儲');
    return saveLocal(buffer, folder, finalFilename);
  }

  const filePath = `${folder}/${finalFilename}`;
  const file = bucket.file(filePath);

  const token = uuidv4();

  await file.save(buffer, {
    metadata: {
      contentType,
      metadata: { firebaseStorageDownloadTokens: token },
    },
  });

  // 產生公開 URL
  const url = `https://firebasestorage.googleapis.com/v0/b/${BUCKET_NAME}/o/${encodeURIComponent(filePath)}?alt=media&token=${token}`;
  return url;
}

/**
 * 上傳 multer file 到 Firebase Storage
 * @param {object} file - multer file { buffer, originalname, mimetype }
 * @param {string} folder - 存放資料夾
 * @param {string} [customName] - 自訂檔名（不含副檔名）
 * @returns {Promise<string>} - 公開 URL
 */
async function uploadFile(file, folder, customName) {
  const ext = path.extname(file.originalname) || '.jpg';
  const filename = customName ? `${customName}${ext}` : `${uuidv4()}${ext}`;

  return uploadBuffer(file.buffer, {
    folder,
    filename,
    contentType: file.mimetype || 'image/jpeg',
    originalname: file.originalname,
  });
}

/**
 * 刪除 Firebase Storage 檔案
 * @param {string} url - Firebase Storage URL
 */
async function deleteByUrl(url) {
  if (!url || !url.includes('firebasestorage.googleapis.com')) return;

  try {
    const bucket = getBucket();
    if (!bucket) return;

    // 從 URL 提取檔案路徑
    const match = url.match(/\/o\/(.+?)\?/);
    if (!match) return;

    const filePath = decodeURIComponent(match[1]);
    await bucket.file(filePath).delete();
  } catch (err) {
    // 檔案可能已不存在
    if (err.code !== 404) {
      console.error('[Firebase Storage] 刪除失敗:', err.message);
    }
  }
}

/**
 * 判斷 Firebase Storage 是否可用
 */
function isAvailable() {
  try {
    return admin.apps.length > 0 && !!admin.storage().bucket(BUCKET_NAME);
  } catch {
    return false;
  }
}

module.exports = {
  uploadBuffer,
  uploadFile,
  deleteByUrl,
  isAvailable,
};

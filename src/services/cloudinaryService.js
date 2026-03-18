const cloudinary = require('cloudinary').v2;

// 初始化 Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

/**
 * 上傳單一檔案到 Cloudinary
 * @param {Buffer} buffer - 檔案 buffer
 * @param {object} options - { folder, publicId, transformation }
 * @returns {Promise<{ url: string, publicId: string }>}
 */
async function uploadBuffer(buffer, options = {}) {
  const { folder = 'cicd2026', publicId, transformation } = options;

  return new Promise((resolve, reject) => {
    const uploadOptions = {
      folder,
      resource_type: 'image',
      quality: 'auto:good',
      fetch_format: 'auto',
    };
    if (publicId) uploadOptions.public_id = publicId;
    if (transformation) uploadOptions.transformation = transformation;

    const stream = cloudinary.uploader.upload_stream(uploadOptions, (error, result) => {
      if (error) return reject(error);
      resolve({
        url: result.secure_url,
        publicId: result.public_id,
      });
    });

    stream.end(buffer);
  });
}

/**
 * 批次上傳多個檔案到 Cloudinary（活動花絮用）
 * @param {Array<{buffer: Buffer, originalname: string}>} files - multer files
 * @param {number} eventId - 活動 ID
 * @returns {Promise<Array<{ url: string, publicId: string }>>}
 */
async function uploadHighlights(files, eventId) {
  const results = [];

  // 並行上傳，每批 10 張避免超過 API 限制
  const batchSize = 10;
  for (let i = 0; i < files.length; i += batchSize) {
    const batch = files.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map((file, idx) =>
        uploadBuffer(file.buffer, {
          folder: `cicd2026/events/${eventId}/highlights`,
          publicId: `highlight-${eventId}-${Date.now()}-${i + idx}`,
          transformation: [{ width: 1920, height: 1920, crop: 'limit' }],
        })
      )
    );
    results.push(...batchResults);
  }

  return results;
}

/**
 * 刪除 Cloudinary 上的檔案
 * @param {string} publicId - Cloudinary public ID
 */
async function deleteFile(publicId) {
  try {
    await cloudinary.uploader.destroy(publicId);
  } catch (err) {
    console.error('[Cloudinary] 刪除失敗:', err.message);
  }
}

/**
 * 從 URL 提取 public_id（用於刪除）
 * @param {string} url - Cloudinary URL
 * @returns {string|null}
 */
function extractPublicId(url) {
  if (!url || !url.includes('cloudinary.com')) return null;
  const match = url.match(/\/upload\/(?:v\d+\/)?(.+?)(?:\.\w+)?$/);
  return match ? match[1] : null;
}

function isAvailable() {
  return !!(process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY);
}

module.exports = {
  uploadBuffer,
  uploadHighlights,
  deleteFile,
  extractPublicId,
  isAvailable,
};

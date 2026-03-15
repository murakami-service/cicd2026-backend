const prisma = require('../config/database');

/**
 * 寫入審計日誌
 * @param {object} params
 * @param {string} params.action  - CREATE, UPDATE, DELETE, LOGIN, LOGOUT, EXPORT, REDEEM 等
 * @param {string} params.module  - MEMBER, BILLING, EVENT, ORGANIZATION, POINTS, PUSH, ELECTION 等
 * @param {number} [params.targetId]   - 被操作對象 ID
 * @param {string} [params.targetName] - 被操作對象名稱
 * @param {object|string} [params.detail] - 操作詳情
 * @param {number} [params.adminId]    - 管理者 ID
 * @param {string} [params.adminName]  - 管理者名稱
 * @param {number} [params.memberId]   - 會員 ID
 * @param {string} [params.ip]         - 來源 IP
 */
async function writeAuditLog(params) {
  try {
    const detail = typeof params.detail === 'object'
      ? JSON.stringify(params.detail)
      : params.detail || null;

    await prisma.auditLog.create({
      data: {
        action: params.action,
        module: params.module,
        targetId: params.targetId || null,
        targetName: params.targetName || null,
        detail,
        adminId: params.adminId || null,
        adminName: params.adminName || null,
        memberId: params.memberId || null,
        ip: params.ip || null,
      },
    });
  } catch (e) {
    // 審計日誌寫入失敗不應阻斷主流程
    console.error('[AuditLog] 寫入失敗:', e.message);
  }
}

/**
 * 從 Express req 取得操作者資訊
 */
function getAdminInfo(req) {
  const ip = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '';
  if (req.admin) {
    return { adminId: req.admin.id, adminName: req.admin.username, ip };
  }
  if (req.member) {
    return { memberId: req.member.id, adminName: req.member.name, ip };
  }
  return { ip };
}

module.exports = { writeAuditLog, getAdminInfo };

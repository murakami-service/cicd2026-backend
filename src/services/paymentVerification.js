const prisma = require('../config/database');

/**
 * 繳費資格驗證 Service
 * 核心商業邏輯層，供活動報名、APP 權限判斷共用
 */

/**
 * 檢查會員是否為終生會員（已繳入會費）
 */
async function isLifetimeMember(memberId) {
  // 會員存在即為終生會員（入會 = 帳號建立，Member 無 joinDate 欄位，改用 isActive 判斷）
  const member = await prisma.member.findUnique({
    where: { id: memberId },
    select: { isActive: true },
  });
  return !!member?.isActive;
}

/**
 * 檢查會員是否已繳指定層級的有效會費
 * @param {number} memberId - 會員 ID
 * @param {string} targetType - 繳費對象類型 (GENERAL/DISTRICT/TERM/SPECIAL/CY)
 * @param {object} options - 額外條件
 * @param {number} options.districtId - 地區 ID（DISTRICT/SPECIAL 時需要）
 * @param {number} options.termNumber - 期別（TERM 時需要）
 * @returns {{ hasPaid: boolean, batch: object|null }}
 */
async function checkPaymentStatus(memberId, targetType, options = {}) {
  const now = new Date();

  // 找有效的繳費批次
  const batchWhere = {
    targetType,
    status: 'ACTIVE',
    endDate: { gte: now },
  };

  if (targetType === 'DISTRICT' || targetType === 'SPECIAL') {
    batchWhere.districtId = options.districtId;
  }
  if (targetType === 'TERM') {
    batchWhere.termNumber = options.termNumber;
  }
  if (targetType === 'CY') {
    batchWhere.memberType = 'CY';
  }

  const batch = await prisma.billingBatch.findFirst({
    where: batchWhere,
    orderBy: { createdAt: 'desc' },
  });

  // 沒有有效繳費批次 = 無繳費門檻
  if (!batch) {
    return { hasPaid: true, noBatch: true, batch: null };
  }

  // 檢查會員是否已繳
  const bill = await prisma.bill.findFirst({
    where: {
      batchId: batch.id,
      memberId,
      status: { in: ['PAID', 'MANUAL'] },
    },
  });

  return { hasPaid: !!bill, noBatch: false, batch };
}

/**
 * 檢查跨區繳費資格
 * @param {number} memberId - 會員 ID
 * @param {number} targetDistrictId - 目標地區 ID
 * @returns {boolean}
 */
async function hasCrossDistrictPayment(memberId, targetDistrictId) {
  const now = new Date();

  const bill = await prisma.bill.findFirst({
    where: {
      memberId,
      isCrossDistrict: true,
      targetDistrictId,
      status: { in: ['PAID', 'MANUAL'] },
      batch: {
        status: 'ACTIVE',
        endDate: { gte: now },
      },
    },
  });

  return !!bill;
}

/**
 * 檢查會員是否有總會有效繳費（APP 進階功能權限判斷）
 */
async function hasGeneralPayment(memberId) {
  const result = await checkPaymentStatus(memberId, 'GENERAL');
  return result.hasPaid;
}

/**
 * 活動報名資格驗證
 * @param {number} memberId - 會員 ID
 * @param {number} eventId - 活動 ID
 * @returns {{ eligible: boolean, reason: string|null }}
 */
async function verifyEventEligibility(memberId, eventId) {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: {
      id: true,
      title: true,
      targetType: true,
      districtId: true,
      termNumber: true,
      requirePayment: true,
      isFreeOpen: true,
      allowCrossDistrict: true,
      maxParticipants: true,
      registrationDeadline: true,
      status: true,
      _count: { select: { registrations: true } },
    },
  });

  if (!event) {
    return { eligible: false, reason: '活動不存在' };
  }

  // 檢查活動狀態
  if (event.status !== 'OPEN') {
    return { eligible: false, reason: '活動目前不開放報名' };
  }

  // 檢查報名截止
  if (event.registrationDeadline && new Date() > event.registrationDeadline) {
    return { eligible: false, reason: '已超過報名截止時間' };
  }

  // 檢查人數上限
  if (event.maxParticipants && event._count.registrations >= event.maxParticipants) {
    return { eligible: false, reason: '報名人數已額滿' };
  }

  // 檢查是否已報名
  const existingReg = await prisma.eventRegistration.findUnique({
    where: { eventId_memberId: { eventId, memberId } },
  });
  if (existingReg && existingReg.status === 'REGISTERED') {
    return { eligible: false, reason: '您已報名此活動' };
  }

  // 取得會員資料
  const member = await prisma.member.findUnique({
    where: { id: memberId },
    select: { memberType: true, districtId: true, termNumber: true, isActive: true },
  });

  if (!member) {
    return { eligible: false, reason: '會員不存在' };
  }

  // 免費開放活動 → 直接通過
  if (event.isFreeOpen) {
    return { eligible: true, reason: null };
  }

  // === 依活動對象類型做資格判斷 ===

  // 總會活動：入會即終生會員，都可參加
  if (event.targetType === 'GENERAL') {
    if (!member.isActive) {
      return { eligible: false, reason: '您的帳號已停用，無法參加總會活動' };
    }
    // 總會活動不需要繳費也可參加（終生會員），但需繳費才有投票權（另外判斷）
    return { eligible: true, reason: null };
  }

  // 建青團活動：只有建青團會員可參加
  if (event.targetType === 'CY') {
    if (member.memberType !== 'CY') {
      return { eligible: false, reason: '此活動僅限建青團會員參加' };
    }
    if (event.requirePayment) {
      const result = await checkPaymentStatus(memberId, 'CY');
      if (!result.hasPaid) {
        return { eligible: false, reason: '請先繳交建青團會費' };
      }
    }
    return { eligible: true, reason: null };
  }

  // 地區活動
  if (event.targetType === 'DISTRICT') {
    const isLocalMember = member.districtId === event.districtId;

    if (isLocalMember) {
      // 本區會員
      if (event.requirePayment) {
        const result = await checkPaymentStatus(memberId, 'DISTRICT', { districtId: event.districtId });
        if (!result.hasPaid) {
          return { eligible: false, reason: '請先繳交本區會費' };
        }
      }
      return { eligible: true, reason: null };
    }

    // 非本區會員 — 檢查是否允許跨區
    if (!event.allowCrossDistrict) {
      return { eligible: false, reason: '此活動不開放跨區報名' };
    }

    // 跨區需繳該區會費
    if (event.requirePayment) {
      const hasCrossPaid = await hasCrossDistrictPayment(memberId, event.districtId);
      if (!hasCrossPaid) {
        return { eligible: false, reason: '請先繳交該地區會費才能跨區報名' };
      }
    }

    return { eligible: true, reason: null };
  }

  // 期別活動
  if (event.targetType === 'TERM') {
    if (member.termNumber !== event.termNumber) {
      return { eligible: false, reason: '此活動僅限該期別會員參加' };
    }

    if (event.requirePayment) {
      const result = await checkPaymentStatus(memberId, 'TERM', { termNumber: event.termNumber });
      // noBatch = 該期沒有發行繳費單 = 無門檻
      if (!result.hasPaid && !result.noBatch) {
        return { eligible: false, reason: '請先繳交期別會費' };
      }
    }

    return { eligible: true, reason: null };
  }

  // 特別區活動
  if (event.targetType === 'SPECIAL') {
    // 檢查會員是否屬於該特別區
    const isMember = await prisma.memberSpecialDistrict.findUnique({
      where: {
        memberId_districtId: {
          memberId,
          districtId: event.districtId,
        },
      },
    });

    if (!isMember) {
      return { eligible: false, reason: '此活動僅限該特別區會員參加' };
    }

    if (event.requirePayment) {
      const result = await checkPaymentStatus(memberId, 'SPECIAL', { districtId: event.districtId });
      if (!result.hasPaid && !result.noBatch) {
        return { eligible: false, reason: '請先繳交特別區會費' };
      }
    }

    return { eligible: true, reason: null };
  }

  return { eligible: false, reason: '無法判斷活動資格' };
}

module.exports = {
  isLifetimeMember,
  checkPaymentStatus,
  hasCrossDistrictPayment,
  hasGeneralPayment,
  verifyEventEligibility,
};

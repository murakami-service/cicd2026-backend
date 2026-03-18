const express = require('express');
const prisma = require('../config/database');
const { verifyToken, scopeByAdmin } = require('../middleware/auth');
const { writeAuditLog, getAdminInfo } = require('../services/auditLog');

const router = express.Router();

// ============================================
// 會費年度計算工具
// 規則：9/30 前繳算當年度，10/1 起算新年度
// ============================================
function getCurrentFiscalYear() {
  const now = new Date();
  const month = now.getMonth() + 1; // 1-12
  const year = now.getFullYear();
  return month >= 10 ? year + 1 : year;
}

/**
 * 檢查會員是否已繳當期總會年費
 * @param {number} memberId
 * @returns {Promise<boolean>}
 */
async function hasPaidCurrentFee(memberId) {
  const fiscalYear = getCurrentFiscalYear();

  // 查詢總會（GENERAL）年費（ANNUAL）的批次，標題包含年度
  // 例如 title 含 "2026" 的總會年費
  const paidBill = await prisma.bill.findFirst({
    where: {
      memberId,
      status: 'PAID',
      batch: {
        billingType: 'ANNUAL',
        targetType: 'GENERAL',
        title: { contains: String(fiscalYear) },
      },
    },
  });

  return !!paidBill;
}

// ============================================
// 選舉管理 CRUD（後台）
// ============================================

// 列表（分頁+篩選）
router.get('/', verifyToken, scopeByAdmin, async (req, res, next) => {
  try {
    const { page = 1, limit = 10, status, search } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where = {};
    if (status) where.status = status;
    if (search) {
      where.title = { contains: search, mode: 'insensitive' };
    }

    const [elections, total] = await Promise.all([
      prisma.election.findMany({
        where,
        include: {
          _count: { select: { candidates: true, votes: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: parseInt(limit),
      }),
      prisma.election.count({ where }),
    ]);

    res.json({
      data: elections,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (err) {
    next(err);
  }
});

// 單筆詳情（含候選人+投票統計）
router.get('/:id', verifyToken, scopeByAdmin, async (req, res, next) => {
  try {
    const election = await prisma.election.findUnique({
      where: { id: parseInt(req.params.id) },
      include: {
        candidates: {
          include: {
            member: { select: { id: true, name: true, account: true, avatar: true } },
            _count: { select: { votes: true } },
          },
          orderBy: { number: 'asc' },
        },
        _count: { select: { votes: true } },
      },
    });

    if (!election) {
      return res.status(404).json({ error: '找不到此選舉' });
    }

    // 計算已投票人數（distinct memberId）
    const voterCountResult = await prisma.vote.findMany({
      where: { electionId: election.id },
      select: { memberId: true },
      distinct: ['memberId'],
    });

    res.json({ ...election, voterCount: voterCountResult.length });
  } catch (err) {
    next(err);
  }
});

// 建立選舉
router.post('/', verifyToken, scopeByAdmin, async (req, res, next) => {
  try {
    const { title, description, type, maxVotes, startTime, endTime, targetType, targetId, requirePayment, isAnonymous } = req.body;

    if (!title || !startTime || !endTime) {
      return res.status(400).json({ error: '標題、開始時間、結束時間為必填' });
    }

    const election = await prisma.election.create({
      data: {
        title,
        description: description || null,
        type: type || 'SINGLE',
        maxVotes: parseInt(maxVotes) || 1,
        startTime: new Date(startTime),
        endTime: new Date(endTime),
        targetType: targetType || 'ALL',
        targetId: targetId ? parseInt(targetId) : null,
        requirePayment: requirePayment !== false,
        isAnonymous: isAnonymous === true,
      },
    });

    const info = getAdminInfo(req);
    await writeAuditLog({ action: 'CREATE', module: 'ELECTION', targetId: election.id, targetName: title, ...info });

    res.status(201).json(election);
  } catch (err) {
    next(err);
  }
});

// 更新選舉
router.put('/:id', verifyToken, scopeByAdmin, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    const { title, description, type, maxVotes, startTime, endTime, targetType, targetId, requirePayment, isAnonymous, status } = req.body;

    const existing = await prisma.election.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: '找不到此選舉' });

    const data = {};
    if (title !== undefined) data.title = title;
    if (description !== undefined) data.description = description;
    if (type !== undefined) data.type = type;
    if (maxVotes !== undefined) data.maxVotes = parseInt(maxVotes);
    if (startTime !== undefined) data.startTime = new Date(startTime);
    if (endTime !== undefined) data.endTime = new Date(endTime);
    if (targetType !== undefined) data.targetType = targetType;
    if (targetId !== undefined) data.targetId = targetId ? parseInt(targetId) : null;
    if (requirePayment !== undefined) data.requirePayment = requirePayment;
    if (isAnonymous !== undefined) data.isAnonymous = isAnonymous;
    if (status !== undefined) data.status = status;

    const election = await prisma.election.update({ where: { id }, data });

    const info = getAdminInfo(req);
    await writeAuditLog({ action: 'UPDATE', module: 'ELECTION', targetId: id, targetName: election.title, detail: data, ...info });

    res.json(election);
  } catch (err) {
    next(err);
  }
});

// 刪除選舉（含候選人+票數一併刪除，onDelete: Cascade）
router.delete('/:id', verifyToken, scopeByAdmin, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    const existing = await prisma.election.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: '找不到此選舉' });

    if (existing.status === 'OPEN') {
      return res.status(400).json({ error: '投票進行中不可刪除，請先關閉投票' });
    }

    await prisma.election.delete({ where: { id } });

    const info = getAdminInfo(req);
    await writeAuditLog({ action: 'DELETE', module: 'ELECTION', targetId: id, targetName: existing.title, ...info });

    res.json({ message: '已刪除' });
  } catch (err) {
    next(err);
  }
});

// ============================================
// 候選人管理
// ============================================

// 新增候選人
router.post('/:id/candidates', verifyToken, scopeByAdmin, async (req, res, next) => {
  try {
    const electionId = parseInt(req.params.id);
    const { name, number, memberId, bio, photo } = req.body;

    if (!name) return res.status(400).json({ error: '候選人姓名為必填' });

    const candidate = await prisma.candidate.create({
      data: {
        electionId,
        name,
        number: parseInt(number) || 0,
        memberId: memberId ? parseInt(memberId) : null,
        bio: bio || null,
        photo: photo || null,
      },
      include: {
        member: { select: { id: true, name: true, account: true, avatar: true } },
      },
    });

    res.status(201).json(candidate);
  } catch (err) {
    next(err);
  }
});

// 更新候選人
router.put('/:id/candidates/:candidateId', verifyToken, scopeByAdmin, async (req, res, next) => {
  try {
    const candidateId = parseInt(req.params.candidateId);
    const { name, number, memberId, bio, photo } = req.body;

    const data = {};
    if (name !== undefined) data.name = name;
    if (number !== undefined) data.number = parseInt(number);
    if (memberId !== undefined) data.memberId = memberId ? parseInt(memberId) : null;
    if (bio !== undefined) data.bio = bio;
    if (photo !== undefined) data.photo = photo;

    const candidate = await prisma.candidate.update({
      where: { id: candidateId },
      data,
      include: {
        member: { select: { id: true, name: true, account: true, avatar: true } },
      },
    });

    res.json(candidate);
  } catch (err) {
    next(err);
  }
});

// 刪除候選人
router.delete('/:id/candidates/:candidateId', verifyToken, scopeByAdmin, async (req, res, next) => {
  try {
    const candidateId = parseInt(req.params.candidateId);
    await prisma.candidate.delete({ where: { id: candidateId } });
    res.json({ message: '已刪除候選人' });
  } catch (err) {
    next(err);
  }
});

// ============================================
// 投票結果統計 + 投票會員名單
// ============================================

// 匯出投票紀錄（匿名時隱藏投票者資訊）
router.get('/:id/votes', verifyToken, scopeByAdmin, async (req, res, next) => {
  try {
    const electionId = parseInt(req.params.id);
    const election = await prisma.election.findUnique({ where: { id: electionId } });
    if (!election) return res.status(404).json({ error: '找不到此選舉' });

    const votes = await prisma.vote.findMany({
      where: { electionId },
      include: {
        member: { select: { id: true, name: true, account: true } },
        candidate: { select: { id: true, name: true, number: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    // 匿名投票時移除投票者與候選人的關聯（只留統計數字）
    if (election.isAnonymous) {
      const anonymized = votes.map(v => ({
        id: v.id,
        electionId: v.electionId,
        candidateId: v.candidateId,
        candidate: v.candidate,
        createdAt: v.createdAt,
        // 不回傳 member 資訊
      }));
      return res.json({ data: anonymized, total: votes.length, isAnonymous: true });
    }

    res.json({ data: votes, total: votes.length, isAnonymous: false });
  } catch (err) {
    next(err);
  }
});

// 已投票會員名單（不論匿名與否，後台可查看「誰投了票」但匿名時不知道投了誰）
router.get('/:id/voters', verifyToken, scopeByAdmin, async (req, res, next) => {
  try {
    const electionId = parseInt(req.params.id);
    const election = await prisma.election.findUnique({ where: { id: electionId } });
    if (!election) return res.status(404).json({ error: '找不到此選舉' });

    // 取得所有投過票的 distinct memberId
    const voterGroups = await prisma.vote.groupBy({
      by: ['memberId'],
      where: { electionId },
      _count: { id: true },
    });

    const memberIds = voterGroups.map(v => v.memberId);

    const members = await prisma.member.findMany({
      where: { id: { in: memberIds } },
      select: { id: true, name: true, account: true, avatar: true, districtId: true },
    });

    // 合併投票數
    const voters = members.map(m => {
      const group = voterGroups.find(v => v.memberId === m.id);
      return { ...m, voteCount: group?._count?.id || 0 };
    });

    res.json({ data: voters, total: voters.length, isAnonymous: election.isAnonymous });
  } catch (err) {
    next(err);
  }
});

// 投票資格查詢（檢查特定會員是否可投票）
router.get('/:id/eligibility/:memberId', verifyToken, scopeByAdmin, async (req, res, next) => {
  try {
    const electionId = parseInt(req.params.id);
    const memberId = parseInt(req.params.memberId);

    const election = await prisma.election.findUnique({ where: { id: electionId } });
    if (!election) return res.status(404).json({ error: '找不到此選舉' });

    const eligible = election.requirePayment ? await hasPaidCurrentFee(memberId) : true;

    const hasVoted = await prisma.vote.findFirst({
      where: { electionId, memberId },
    });

    res.json({
      eligible,
      hasVoted: !!hasVoted,
      fiscalYear: getCurrentFiscalYear(),
      requirePayment: election.requirePayment,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

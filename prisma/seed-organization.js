/**
 * 組織架構 Seed — 建立兩層組織結構
 *
 * 第一層（parentId=null）：
 *   本屆理事長(HEAD) / 本屆監事會(HEAD) / 總會幹部(HEAD)
 *   四區聯誼會(REGIONAL) / 各期別聯誼會(TERM) / 工作委員會(COMMITTEE) / 建青團(CY) / 地方聯誼會(LOCAL)
 *
 * 第二層：
 *   四區聯誼會 → 北區/中區/南區/東區
 *   各期別聯誼會 → 第1期 ~ 第42期
 *   工作委員會 → 10 個委員會
 *   建青團 → 建青總團 + 建青1期 ~ 建青11期
 *   地方聯誼會 → 大港湖聯誼會 / 新三五聯誼會 / 桃竹聯誼會
 *
 * 執行方式：node prisma/seed-organization.js
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('=== 組織架構 Seed 開始 ===\n');

  // Helper: upsert group
  async function upsertGroup(name, groupType, parentId = null) {
    const existing = await prisma.organizationGroup.findFirst({
      where: { name, groupType },
    });
    if (existing) {
      // 確保 parentId 正確
      if (existing.parentId !== parentId) {
        await prisma.organizationGroup.update({
          where: { id: existing.id },
          data: { parentId },
        });
      }
      return existing;
    }
    return prisma.organizationGroup.create({
      data: { name, groupType, parentId },
    });
  }

  // =============================================
  // 第一層 — 葉節點（本屆理事長 / 本屆監事會 / 總會幹部）
  // =============================================
  const chairman = await upsertGroup('本屆理事長', 'HEAD');
  console.log(`✓ 本屆理事長 (id=${chairman.id})`);

  const supervisor = await upsertGroup('本屆監事會', 'HEAD');
  console.log(`✓ 本屆監事會 (id=${supervisor.id})`);

  const staff = await upsertGroup('總會幹部', 'HEAD');
  console.log(`✓ 總會幹部 (id=${staff.id})`);

  // =============================================
  // 第一層 — 父節點
  // =============================================

  // 四區聯誼會
  const regional = await upsertGroup('四區聯誼會', 'REGIONAL');
  console.log(`✓ 四區聯誼會 (id=${regional.id})`);

  for (const name of ['北區聯誼會', '中區聯誼會', '南區聯誼會', '東區聯誼會']) {
    const child = await upsertGroup(name, 'REGIONAL', regional.id);
    console.log(`  → ${name} (id=${child.id})`);
  }

  // 各期別聯誼會
  const term = await upsertGroup('各期別聯誼會', 'TERM');
  console.log(`✓ 各期別聯誼會 (id=${term.id})`);

  for (let i = 1; i <= 42; i++) {
    const name = `第${i}期`;
    const child = await upsertGroup(name, 'TERM', term.id);
    if (i <= 3 || i >= 40) console.log(`  → ${name} (id=${child.id})`);
    if (i === 3) console.log('  → ... (略)');
  }

  // 工作委員會
  const committee = await upsertGroup('工作委員會', 'COMMITTEE');
  console.log(`✓ 工作委員會 (id=${committee.id})`);

  const committees = [
    '醫療生技委員會',
    '青年文創委員會',
    '傳產與內政民生委員會',
    '兩岸與國際交流委員會',
    '循環經濟與ESG委員會',
    '金融發展委員會',
    '建築不動產委員會',
    '電商物流委員會',
    '運動休閒委員會',
    '智慧AI科技委員會',
  ];
  for (const name of committees) {
    const child = await upsertGroup(name, 'COMMITTEE', committee.id);
    console.log(`  → ${name} (id=${child.id})`);
  }

  // 建青團
  const cy = await upsertGroup('建青團', 'CY');
  console.log(`✓ 建青團 (id=${cy.id})`);

  const cyTotal = await upsertGroup('建青總團', 'CY', cy.id);
  console.log(`  → 建青總團 (id=${cyTotal.id})`);
  for (let i = 1; i <= 11; i++) {
    const name = `建青${i}期`;
    const child = await upsertGroup(name, 'CY', cy.id);
    console.log(`  → ${name} (id=${child.id})`);
  }

  // 地方聯誼會
  const local = await upsertGroup('地方聯誼會', 'LOCAL');
  console.log(`✓ 地方聯誼會 (id=${local.id})`);

  for (const name of ['大港湖聯誼會', '新三五聯誼會', '桃竹聯誼會']) {
    const child = await upsertGroup(name, 'LOCAL', local.id);
    console.log(`  → ${name} (id=${child.id})`);
  }

  // =============================================
  // 清理：如果之前有 "本屆理事會" (舊名)，改名為 "本屆理事長"
  // =============================================
  const oldChairman = await prisma.organizationGroup.findFirst({
    where: { name: '本屆理事會', groupType: 'HEAD' },
  });
  if (oldChairman && oldChairman.id !== chairman.id) {
    // 把舊的 roles 搬到新的
    await prisma.memberOrganizationRole.updateMany({
      where: { groupId: oldChairman.id },
      data: { groupId: chairman.id },
    });
    await prisma.organizationGroup.delete({ where: { id: oldChairman.id } });
    console.log(`\n⚠ 已將 "本屆理事會" 的成員轉移至 "本屆理事長" 並刪除舊 group`);
  }

  // 如果 "大港湖聯誼會" 之前是頂層(parentId=null)，需要把它移到 地方聯誼會 下面
  const oldDaganghu = await prisma.organizationGroup.findFirst({
    where: { name: '大港湖聯誼會', parentId: null },
  });
  if (oldDaganghu) {
    await prisma.organizationGroup.update({
      where: { id: oldDaganghu.id },
      data: { parentId: local.id },
    });
    console.log(`⚠ 已將 "大港湖聯誼會" 移至 "地方聯誼會" 子層`);
  }

  console.log('\n=== 組織架構 Seed 完成 ===');
}

main()
  .catch((e) => {
    console.error('Seed error:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

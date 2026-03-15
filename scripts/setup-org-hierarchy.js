/**
 * 設定組織架構層級（建立父層組織並關聯子組織）
 *
 * 結構：
 * - 本屆理事會 (HEAD, 頂層)
 * - 地區聯誼會 (REGIONAL, 頂層) → 北區/中區/南區/東區 (children)
 * - 各期聯誼會 (TERM, 頂層) → 第1~42期 (children)
 * - 工作委員會 (COMMITTEE, 頂層) → 10個委員會 (children)
 * - 建青團 (CY, 頂層) → 第1~11期 (children)
 * - 大港湖聯誼會 (LOCAL, 頂層)
 * - 新三五聯誼會 (LOCAL, 頂層)
 * - 桃竹聯誼會 (LOCAL, 頂層)
 * - 組織沿革 / 組織架構圖 / 歷屆理監事 → 由前端靜態處理
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('開始設定組織架構層級...\n');

  // 1. 建立「本屆理事會」頂層 (HEAD)
  const head = await prisma.organizationGroup.upsert({
    where: { name_groupType: { name: '本屆理事會', groupType: 'HEAD' } },
    update: {},
    create: { name: '本屆理事會', groupType: 'HEAD' },
  });
  console.log(`✓ 本屆理事會 (id=${head.id})`);

  // 2. 建立「地區聯誼會」頂層 (REGIONAL) → 設定北中南東為子層
  const regional = await prisma.organizationGroup.upsert({
    where: { name_groupType: { name: '地區聯誼會', groupType: 'REGIONAL' } },
    update: {},
    create: { name: '地區聯誼會', groupType: 'REGIONAL' },
  });
  console.log(`✓ 地區聯誼會 (id=${regional.id})`);

  const regionalChildren = ['北區聯誼會', '中區聯誼會', '南區聯誼會', '東區聯誼會'];
  for (const name of regionalChildren) {
    await prisma.organizationGroup.updateMany({
      where: { name, groupType: 'REGIONAL', parentId: null },
      data: { parentId: regional.id },
    });
  }
  console.log(`  → 設定 ${regionalChildren.length} 個子組織`);

  // 3. 建立「各期聯誼會」頂層 (TERM) → 設定1~42期為子層
  const term = await prisma.organizationGroup.upsert({
    where: { name_groupType: { name: '各期聯誼會', groupType: 'TERM' } },
    update: {},
    create: { name: '各期聯誼會', groupType: 'TERM' },
  });
  console.log(`✓ 各期聯誼會 (id=${term.id})`);

  const termResult = await prisma.organizationGroup.updateMany({
    where: {
      groupType: 'TERM',
      id: { not: term.id },
      parentId: null,
    },
    data: { parentId: term.id },
  });
  console.log(`  → 設定 ${termResult.count} 個子組織`);

  // 4. 建立「工作委員會」頂層 (COMMITTEE) → 設定10個委員會為子層
  const committee = await prisma.organizationGroup.upsert({
    where: { name_groupType: { name: '工作委員會', groupType: 'COMMITTEE' } },
    update: {},
    create: { name: '工作委員會', groupType: 'COMMITTEE' },
  });
  console.log(`✓ 工作委員會 (id=${committee.id})`);

  const committeeResult = await prisma.organizationGroup.updateMany({
    where: {
      groupType: 'COMMITTEE',
      id: { not: committee.id },
      parentId: null,
    },
    data: { parentId: committee.id },
  });
  console.log(`  → 設定 ${committeeResult.count} 個子組織`);

  // 5. 建立「建青團」頂層 (CY) → 設定1~11期為子層
  const cy = await prisma.organizationGroup.upsert({
    where: { name_groupType: { name: '建青團', groupType: 'CY' } },
    update: {},
    create: { name: '建青團', groupType: 'CY' },
  });
  console.log(`✓ 建青團 (id=${cy.id})`);

  const cyResult = await prisma.organizationGroup.updateMany({
    where: {
      groupType: 'CY',
      id: { not: cy.id },
      parentId: null,
    },
    data: { parentId: cy.id },
  });
  console.log(`  → 設定 ${cyResult.count} 個子組織`);

  // 6. LOCAL 組織保持頂層（大港湖/新三五/桃竹）
  console.log(`✓ 地方聯誼會保持頂層`);

  // 驗證結果
  const topLevel = await prisma.organizationGroup.findMany({
    where: { parentId: null },
    include: { _count: { select: { children: true } } },
    orderBy: { name: 'asc' },
  });

  console.log('\n===== 頂層組織列表 =====');
  for (const g of topLevel) {
    const childInfo = g._count.children > 0 ? ` (${g._count.children} 個子組織)` : '';
    console.log(`  ${g.name} [${g.groupType}]${childInfo}`);
  }
  console.log(`\n共 ${topLevel.length} 個頂層組織`);
}

main()
  .catch((e) => {
    console.error('錯誤:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

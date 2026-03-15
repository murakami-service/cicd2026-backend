/**
 * 修正資料庫中編碼錯誤的資料
 * 用法：node scripts/fix-encoding.js
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('開始修正亂碼資料...\n');

  // 修正 Event id=1
  const event1 = await prisma.event.findUnique({ where: { id: 1 } });
  if (event1 && event1.title.includes('�')) {
    await prisma.event.update({
      where: { id: 1 },
      data: {
        title: '2026 總會大會',
        location: '台北國際會議中心',
      },
    });
    console.log('✓ Event #1 修正完成：2026 總會大會');
  }

  // 修正 BillingBatch id=1
  const batch1 = await prisma.billingBatch.findUnique({ where: { id: 1 } });
  if (batch1 && batch1.title.includes('�')) {
    await prisma.billingBatch.update({
      where: { id: 1 },
      data: { title: '2026 總會年費' },
    });
    console.log('✓ BillingBatch #1 修正完成：2026 總會年費');
  }

  // 修正 Member id=1 (account=41086)
  const member1 = await prisma.member.findUnique({ where: { id: 1 } });
  if (member1 && member1.name.includes('�')) {
    await prisma.member.update({
      where: { id: 1 },
      data: { name: '測試會員' },
    });
    console.log('✓ Member #1 修正完成：測試會員');
  }

  // 掃描其他可能有亂碼的資料
  const allMembers = await prisma.member.findMany({ select: { id: true, name: true, account: true } });
  const corruptMembers = allMembers.filter(m => m.name.includes('�'));
  if (corruptMembers.length > 0) {
    console.log(`\n⚠ 發現 ${corruptMembers.length} 筆其他亂碼會員：`);
    corruptMembers.forEach(m => console.log(`  - ID ${m.id}, Account ${m.account}, Name: ${m.name}`));
  }

  const allEvents = await prisma.event.findMany({ select: { id: true, title: true } });
  const corruptEvents = allEvents.filter(e => e.title.includes('�'));
  if (corruptEvents.length > 0) {
    console.log(`\n⚠ 發現 ${corruptEvents.length} 筆其他亂碼活動：`);
    corruptEvents.forEach(e => console.log(`  - ID ${e.id}, Title: ${e.title}`));
  }

  const allBatches = await prisma.billingBatch.findMany({ select: { id: true, title: true } });
  const corruptBatches = allBatches.filter(b => b.title.includes('�'));
  if (corruptBatches.length > 0) {
    console.log(`\n⚠ 發現 ${corruptBatches.length} 筆其他亂碼繳費批次：`);
    corruptBatches.forEach(b => console.log(`  - ID ${b.id}, Title: ${b.title}`));
  }

  console.log('\n修正完成');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());

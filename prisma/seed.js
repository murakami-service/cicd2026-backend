const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
  // 建立地區
  const districts = [
    { name: '北區', type: 'REGIONAL' },
    { name: '中區', type: 'REGIONAL' },
    { name: '南區', type: 'REGIONAL' },
    { name: '東區', type: 'REGIONAL' },
  ];

  for (const d of districts) {
    await prisma.district.upsert({
      where: { name: d.name },
      update: {},
      create: d,
    });
  }
  console.log('地區資料建立完成');

  // 建立特別區（地方聯誼會）
  const specialDistricts = [
    { name: '大港湖', type: 'SPECIAL' },
    { name: '新三五', type: 'SPECIAL' },
    { name: '桃竹', type: 'SPECIAL' },
  ];

  for (const d of specialDistricts) {
    await prisma.district.upsert({
      where: { name: d.name },
      update: {},
      create: d,
    });
  }
  console.log('特別區資料建立完成');

  // 建立超級管理員
  const hashedPassword = await bcrypt.hash('admin123', 10);
  await prisma.admin.upsert({
    where: { username: 'admin' },
    update: {},
    create: {
      username: 'admin',
      password: hashedPassword,
      name: '超級管理員',
      role: 'SUPER',
    },
  });
  console.log('超級管理員建立完成 (admin / admin123)');

  // 建立組織架構
  const orgGroups = [
    // 四區聯誼會
    { name: '北區聯誼會', groupType: 'REGIONAL' },
    { name: '中區聯誼會', groupType: 'REGIONAL' },
    { name: '南區聯誼會', groupType: 'REGIONAL' },
    { name: '東區聯誼會', groupType: 'REGIONAL' },
    // 各期別聯誼會（1~42期）
    ...Array.from({ length: 42 }, (_, i) => ({
      name: `第${i + 1}期聯誼會`,
      groupType: 'TERM',
    })),
    // 工作委員會（10個）
    { name: '傳產與內政民生委員會', groupType: 'COMMITTEE' },
    { name: '兩岸與國際交流委員會', groupType: 'COMMITTEE' },
    { name: '青年文創委員會', groupType: 'COMMITTEE' },
    { name: '醫療生技委員會', groupType: 'COMMITTEE' },
    { name: '循環經濟與ESG委員會', groupType: 'COMMITTEE' },
    { name: '金融發展委員會', groupType: 'COMMITTEE' },
    { name: '建築不動產委員會', groupType: 'COMMITTEE' },
    { name: '電商物流委員會', groupType: 'COMMITTEE' },
    { name: '運動休閒委員會', groupType: 'COMMITTEE' },
    { name: '智慧AI科技委員會', groupType: 'COMMITTEE' },
    // 建青團（1~11期）
    ...Array.from({ length: 11 }, (_, i) => ({
      name: `建青團第${i + 1}期`,
      groupType: 'CY',
    })),
    // 地方聯誼會/特別區
    { name: '大港湖聯誼會', groupType: 'LOCAL' },
    { name: '新三五聯誼會', groupType: 'LOCAL' },
    { name: '桃竹聯誼會', groupType: 'LOCAL' },
  ];

  for (const g of orgGroups) {
    await prisma.organizationGroup.upsert({
      where: { name_groupType: { name: g.name, groupType: g.groupType } },
      update: {},
      create: g,
    });
  }
  console.log(`組織架構建立完成（共 ${orgGroups.length} 個組織）`);

  // 建立測試會員帳號（APP 登入用）
  const northDistrict = await prisma.district.findFirst({ where: { name: '北區' } });
  const memberPassword = await bcrypt.hash('test1234', 10);
  await prisma.member.upsert({
    where: { account: '41001' },
    update: {},
    create: {
      account: '41001',
      password: memberPassword,
      name: '測試會員',
      email: 'test@example.com',
      phone: '0912345678',
      company: '測試公司',
      jobTitle: '總經理',
      memberType: 'GENERAL',
      termNumber: 41,
      studentNumber: 1,
      districtId: northDistrict?.id || null,
      isActive: true,
    },
  });
  console.log('測試會員建立完成 (41001 / test1234)');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

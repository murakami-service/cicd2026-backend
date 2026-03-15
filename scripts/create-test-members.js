/**
 * 建立 5 筆測試會員資料（含完整公司/個人欄位）
 * 用法：node scripts/create-test-members.js
 */
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');

const prisma = new PrismaClient();

async function main() {
  // 取得地區 ID
  const districts = await prisma.district.findMany({ where: { type: 'REGIONAL' } });
  const districtMap = {};
  districts.forEach(d => { districtMap[d.name] = d.id; });

  const members = [
    {
      account: '41001',
      name: '王大明',
      gender: '男',
      phone: '0912345678',
      email: 'wang.dm@example.com',
      memberType: 'GENERAL',
      termNumber: 41,
      studentNumber: 1,
      districtId: districtMap['北區'],
      birthday: new Date(1975, 5, 15),
      // 公司資料
      industry: 'S-智慧AI科技',
      brand: 'DM Tech',
      jobTitle: '董事長',
      company: '大明科技股份有限公司',
      businessItems: 'AI 解決方案、企業數位轉型顧問、雲端系統開發',
      website: 'https://www.dmtech.com.tw',
      contactPerson: '李秘書',
      contactPhone: '02-27001234',
      // 個人資料
      introduction: '深耕 AI 產業 20 年，致力推動台灣中小企業數位轉型，曾獲國家創新獎。',
      education: '國立台灣大學 資訊工程研究所 碩士',
      experience: '前台積電 AI 研發部經理（2005-2015）\n前 Google 台灣 技術顧問（2015-2018）',
      currentPosition: '大明科技股份有限公司 董事長',
    },
    {
      account: '41002',
      name: '林美玲',
      gender: '女',
      phone: '0923456789',
      email: 'lin.ml@example.com',
      memberType: 'GENERAL',
      termNumber: 41,
      studentNumber: 2,
      districtId: districtMap['中區'],
      birthday: new Date(1980, 2, 22),
      industry: 'G-建築不動產',
      brand: '美玲建設',
      jobTitle: '總經理',
      company: '美玲建設有限公司',
      businessItems: '住宅建設、商辦規劃、都市更新、室內設計',
      website: 'https://www.mlconstruction.com.tw',
      contactPerson: '張助理',
      contactPhone: '04-23456789',
      introduction: '專注綠建築與永續住宅設計，累積完成超過 30 個建案，獲得多項綠建築標章認證。',
      education: '國立成功大學 建築研究所 碩士',
      experience: '前遠雄建設 設計部副理（2005-2012）\n前潤泰建設 專案經理（2012-2016）',
      currentPosition: '美玲建設有限公司 總經理',
    },
    {
      account: '40015',
      name: '陳志豪',
      gender: '男',
      phone: '0934567890',
      email: 'chen.zh@example.com',
      memberType: 'GENERAL',
      termNumber: 40,
      studentNumber: 15,
      districtId: districtMap['南區'],
      birthday: new Date(1978, 10, 8),
      industry: 'F-兩岸與國際交流',
      brand: 'GlobalLink',
      jobTitle: '執行長',
      company: '志豪國際貿易有限公司',
      businessItems: '兩岸貿易代理、跨境電商、國際物流、進出口報關',
      website: 'https://www.globallink-trade.com',
      contactPerson: '王經理',
      contactPhone: '07-34567890',
      introduction: '專營兩岸貿易及東南亞市場拓展，年營業額超過 3 億元，服務超過 200 家企業客戶。',
      education: '國立政治大學 國際貿易學系 學士',
      experience: '前統一企業 國際事業部（2002-2008）\n前長榮國際 業務經理（2008-2014）',
      currentPosition: '志豪國際貿易有限公司 執行長',
    },
    {
      account: '39028',
      name: '張雅婷',
      gender: '女',
      phone: '0945678901',
      email: 'chang.yt@example.com',
      memberType: 'GENERAL',
      termNumber: 39,
      studentNumber: 28,
      districtId: districtMap['東區'],
      birthday: new Date(1982, 7, 30),
      industry: 'D-醫療生技',
      brand: 'YT BioTech',
      jobTitle: '研發總監',
      company: '雅婷生技股份有限公司',
      businessItems: '新藥研發、保健食品、醫療器材代理、臨床試驗服務',
      website: 'https://www.ytbiotech.com.tw',
      contactPerson: '陳研究員',
      contactPhone: '03-45678901',
      introduction: '擁有 15 年生技產業經驗，帶領團隊成功開發 3 項專利新藥，目前專注精準醫療領域。',
      education: '國立陽明大學 生物醫學研究所 博士',
      experience: '前中研院 生醫所 博士後研究員（2010-2014）\n前國衛院 研究員（2014-2018）',
      currentPosition: '雅婷生技股份有限公司 研發總監',
    },
    {
      account: 'CY0501',
      name: '黃建宏',
      gender: '男',
      phone: '0956789012',
      email: 'huang.jh@example.com',
      memberType: 'CY',
      termNumber: 5,
      studentNumber: 1,
      districtId: districtMap['北區'],
      birthday: new Date(1995, 0, 12),
      industry: 'C-青年文創',
      brand: 'JH Studio',
      jobTitle: '創辦人',
      company: '建宏文創工作室',
      businessItems: '品牌設計、社群行銷、短影音製作、活動策展',
      website: 'https://www.jhstudio.tw',
      contactPerson: '黃建宏',
      contactPhone: '0956789012',
      introduction: '90 後新銳創業家，專注品牌設計與社群行銷，曾操刀多個知名品牌年度行銷案。',
      education: '實踐大學 工業產品設計學系 學士',
      experience: '前奧美廣告 設計師（2017-2019）\n前 LINE 台灣 行銷企劃（2019-2021）',
      currentPosition: '建宏文創工作室 創辦人',
    },
  ];

  console.log('開始建立/更新 5 筆測試會員...\n');

  for (const m of members) {
    // 密碼 = 民國年(3碼) + 月(2碼) + 日(2碼)
    const rocYear = String(m.birthday.getFullYear() - 1911).padStart(3, '0');
    const month = String(m.birthday.getMonth() + 1).padStart(2, '0');
    const day = String(m.birthday.getDate()).padStart(2, '0');
    const defaultPassword = `${rocYear}${month}${day}`;
    const hashedPassword = await bcrypt.hash(defaultPassword, 10);

    const existing = await prisma.member.findFirst({ where: { account: m.account } });
    if (existing) {
      // 更新現有會員的所有欄位
      const { account, ...updateData } = m;
      await prisma.member.update({
        where: { id: existing.id },
        data: updateData,
      });
      console.log(`✓ ${m.account} ${m.name} 已更新（補齊公司/個人資料）`);
    } else {
      await prisma.member.create({
        data: {
          ...m,
          password: hashedPassword,
          isActive: true,
        },
      });
      console.log(`✓ ${m.account} ${m.name} 新建完成（密碼: ${defaultPassword}）`);
    }
  }

  console.log('\n建立完成');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());

const prisma = require('../src/config/database');

(async () => {
  // ============ 1. 新聞 20 筆 ============
  const newsData = [
    { title: '2026年度會員大會圓滿落幕', category: 'ANNOUNCE', content: '<p>本會2026年度會員大會於3月8日假台北國際會議中心盛大舉行，出席會員超過500人。大會中通過年度工作報告、財務報告及新年度工作計畫。理事長致詞時表示，將持續推動產業升級與國際交流，為會員創造更多商機與合作機會。</p>' },
    { title: '第46期聯誼會成立大會', category: 'EVENT', content: '<p>第46期聯誼會成立大會將於4月15日舉行，歡迎新進會員踴躍參加。大會將進行幹部選舉、期別介紹及聯誼餐會，是認識同期夥伴的最佳機會。報名截止日期為4月10日。</p>' },
    { title: '台灣半導體產業趨勢分析', category: 'INDUSTRY', content: '<p>根據工研院最新報告，2026年台灣半導體產業產值預估將突破5兆新台幣。AI晶片需求持續攀升，帶動先進製程與封裝技術蓬勃發展。本會將於下月舉辦產業論壇，邀請業界領袖分享最新趨勢。</p>' },
    { title: '北區聯誼會春季高爾夫球聯誼賽', category: 'EVENT', content: '<p>北區聯誼會將於4月20日舉辦春季高爾夫球聯誼賽，地點為林口球場。歡迎各區會員組隊報名，費用含果嶺費、球車及午餐。前三名隊伍將獲得精美獎品。</p>' },
    { title: '會費繳納公告：2026年度常年會費', category: 'ANNOUNCE', content: '<p>2026年度常年會費已開始收取，請會員於6月30日前完成繳納。本年度會費維持不變：一般會員新台幣12,000元，建青團員新台幣6,000元。可透過銀行轉帳、線上支付或臨櫃繳納。</p>' },
    { title: 'ESG永續發展論壇即將登場', category: 'EVENT', content: '<p>循環經濟與ESG委員會將於5月10日舉辦「企業ESG永續發展論壇」，邀請金管會代表、上市公司永續長及國際顧問公司專家，探討碳盤查、永續報告書及綠色金融等議題。</p>' },
    { title: '兩岸經貿交流團出訪上海', category: 'ANNOUNCE', content: '<p>兩岸與國際交流委員會預計於6月組團前往上海，參訪當地台商企業及科技園區。行程包括與上海台商協會座談、參觀張江高科技園區及浦東新區。有意參加者請於5月15日前報名。</p>' },
    { title: '智慧製造與AI應用研討會', category: 'INDUSTRY', content: '<p>智慧AI科技委員會舉辦的「智慧製造與AI應用研討會」已於上周圓滿結束。會中展示了多項AI在製造業的應用案例，包括智慧品管、預測維護及供應鏈優化，獲得與會者高度評價。</p>' },
    { title: '南區聯誼會年度旅遊活動', category: 'EVENT', content: '<p>南區聯誼會規劃於5月下旬舉辦澎湖三日遊，行程包含花火節觀賞、海上牧場體驗及在地美食之旅。費用預估每人15,000元（含機票住宿），名額限40人。</p>' },
    { title: '新進會員入會說明會', category: 'ANNOUNCE', content: '<p>為協助新進會員快速融入本會，秘書處將於每月第一個週三舉辦入會說明會。內容包括：組織介紹、會員權益說明、APP使用教學及各委員會簡介。歡迎2026年新入會會員參加。</p>' },
    { title: '建青團創業交流分享會', category: 'EVENT', content: '<p>建青團將於4月底舉辦「青年創業交流分享會」，邀請三位成功創業的建青團學長姊分享創業歷程。主題涵蓋科技新創、餐飲連鎖及文創品牌，現場開放Q&A互動。</p>' },
    { title: '台灣綠能產業發展現況', category: 'INDUSTRY', content: '<p>隨著2050淨零碳排目標推進，台灣綠能產業加速發展。離岸風電第三階段區塊開發持續推進，太陽光電裝置容量已突破12GW。本會多位會員企業積極投入綠能轉型，成效斐然。</p>' },
    { title: '中區聯誼會企業參訪活動', category: 'EVENT', content: '<p>中區聯誼會將於4月25日參訪台中精密機械園區，行程包括參觀上銀科技、台中精機等知名企業。藉由實地參訪了解產業最新發展，促進會員間商業合作機會。</p>' },
    { title: '會員專屬優惠店家新增公告', category: 'ANNOUNCE', content: '<p>本會優惠特約店家再添20家，涵蓋全台北中南東各地餐飲、住宿及休閒場所。會員出示會員APP即可享有專屬折扣優惠。詳細店家資訊請至APP「優惠店家」專區查詢。</p>' },
    { title: '金融科技趨勢與數位轉型', category: 'INDUSTRY', content: '<p>金融發展委員會發布最新研究報告指出，台灣金融科技投資在2025年成長35%。純網銀用戶突破800萬，行動支付滲透率達75%。報告建議中小企業加速導入數位金融工具以提升營運效率。</p>' },
    { title: '東區聯誼會花蓮文化之旅', category: 'EVENT', content: '<p>東區聯誼會將於5月中旬舉辦花蓮二日文化之旅，行程包含太魯閣步道健行、原住民文化園區參訪及七星潭海岸漫步。歡迎各區會員一同參加，體驗花東之美。</p>' },
    { title: '本會榮獲社團評鑑特優獎', category: 'ANNOUNCE', content: '<p>本會於內政部2025年度全國性社會團體評鑑中榮獲特優獎，肯定本會在會務推動、會員服務及社會公益等方面的優異表現。理事長感謝全體會員及工作團隊的共同努力。</p>' },
    { title: '建築不動產市場Q1報告', category: 'INDUSTRY', content: '<p>建築不動產委員會發布2026年第一季市場報告。全台建照核發量較去年同期增加8%，以桃園、台中及高雄增幅最為顯著。商用不動產方面，工業地產及物流倉儲需求持續強勁。</p>' },
    { title: '運動休閒委員會馬拉松接力賽', category: 'EVENT', content: '<p>運動休閒委員會將於6月1日舉辦會員馬拉松接力賽，地點為台北大佳河濱公園。每隊4人，接力完成全馬42.195公里。歡迎會員攜眷組隊參加，完賽者均可獲得紀念獎牌。</p>' },
    { title: '電商物流委員會跨境電商講座', category: 'INDUSTRY', content: '<p>電商物流委員會舉辦「跨境電商實戰講座」，邀請成功經營東南亞市場的會員企業分享經驗。內容涵蓋平台選擇、物流方案、金流整合及在地化行銷策略。</p>' },
  ];

  console.log('=== 新增 20 筆新聞 ===');
  for (const n of newsData) {
    const news = await prisma.news.create({ data: n });
    console.log(`  #${news.id} ${news.category} ${news.title}`);
  }

  // ============ 2. 活動：北中南東各2筆 ============
  const now = new Date();
  const districtEvents = [
    // 北區 (districtId: 1)
    { title: '北區企業CEO早餐會', districtId: 1, targetType: 'DISTRICT', location: '台北君悅酒店', address: '台北市信義區松壽路2號', description: '每月一次的CEO早餐會，本月主題：2026年投資展望與風險管理。邀請知名經濟學者分析國際情勢，並開放與會者交流討論。', startTime: new Date('2026-04-05T07:30:00'), endTime: new Date('2026-04-05T09:30:00'), maxParticipants: 50, status: 'OPEN', points: 10 },
    { title: '北區家族企業傳承論壇', districtId: 1, targetType: 'DISTRICT', location: '台北國際會議中心', address: '台北市信義區信義路五段1號', description: '探討家族企業傳承的挑戰與策略，邀請成功完成接班的二代企業家分享經驗。', startTime: new Date('2026-04-18T13:30:00'), endTime: new Date('2026-04-18T17:00:00'), maxParticipants: 100, status: 'OPEN', points: 15 },
    // 中區 (districtId: 2)
    { title: '中區精密機械產業參訪', districtId: 2, targetType: 'DISTRICT', location: '台中精密機械園區', address: '台中市南屯區精科路', description: '參訪台中精密機械園區內多家知名企業，了解智慧製造最新發展。含午餐及交通接駁。', startTime: new Date('2026-04-12T08:30:00'), endTime: new Date('2026-04-12T16:00:00'), maxParticipants: 40, status: 'OPEN', points: 20 },
    { title: '中區會員聯誼晚宴', districtId: 2, targetType: 'DISTRICT', location: '台中林酒店', address: '台中市西屯區朝富路99號', description: '中區年度聯誼晚宴，席開30桌。現場安排抽獎活動，大獎為日本五日遊雙人行程。', startTime: new Date('2026-05-03T18:00:00'), endTime: new Date('2026-05-03T21:30:00'), maxParticipants: 300, status: 'OPEN', points: 10 },
    // 南區 (districtId: 3)
    { title: '南區台南古蹟文化巡禮', districtId: 3, targetType: 'DISTRICT', location: '台南赤崁樓', address: '台南市中西區民族路二段212號', description: '南區文化之旅，走訪赤崁樓、安平古堡、奇美博物館等景點，品嚐道地台南美食。', startTime: new Date('2026-04-26T09:00:00'), endTime: new Date('2026-04-26T17:00:00'), maxParticipants: 60, status: 'OPEN', points: 15 },
    { title: '南區高雄港灣企業參訪', districtId: 3, targetType: 'DISTRICT', location: '高雄展覽館', address: '高雄市前鎮區成功二路39號', description: '參訪高雄港灣區重大建設及進駐企業，了解南台灣產業發展新契機。', startTime: new Date('2026-05-10T09:00:00'), endTime: new Date('2026-05-10T16:00:00'), maxParticipants: 50, status: 'DRAFT', points: 20 },
    // 東區 (districtId: 4)
    { title: '東區宜蘭休閒農業體驗', districtId: 4, targetType: 'DISTRICT', location: '宜蘭頭城農場', address: '宜蘭縣頭城鎮更新路125號', description: '東區會員攜眷一日遊，體驗農場生活、DIY手作及在地料理。含午餐及下午茶。', startTime: new Date('2026-04-19T09:00:00'), endTime: new Date('2026-04-19T16:00:00'), maxParticipants: 80, status: 'OPEN', points: 10 },
    { title: '東區花東原民文化深度之旅', districtId: 4, targetType: 'DISTRICT', location: '花蓮文化創意園區', address: '花蓮縣花蓮市中華路144號', description: '二日遊行程，深入了解花東原住民文化與產業。參訪部落、體驗傳統工藝、品嚐原民料理。', startTime: new Date('2026-05-17T08:00:00'), endTime: new Date('2026-05-18T17:00:00'), maxParticipants: 40, status: 'DRAFT', points: 25 },
  ];

  console.log('\n=== 新增 8 筆地區活動（北中南東各2筆）===');
  for (const e of districtEvents) {
    const evt = await prisma.event.create({ data: e });
    console.log(`  #${evt.id} [${evt.targetType}] ${evt.title}`);
  }

  // ============ 3. 建青團活動 5 筆 ============
  const cyEvents = [
    { title: '建青團新創企業參訪日', targetType: 'CY', location: '台北內湖科技園區', address: '台北市內湖區瑞光路', description: '參訪三家新創獨角獸企業，了解AI、區塊鏈及生技產業最新趨勢。含午餐便當及交通接駁。', startTime: new Date('2026-04-08T09:00:00'), endTime: new Date('2026-04-08T17:00:00'), maxParticipants: 30, status: 'OPEN', points: 20 },
    { title: '建青團領導力培訓營', targetType: 'CY', location: '陽明山中國麗緻飯店', address: '台北市士林區格致路237號', description: '兩天一夜領導力培訓營，課程包含團隊建設、溝通技巧、策略思維及個案討論。', startTime: new Date('2026-04-22T13:00:00'), endTime: new Date('2026-04-23T12:00:00'), maxParticipants: 40, status: 'OPEN', points: 30 },
    { title: '建青團公益淨灘活動', targetType: 'CY', location: '新北市萬里海灘', address: '新北市萬里區', description: '響應環保愛地球，建青團號召會員及眷屬一同參與淨灘活動。完成後安排BBQ聯誼。', startTime: new Date('2026-05-04T08:00:00'), endTime: new Date('2026-05-04T14:00:00'), maxParticipants: 60, status: 'OPEN', points: 15, isFreeOpen: true },
    { title: '建青團數位行銷實戰工作坊', targetType: 'CY', location: '台北市青創基地', address: '台北市中正區濟南路一段', description: '邀請數位行銷專家授課，內容涵蓋社群經營、短影音製作、SEO優化及廣告投放。實際操作練習。', startTime: new Date('2026-05-15T14:00:00'), endTime: new Date('2026-05-15T17:30:00'), maxParticipants: 35, status: 'DRAFT', points: 15 },
    { title: '建青團年度高峰會', targetType: 'CY', location: '台北W飯店', address: '台北市信義區忠孝東路五段10號', description: '建青團年度盛會，回顧年度成果、表揚優秀團員、新舊任幹部交接及晚宴。', startTime: new Date('2026-06-14T17:00:00'), endTime: new Date('2026-06-14T21:30:00'), maxParticipants: 200, status: 'DRAFT', points: 10 },
  ];

  console.log('\n=== 新增 5 筆建青團活動 ===');
  for (const e of cyEvents) {
    const evt = await prisma.event.create({ data: e });
    console.log(`  #${evt.id} [CY] ${evt.title}`);
  }

  // ============ 4. 第46期聯誼會活動 5 筆 ============
  const term46Events = [
    { title: '第46期迎新聯誼餐會', targetType: 'TERM', termNumber: 46, location: '台北晶華酒店', address: '台北市中山區中山北路二段39巷3號', description: '歡迎第46期新進會員加入！迎新餐會將介紹本期幹部團隊、會務運作方式，並安排破冰遊戲增進彼此認識。', startTime: new Date('2026-04-10T18:00:00'), endTime: new Date('2026-04-10T21:00:00'), maxParticipants: 80, status: 'OPEN', points: 10 },
    { title: '第46期企業參訪：台積電創新館', targetType: 'TERM', termNumber: 46, location: '台積電創新館', address: '新竹市東區力行二路1號', description: '參訪全球半導體龍頭台積電創新館，了解晶片製程與科技應用。名額有限，請盡早報名。', startTime: new Date('2026-04-28T09:30:00'), endTime: new Date('2026-04-28T15:00:00'), maxParticipants: 30, status: 'OPEN', points: 20 },
    { title: '第46期高爾夫球敘', targetType: 'TERM', termNumber: 46, location: '桃園大溪球場', address: '桃園市大溪區', description: '46期專屬高爾夫球敘，新手老手皆歡迎。球敘後安排晚餐聯誼，增進同期情誼。', startTime: new Date('2026-05-08T06:30:00'), endTime: new Date('2026-05-08T15:00:00'), maxParticipants: 40, status: 'OPEN', points: 10 },
    { title: '第46期家庭日親子活動', targetType: 'TERM', termNumber: 46, location: '台北市兒童新樂園', address: '台北市士林區承德路五段55號', description: '46期會員攜眷家庭日！園區包場半日，含遊樂設施無限搭乘、親子DIY及野餐午會。', startTime: new Date('2026-05-24T10:00:00'), endTime: new Date('2026-05-24T16:00:00'), maxParticipants: 120, isFreeOpen: true, status: 'DRAFT', points: 10 },
    { title: '第46期日本九州商務考察團', targetType: 'TERM', termNumber: 46, location: '日本福岡', address: '日本福岡縣福岡市', description: '為期五天四夜的九州商務考察，參訪福岡新創基地、熊本半導體聚落及大分溫泉度假村。含商務會議及文化體驗。', startTime: new Date('2026-06-20T08:00:00'), endTime: new Date('2026-06-24T18:00:00'), maxParticipants: 25, requirePayment: true, status: 'DRAFT', points: 30 },
  ];

  console.log('\n=== 新增 5 筆第46期聯誼會活動 ===');
  for (const e of term46Events) {
    const evt = await prisma.event.create({ data: e });
    console.log(`  #${evt.id} [TERM-46] ${evt.title}`);
  }

  // Final counts
  const totalNews = await prisma.news.count();
  const totalEvents = await prisma.event.count();
  console.log(`\n✅ 完成！新聞共 ${totalNews} 筆，活動共 ${totalEvents} 筆`);

  await prisma.$disconnect();
})();

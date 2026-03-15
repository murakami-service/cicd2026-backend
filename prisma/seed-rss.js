const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const RSS_SOURCES = [
  // 國際
  { name: 'CNN Business', url: 'http://rss.cnn.com/rss/money_latest.rss', region: 'INTERNATIONAL', category: '綜合商業' },
  { name: 'Wall Street Journal', url: 'https://feeds.a.dj.com/rss/RSSMarketsMain.xml', region: 'INTERNATIONAL', category: '金融市場' },
  { name: 'NHK World Business', url: 'https://www3.nhk.or.jp/rss/news/cat5.xml', region: 'INTERNATIONAL', category: '日本經濟' },
  { name: 'Reuters Business', url: 'https://www.reutersagency.com/feed/?best-topics=business-finance', region: 'INTERNATIONAL', category: '全球財經' },
  { name: 'Bloomberg', url: 'https://feeds.bloomberg.com/markets/news.rss', region: 'INTERNATIONAL', category: '全球市場' },
  { name: 'TechCrunch', url: 'https://techcrunch.com/feed/', region: 'INTERNATIONAL', category: '科技趨勢' },
  // 國內
  { name: '經濟日報', url: 'https://money.udn.com/rssfeed/news/1001/5591/6645', region: 'DOMESTIC', category: '產經' },
  { name: '工商時報', url: 'https://ctee.com.tw/feed', region: 'DOMESTIC', category: '工商' },
  { name: '科技新報', url: 'https://technews.tw/feed/', region: 'DOMESTIC', category: '科技' },
];

async function main() {
  console.log('開始寫入 RSS 來源...');
  for (const src of RSS_SOURCES) {
    const existing = await prisma.rssSource.findFirst({ where: { name: src.name } });
    if (existing) {
      console.log(`  已存在: ${src.name}`);
      continue;
    }
    await prisma.rssSource.create({ data: src });
    console.log(`  新增: ${src.name}`);
  }
  console.log('RSS 來源寫入完成！');
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());

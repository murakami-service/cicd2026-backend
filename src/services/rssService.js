const RssParser = require('rss-parser');
const prisma = require('../config/database');

const parser = new RssParser({
  timeout: 15000,
  headers: { 'User-Agent': 'CICD2026-NewsBot/1.0' },
});

/**
 * 抓取所有啟用的 RSS 來源，存入 RssArticle
 * @returns {{ fetched: number, errors: string[] }}
 */
async function fetchAllRssSources() {
  const sources = await prisma.rssSource.findMany({ where: { isActive: true } });
  let fetched = 0;
  const errors = [];

  for (const source of sources) {
    try {
      const feed = await parser.parseURL(source.url);
      const items = (feed.items || []).slice(0, 20); // 每次最多抓 20 篇

      for (const item of items) {
        if (!item.link) continue;
        try {
          await prisma.rssArticle.upsert({
            where: { url: item.link },
            update: {}, // 已存在就跳過
            create: {
              sourceId: source.id,
              title: (item.title || '').slice(0, 500),
              content: (item.contentSnippet || item.content || '').slice(0, 5000),
              url: item.link,
              publishedAt: item.pubDate ? new Date(item.pubDate) : new Date(),
            },
          });
          fetched++;
        } catch (e) {
          // unique constraint = 已存在，忽略
          if (!e.code || e.code !== 'P2002') {
            errors.push(`[${source.name}] article error: ${e.message}`);
          }
        }
      }
    } catch (e) {
      errors.push(`[${source.name}] fetch error: ${e.message}`);
    }
  }

  return { fetched, errors };
}

/**
 * 取得最近 N 小時內、指定 region 的文章
 */
async function getRecentArticles(region, hours = 48) {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);
  return prisma.rssArticle.findMany({
    where: {
      source: { region, isActive: true },
      publishedAt: { gte: since },
    },
    include: { source: { select: { name: true, region: true } } },
    orderBy: { publishedAt: 'desc' },
    take: 50,
  });
}

/**
 * 清除超過 N 天的文章
 */
async function cleanOldArticles(days = 30) {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const result = await prisma.rssArticle.deleteMany({
    where: { publishedAt: { lt: cutoff } },
  });
  return result.count;
}

module.exports = { fetchAllRssSources, getRecentArticles, cleanOldArticles };

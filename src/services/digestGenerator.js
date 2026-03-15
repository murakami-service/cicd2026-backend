const Anthropic = require('@anthropic-ai/sdk');
const crypto = require('crypto');
const prisma = require('../config/database');
const { getRecentArticles } = require('./rssService');

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

/**
 * 產生 comboKey：根據 interests + industries + perspective 排序後 hash
 */
function buildComboKey(interests, industries, perspective) {
  const sorted = {
    interests: [...interests].sort(),
    industries: [...industries].sort(),
    perspective,
  };
  const raw = JSON.stringify(sorted);
  return crypto.createHash('md5').update(raw).digest('hex').slice(0, 16);
}

/**
 * 取得今天所有需要生成摘要的偏好組合
 */
async function getActivePreferenceCombos() {
  const prefs = await prisma.memberPreference.findMany({
    where: {
      interests: { not: null },
      industries: { not: null },
      perspective: { not: null },
    },
  });

  const combos = new Map();
  for (const p of prefs) {
    try {
      const interests = JSON.parse(p.interests);
      const industries = JSON.parse(p.industries);
      if (!interests.length || !industries.length || !p.perspective) continue;

      const key = buildComboKey(interests, industries, p.perspective);
      if (!combos.has(key)) {
        combos.set(key, { comboKey: key, interests, industries, perspective: p.perspective });
      }
    } catch {
      // 格式錯誤跳過
    }
  }
  return Array.from(combos.values());
}

/**
 * 用 Claude 生成一篇摘要
 */
async function generateDigestWithAI(articles, combo, region) {
  const regionLabel = region === 'INTERNATIONAL' ? '國際' : '國內';
  const articleTexts = articles
    .slice(0, 15) // 最多送 15 篇給 AI
    .map((a, i) => {
      const pubDate = a.publishedAt ? new Date(a.publishedAt).toLocaleDateString('zh-TW', { timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' }) : '';
      return `[${i + 1}] ${a.source.name}（${pubDate}）— ${a.title}\n${(a.content || '').slice(0, 800)}`;
    })
    .join('\n\n');

  const today = new Date().toLocaleDateString('zh-TW', { timeZone: 'Asia/Taipei', year: 'numeric', month: 'long', day: 'numeric' });
  const prompt = `你是一位專業的商業新聞分析師。請根據以下${regionLabel}新聞，針對特定讀者撰寫一篇「${today}」的中文新聞摘要。

讀者偏好：
- 關注主題：${combo.interests.join('、')}
- 關注產業：${combo.industries.join('、')}
- 閱讀角度：${combo.perspective}

${regionLabel === '國際' ? '注意：原文可能是英文，請翻譯並以中文撰寫。' : ''}

要求：
1. 標題：一行精煉標題（15-25字），須與今日最新動態相關，避免與前幾天的標題雷同
2. 摘要：300-500字，以「${combo.perspective}」的角度分析
3. 優先選取最新發布的新聞，盡量涵蓋今日新出現的事件或發展
4. 結尾加上一句實用建議或觀察

新聞素材：
${articleTexts}

請以以下 JSON 格式回覆（不要加 markdown 標記）：
{"title": "標題", "summary": "摘要內容", "sourceUrls": ["引用的原文URL"]}`;

  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content[0].text.trim();
  // 嘗試解析 JSON
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('AI 回覆格式錯誤');

  return JSON.parse(jsonMatch[0]);
}

/**
 * 取得近期已使用過的文章標題（用來排除重複素材）
 */
async function getUsedArticleTitles(comboKey, region, lookbackDays = 3) {
  const since = new Date();
  since.setDate(since.getDate() - lookbackDays);

  const recentDigests = await prisma.aiDigest.findMany({
    where: { comboKey, region, publishDate: { gte: since } },
    select: { sourceUrls: true },
  });

  const usedTitles = new Set();
  for (const d of recentDigests) {
    try {
      const urls = JSON.parse(d.sourceUrls || '[]');
      for (const u of urls) usedTitles.add(u);
    } catch { /* ignore */ }
  }
  return usedTitles;
}

/**
 * 為一個偏好組合生成國際+國內兩篇摘要
 */
async function generateDigestsForCombo(combo) {
  // 沒有 API Key 則跳過生成
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn('[DigestGenerator] ANTHROPIC_API_KEY 未設定，跳過生成');
    return [{ region: 'INTERNATIONAL', status: 'no_api_key' }, { region: 'DOMESTIC', status: 'no_api_key' }];
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const results = [];

  for (const region of ['INTERNATIONAL', 'DOMESTIC']) {
    // 檢查今天是否已生成
    const existing = await prisma.aiDigest.findFirst({
      where: {
        comboKey: combo.comboKey,
        region,
        publishDate: { gte: today },
      },
    });
    if (existing) {
      results.push({ region, status: 'skipped', id: existing.id });
      continue;
    }

    // 取近期文章（24 小時優先，不足則擴展到 48 小時）
    let articles = await getRecentArticles(region, 24);
    if (articles.length < 5) {
      articles = await getRecentArticles(region, 48);
    }
    if (articles.length === 0) {
      results.push({ region, status: 'no_articles' });
      continue;
    }

    // 排除近期已用過的文章，優先使用新素材
    const usedTitles = await getUsedArticleTitles(combo.comboKey, region);
    const freshArticles = articles.filter(a => !usedTitles.has(a.title) && !usedTitles.has(a.url));
    // 如果新文章足夠就只用新的，不足則補入舊文章
    const finalArticles = freshArticles.length >= 5
      ? freshArticles
      : [...freshArticles, ...articles.filter(a => !freshArticles.includes(a))].slice(0, 50);

    try {
      const aiResult = await generateDigestWithAI(finalArticles, combo, region);

      const digest = await prisma.aiDigest.create({
        data: {
          comboKey: combo.comboKey,
          region,
          interests: JSON.stringify(combo.interests),
          industries: JSON.stringify(combo.industries),
          perspective: combo.perspective,
          title: aiResult.title,
          summary: aiResult.summary,
          sourceUrls: JSON.stringify(aiResult.sourceUrls || []),
          publishDate: new Date(),
        },
      });

      results.push({ region, status: 'created', id: digest.id });
    } catch (e) {
      results.push({ region, status: 'error', message: e.message });
    }
  }

  return results;
}

/**
 * 主排程：為所有偏好組合生成今日摘要
 */
async function runDailyDigestGeneration() {
  console.log('[DigestGenerator] 開始每日摘要生成...');
  const combos = await getActivePreferenceCombos();
  console.log(`[DigestGenerator] 共 ${combos.length} 組偏好組合`);

  const allResults = [];
  for (const combo of combos) {
    const result = await generateDigestsForCombo(combo);
    allResults.push({ combo: combo.comboKey, result });
    // 每組之間間隔 1 秒避免 API rate limit
    await new Promise(r => setTimeout(r, 1000));
  }

  console.log('[DigestGenerator] 每日摘要生成完成');
  return allResults;
}

/**
 * 清除超過 N 天的摘要
 */
async function cleanOldDigests(days = 30) {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const result = await prisma.aiDigest.deleteMany({
    where: { publishDate: { lt: cutoff } },
  });
  return result.count;
}

module.exports = {
  buildComboKey,
  getActivePreferenceCombos,
  generateDigestsForCombo,
  runDailyDigestGeneration,
  cleanOldDigests,
};

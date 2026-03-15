/**
 * CICD2026 健康檢查腳本
 * 用法：node scripts/healthcheck.js
 *
 * 自動模擬核心流程，回報 PASS/FAIL
 */

const http = require('http');

const BASE = 'http://localhost:3001';
let adminToken = '';
let memberToken = '';
let testMemberId = null;
let testBatchId = null;
let testBillId = null;
let testEventId = null;
const results = [];
const testAccount = `_test_${Date.now()}`;

function request(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    if (token) options.headers['Authorization'] = `Bearer ${token}`;

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function test(name, fn) {
  try {
    const result = await fn();
    if (result.pass) {
      results.push({ name, status: 'PASS' });
      console.log(`  ✓ ${name}`);
    } else {
      results.push({ name, status: 'FAIL', reason: result.reason });
      console.log(`  ✗ ${name} — ${result.reason}`);
    }
  } catch (err) {
    results.push({ name, status: 'ERROR', reason: err.message });
    console.log(`  ✗ ${name} — ERROR: ${err.message}`);
  }
}

async function cleanup() {
  // 清除測試資料（反向順序）
  if (testEventId) {
    await request('PUT', `/api/events/${testEventId}/status`, { status: 'CANCELLED' }, adminToken);
  }
  if (testBillId) {
    await request('PUT', `/api/billing/bills/${testBillId}/void`, {}, adminToken);
  }
  if (testMemberId) {
    // 軟刪除測試會員
    await request('PUT', `/api/members/${testMemberId}`, { isActive: false }, adminToken);
  }
}

async function run() {
  console.log('\n========================================');
  console.log('  CICD2026 Health Check');
  console.log(`  ${new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })}`);
  console.log('========================================\n');

  // === 基礎連線 ===
  console.log('[基礎連線]');

  await test('API Health Check', async () => {
    const res = await request('GET', '/api/health');
    return { pass: res.status === 200 && res.body.status === 'ok', reason: `status=${res.status}` };
  });

  // === 管理者認證 ===
  console.log('\n[管理者認證]');

  await test('管理者登入', async () => {
    const res = await request('POST', '/api/auth/login', { username: 'admin', password: 'admin123' });
    if (res.status === 200 && res.body.token) {
      adminToken = res.body.token;
      return { pass: true };
    }
    return { pass: false, reason: `status=${res.status}, ${JSON.stringify(res.body)}` };
  });

  await test('管理者資訊 (GET /me)', async () => {
    const res = await request('GET', '/api/auth/me', null, adminToken);
    return { pass: res.status === 200 && res.body.role === 'SUPER', reason: `status=${res.status}` };
  });

  // === 會員管理 ===
  console.log('\n[會員管理]');

  await test('新增測試會員', async () => {
    const res = await request('POST', '/api/members', {
      account: testAccount,
      name: '健康檢查測試',
      gender: '男',
      birthday: '1990-01-01',
      memberType: 'GENERAL',
      termNumber: 99,
      studentNumber: 999,
      districtId: 1,
    }, adminToken);
    if (res.status === 201 && res.body.id) {
      testMemberId = res.body.id;
      return { pass: true };
    }
    return { pass: false, reason: `status=${res.status}, ${JSON.stringify(res.body)}` };
  });

  await test('會員列表查詢', async () => {
    const res = await request('GET', '/api/members?limit=1', null, adminToken);
    return { pass: res.status === 200 && Array.isArray(res.body.data), reason: `status=${res.status}` };
  });

  await test('單一會員詳情', async () => {
    const res = await request('GET', `/api/members/${testMemberId}`, null, adminToken);
    return { pass: res.status === 200 && res.body.account === testAccount, reason: `status=${res.status}` };
  });

  await test('修改會員資料', async () => {
    const res = await request('PUT', `/api/members/${testMemberId}`, { company: '測試公司' }, adminToken);
    return { pass: res.status === 200 && res.body.company, reason: `status=${res.status}` };
  });

  // === 會員登入 (APP) ===
  console.log('\n[APP 會員認證]');

  await test('會員登入 (APP)', async () => {
    // 預設密碼：民國79年1月1日 = 0790101
    const res = await request('POST', '/api/auth/member-login', { account: testAccount, password: '0790101' });
    if (res.status === 200 && res.body.token) {
      memberToken = res.body.token;
      return { pass: true };
    }
    return { pass: false, reason: `status=${res.status}, ${JSON.stringify(res.body)}` };
  });

  await test('APP 個人資料', async () => {
    const res = await request('GET', '/api/members/app/profile', null, memberToken);
    return {
      pass: res.status === 200 && res.body.paymentStatus && res.body.birthdayRoc,
      reason: `status=${res.status}, hasPaymentStatus=${!!res.body?.paymentStatus}, hasBirthdayRoc=${!!res.body?.birthdayRoc}`,
    };
  });

  await test('APP 編輯個人資料', async () => {
    const res = await request('PUT', '/api/members/app/profile', { city: '測試市', education: '測試大學' }, memberToken);
    return { pass: res.status === 200 && res.body.city === '測試市', reason: `status=${res.status}` };
  });

  // === 繳費系統 ===
  console.log('\n[繳費系統]');

  await test('發行繳費批次', async () => {
    const res = await request('POST', '/api/billing/batches', {
      title: '_healthcheck_batch',
      amount: 100,
      billingType: 'ANNUAL',
      targetType: 'GENERAL',
      startDate: '2026-01-01',
      endDate: '2026-12-31',
    }, adminToken);
    if (res.status === 201 && res.body.batch) {
      testBatchId = res.body.batch.id;
      return { pass: true };
    }
    return { pass: false, reason: `status=${res.status}, ${JSON.stringify(res.body)}` };
  });

  await test('繳費批次列表', async () => {
    const res = await request('GET', '/api/billing/batches?limit=1', null, adminToken);
    return { pass: res.status === 200 && Array.isArray(res.body.data), reason: `status=${res.status}` };
  });

  await test('繳費明細查詢', async () => {
    if (!testBatchId) return { pass: false, reason: 'no batchId' };
    const res = await request('GET', `/api/billing/batches/${testBatchId}/bills?limit=1`, null, adminToken);
    if (res.status === 200 && res.body.data?.length > 0) {
      testBillId = res.body.data[0].id;
      return { pass: true };
    }
    return { pass: false, reason: `status=${res.status}, count=${res.body.data?.length}` };
  });

  await test('手動入帳', async () => {
    if (!testBillId) return { pass: false, reason: 'no billId' };
    const res = await request('PUT', `/api/billing/bills/${testBillId}/manual-pay`, { paymentMethod: 'CASH' }, adminToken);
    return { pass: res.status === 200 && res.body.status === 'MANUAL', reason: `status=${res.status}` };
  });

  await test('APP 繳費紀錄', async () => {
    const res = await request('GET', '/api/members/app/bills', null, memberToken);
    return { pass: res.status === 200 && Array.isArray(res.body.data), reason: `status=${res.status}` };
  });

  // === 活動系統 ===
  console.log('\n[活動系統]');

  await test('建立活動', async () => {
    const res = await request('POST', '/api/events', {
      title: '_healthcheck_event',
      targetType: 'GENERAL',
      startTime: '2026-12-01T09:00:00',
      isFreeOpen: true,
      points: 5,
    }, adminToken);
    if (res.status === 201 && res.body.id) {
      testEventId = res.body.id;
      return { pass: true };
    }
    return { pass: false, reason: `status=${res.status}, ${JSON.stringify(res.body)}` };
  });

  await test('活動狀態 DRAFT → OPEN', async () => {
    const res = await request('PUT', `/api/events/${testEventId}/status`, { status: 'OPEN' }, adminToken);
    return { pass: res.status === 200, reason: `status=${res.status}` };
  });

  await test('活動報名', async () => {
    const res = await request('POST', `/api/events/${testEventId}/register`, { memberId: testMemberId }, memberToken);
    return { pass: res.status === 201, reason: `status=${res.status}, ${JSON.stringify(res.body)}` };
  });

  await test('重複報名拒絕', async () => {
    const res = await request('POST', `/api/events/${testEventId}/register`, { memberId: testMemberId }, memberToken);
    return { pass: res.status === 403 || res.status === 409, reason: `status=${res.status}` };
  });

  await test('活動報名列表', async () => {
    const res = await request('GET', `/api/events/${testEventId}/registrations`, null, adminToken);
    return { pass: res.status === 200 && Array.isArray(res.body), reason: `status=${res.status}` };
  });

  await test('取消報名', async () => {
    const res = await request('PUT', `/api/events/${testEventId}/cancel`, { memberId: testMemberId }, memberToken);
    return { pass: res.status === 200, reason: `status=${res.status}, ${JSON.stringify(res.body)}` };
  });

  await test('APP 活動紀錄', async () => {
    const res = await request('GET', '/api/members/app/events', null, memberToken);
    return { pass: res.status === 200 && Array.isArray(res.body.data), reason: `status=${res.status}` };
  });

  // === APP 首頁 ===
  console.log('\n[APP 首頁]');

  await test('APP 首頁載入', async () => {
    const res = await request('GET', '/api/app/home', null, memberToken);
    return {
      pass: res.status === 200 && res.body.unreadCount !== undefined && Array.isArray(res.body.generalEvents),
      reason: `status=${res.status}, keys=${Object.keys(res.body || {}).join(',')}`,
    };
  });

  await test('APP 首頁快取命中', async () => {
    const t1 = Date.now();
    const res = await request('GET', '/api/app/home', null, memberToken);
    const t2 = Date.now();
    return { pass: res.status === 200 && (t2 - t1) < 2000, reason: `status=${res.status}, time=${t2 - t1}ms` };
  });

  await test('APP 全部已讀', async () => {
    const res = await request('PUT', '/api/app/home/read-push', {}, memberToken);
    return { pass: res.status === 200, reason: `status=${res.status}` };
  });

  await test('APP 推播列表', async () => {
    const res = await request('GET', '/api/app/home/push-list', null, memberToken);
    return { pass: res.status === 200 && Array.isArray(res.body.data), reason: `status=${res.status}` };
  });

  await test('APP 全部清除推播', async () => {
    const res = await request('PUT', '/api/app/home/clear-push', {}, memberToken);
    return { pass: res.status === 200, reason: `status=${res.status}` };
  });

  await test('活動取消連動', async () => {
    // 先重新報名再取消活動
    await request('POST', `/api/events/${testEventId}/register`, { memberId: testMemberId }, memberToken);
    const res = await request('PUT', `/api/events/${testEventId}/status`, { status: 'CANCELLED' }, adminToken);
    return { pass: res.status === 200, reason: `status=${res.status}` };
  });

  // === 其他模組 ===
  console.log('\n[其他模組]');

  await test('Dashboard', async () => {
    const res = await request('GET', '/api/dashboard', null, adminToken);
    return { pass: res.status === 200 && res.body.totalMembers !== undefined, reason: `status=${res.status}` };
  });

  await test('組織架構列表', async () => {
    const res = await request('GET', '/api/organization', null, adminToken);
    return { pass: res.status === 200 && Array.isArray(res.body), reason: `status=${res.status}` };
  });

  await test('組織架構分類篩選', async () => {
    const res = await request('GET', '/api/organization?groupType=COMMITTEE', null, adminToken);
    return { pass: res.status === 200 && res.body.length === 10, reason: `status=${res.status}, count=${res.body?.length}` };
  });

  await test('新聞列表', async () => {
    const res = await request('GET', '/api/news', null, adminToken);
    return { pass: res.status === 200, reason: `status=${res.status}` };
  });

  await test('廣告列表', async () => {
    const res = await request('GET', '/api/ads', null, adminToken);
    return { pass: res.status === 200, reason: `status=${res.status}` };
  });

  await test('商品分類列表', async () => {
    const res = await request('GET', '/api/products/categories', null, adminToken);
    return { pass: res.status === 200, reason: `status=${res.status}` };
  });

  await test('點數餘額查詢', async () => {
    const res = await request('GET', `/api/points/balance/${testMemberId}`, null, adminToken);
    return { pass: res.status === 200 && res.body.balance !== undefined, reason: `status=${res.status}` };
  });

  await test('AI 摘要列表', async () => {
    const res = await request('GET', '/api/ai-digest', null, adminToken);
    return { pass: res.status === 200, reason: `status=${res.status}` };
  });

  await test('推播列表', async () => {
    const res = await request('GET', '/api/push', null, adminToken);
    return { pass: res.status === 200, reason: `status=${res.status}` };
  });

  await test('店家列表', async () => {
    const res = await request('GET', '/api/stores', null, adminToken);
    return { pass: res.status === 200, reason: `status=${res.status}` };
  });

  // === 清理 ===
  console.log('\n[清理測試資料]');
  await cleanup();
  console.log('  ✓ 測試資料已清理');

  // === 報告 ===
  const passed = results.filter((r) => r.status === 'PASS').length;
  const failed = results.filter((r) => r.status !== 'PASS').length;

  console.log('\n========================================');
  console.log(`  結果：${passed} PASS / ${failed} FAIL / 共 ${results.length} 項`);
  console.log('========================================\n');

  if (failed > 0) {
    console.log('失敗項目：');
    results.filter((r) => r.status !== 'PASS').forEach((r) => {
      console.log(`  ✗ ${r.name} — ${r.reason}`);
    });
    console.log('');
    process.exit(1);
  }
}

run().catch((err) => {
  console.error('健康檢查執行失敗：', err.message);
  process.exit(1);
});

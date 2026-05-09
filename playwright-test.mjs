import { chromium } from 'playwright';

const BASE = 'http://localhost:3001';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  const tests = [
    { name: '01-homepage',       url: BASE + '/' },
    { name: '02-login-page',     url: BASE + '/login' },
    { name: '03-geo-api',        url: BASE + '/api/geo' },
    { name: '04-match-page',     url: BASE + '/match' },
    { name: '05-admin-page',     url: BASE + '/admin' },
  ];

  const results = [];
  for (const t of tests) {
    try {
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.goto(t.url, { waitUntil: 'networkidle', timeout: 10000 });
      const title = await page.title();
      const content = await page.content();
      const hasContent = content.length > 500;
      const ok = errors.length === 0 && hasContent;
      console.log(`${ok ? '\u2705' : '\u274c'} ${t.name} — "${title}" — ${content.length} chars — errors: ${errors.length}`);
      if (errors.length) errors.forEach(e => console.log(`   \u274c ${e}`));
      await page.screenshot({ path: `d:/源码/asd-master/asd-master/jlai-dating/playwright-test/${t.name}.png`, fullPage: true });
      results.push({ name: t.name, ok, title, size: content.length, errorCount: errors.length });
    } catch (e) {
      console.log(`\u274c ${t.name} — ${e.message}`);
      results.push({ name: t.name, ok: false, error: e.message });
    }
  }

  // 验证 geo API 返回 29 所学校
  try {
    const res = await page.goto(BASE + '/api/geo');
    const text = await page.textContent('body');
    
    // 检查关键学校
    const checks = [
      ['长春理工大学', '长理工'],
      ['长春工业大学', '长工大'],
      ['吉林建筑大学', '吉建大'],
      ['吉林农业大学', '吉农大'],
      ['长春中医药大学', '长中医'],
      ['长春师范大学', '长师大'],
      ['吉林财经大学', '吉财大'],
      ['吉林体育学院', '吉体院'],
      ['吉林工商学院', '吉工商'],
      ['长春工程学院', '长工程'],
      ['吉林警察学院', '吉警院'],
      ['长春汽车职业技术大学', '汽职大'],
      ['长春职业技术大学', '职技大'],
      ['长春光华学院', '光华'],
      ['长春工业大学人文信息学院', '人信'],
      ['长春电子科技学院', '电子'],
      ['长春财经学院', '财经'],
      ['吉林建筑科技学院', '建科'],
      ['长春建筑学院', '建筑'],
      ['长春科技学院', '科技'],
      ['长春大学旅游学院', '旅游'],
      ['长春人文学院', '人文'],
      ['campusCount.*29', 'count=29'],
    ];
    
    console.log('\n\u{1F50D} geo API 学校检查：');
    let allPass = true;
    for (const [label, short] of checks) {
      const found = text.includes(label.replace(/campusCount.*/, '29'));
      const status = found ? '\u2705' : '\u274c';
      if (!found) allPass = false;
      console.log(`  ${status} ${short}: ${found ? '找到' : '未找到'}`);
    }
    if (allPass) console.log('\n\u2705 所有 29 所学校验证通过！');
  } catch (e) {
    console.log('\u274c geo API 检查失败: ' + e.message);
  }

  await browser.close();
  
  // 总结
  const passed = results.filter(r => r.ok).length;
  console.log(`\n\u{1F3C6} ${passed}/${results.length} 页面通过测试`);
}

main().catch(console.error);

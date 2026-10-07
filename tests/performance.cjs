const { chromium } = require('playwright');
const { mkdirSync, writeFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { once } = require('node:events');

// Comparative diagnostics, not an FPS guarantee: browser/GPU and machine load matter.
(async () => {
  const { createApp } = await import('../server/server.js');
  const label = process.argv[2] || 'current';
  if (!/^[a-z-]+$/.test(label)) throw new Error('Use a simple diagnostic label.');
  const evidenceDir = resolve('test-results', 'performance');
  mkdirSync(evidenceDir, { recursive: true });
  const result = { label, measuredAt: new Date().toISOString(), cpuSlowdown: 4, cartUpdates: [], scrolling: [] };
  let app, browser;
  try {
    app = createApp({ databasePath: ':memory:' });
    app.server.listen(0, '127.0.0.1');
    await once(app.server, 'listening');
    browser = await chromium.launch({ channel: process.env.POS_BROWSER_CHANNEL || 'msedge', headless: true });
    const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
    result.browser = browser.version();
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Performance.enable');
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: result.cpuSlowdown });
    await page.goto(`http://127.0.0.1:${app.server.address().port}`);
    await page.locator('.product-card').first().waitFor();
    await page.locator('[data-action="add"][data-id="1"]').click();
    if (await page.locator('#add-confirmation[open]').count()) await page.getByRole('button', { name: 'Add to Order', exact: true }).click();
    for (let run = 0; run < 3; run++) {
      result.cartUpdates.push(await page.evaluate(() => {
        const catalog = document.querySelector('.product-grid');
        const observer = new MutationObserver(() => {});
        observer.observe(document.querySelector('#app'), { childList: true, subtree: true });
        const start = performance.now();
        for (let i = 0; i < 120; i++) {
          document.querySelector(`[data-action="${i % 2 ? 'decrease' : 'increase'}"][data-id="1"]`).click();
        }
        const elapsedMs = performance.now() - start;
        const replacedNodes = observer.takeRecords().reduce((sum, record) => sum + record.removedNodes.length, 0);
        observer.disconnect();
        return { updates: 120, elapsedMs, removedNodes: replacedNodes, catalogPreserved: catalog === document.querySelector('.product-grid') };
      }));
    }
    for (const viewport of [{ width: 1366, height: 768 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      await page.evaluate(() => scrollTo(0, 0));
      await page.waitForTimeout(3000); // Let the preceding toast finish before sampling idle scrolling.
      const before = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]));
      await page.evaluate(() => {
        window.scrollSample = { frames: [], longTasks: [], running: true };
        const sample = window.scrollSample;
        sample.observer = new PerformanceObserver(list => sample.longTasks.push(...list.getEntries().map(entry => entry.duration)));
        sample.observer.observe({ type: 'longtask', buffered: false });
        let previous;
        const tick = time => {
          if (previous) sample.frames.push(time - previous);
          previous = time;
          if (sample.running) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      await page.mouse.move(160, 400);
      for (let step = 0; step < 30; step++) {
        await page.mouse.wheel(0, step % 10 < 5 ? 180 : -180);
        await page.waitForTimeout(50);
      }
      const sample = await page.evaluate(() => {
        const sample = window.scrollSample;
        sample.running = false;
        sample.observer.disconnect();
        const sorted = [...sample.frames].sort((a, b) => a - b);
        return { frames: sorted.length, medianFrameMs: sorted[Math.floor(sorted.length / 2)], p95FrameMs: sorted[Math.floor(sorted.length * .95)], framesOver25ms: sorted.filter(n => n > 25).length, longTasks: sample.longTasks };
      });
      const after = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]));
      for (const key of ['LayoutCount', 'RecalcStyleCount', 'LayoutDuration', 'RecalcStyleDuration', 'ScriptDuration', 'TaskDuration']) sample[key] = after[key] - before[key];
      result.scrolling.push({ viewport, ...sample });
    }
    writeFileSync(resolve(evidenceDir, `${label}.json`), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await browser?.close();
    if (app?.server.listening) await new Promise(done => app.server.close(done));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

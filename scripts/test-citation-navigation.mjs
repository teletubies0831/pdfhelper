import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import { chromium } from '@playwright/test';
import ts from 'typescript';
import { calculateCenteredScrollTop } from '../src/viewer/shared-ui/navigation/center-scroll-region.ts';

test('center calculation uses the complete highlighted region and clamps to content', () => {
  assert.equal(calculateCenteredScrollTop({
    currentScrollTop: 100,
    viewportTop: 100,
    viewportHeight: 600,
    regionTop: 350,
    regionBottom: 550,
    maximumScrollTop: 2000,
  }), 150);
  assert.equal(calculateCenteredScrollTop({
    currentScrollTop: 20,
    viewportTop: 100,
    viewportHeight: 400,
    regionTop: -200,
    regionBottom: -100,
    maximumScrollTop: 2000,
  }), 0);
  assert.equal(calculateCenteredScrollTop({
    currentScrollTop: 1900,
    viewportTop: 100,
    viewportHeight: 400,
    regionTop: 900,
    regionBottom: 1000,
    maximumScrollTop: 2000,
  }), 2000);
});

let server, browser, page, origin;
before(async () => {
  const source = await readFile(new URL('../src/viewer/shared-ui/navigation/center-scroll-region.ts', import.meta.url), 'utf8');
  const helper = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  }).outputText;
  const fixture = `<!doctype html><style>
    #viewport { position:absolute; top:80px; left:40px; width:500px; height:300px; overflow:auto; border:4px solid #333; }
    #content { position:relative; height:1800px; }
    .mark { position:absolute; left:30px; width:200px; height:30px; }
    #first { top:650px; } #last { top:990px; height:50px; }
  </style><div id="viewport"><div id="content"><div id="first" class="mark"></div><div id="last" class="mark"></div></div></div>
  <script type="module">
    import { centerClientRegionsInScrollContainer } from '/helper.js';
    const viewport = document.getElementById('viewport');
    const marks = [...document.querySelectorAll('.mark')];
    window.centerRegion = () => centerClientRegionsInScrollContainer(viewport, marks.map(item => item.getBoundingClientRect()));
    window.readCenters = () => {
      const bounds = viewport.getBoundingClientRect();
      const rects = marks.map(item => item.getBoundingClientRect());
      return {
        viewport: bounds.top + viewport.clientTop + viewport.clientHeight / 2,
        region: (Math.min(...rects.map(item => item.top)) + Math.max(...rects.map(item => item.bottom))) / 2,
        scrollTop: viewport.scrollTop,
      };
    };
  </script>`;
  server = createServer((request, response) => {
    response.setHeader('Content-Type', request.url === '/helper.js' ? 'text/javascript' : 'text/html');
    response.end(request.url === '/helper.js' ? helper : fixture);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ channel: process.env.PDFPAL_TEST_BROWSER || 'msedge', headless: true });
  page = await browser.newPage();
  await page.goto(origin);
  await page.waitForFunction(() => typeof window.centerRegion === 'function');
});
after(async () => {
  await browser?.close();
  await new Promise(resolve => server?.close(resolve) ?? resolve());
});

test('browser scroll centers the midpoint between the first and last highlight edges', async () => {
  const before = await page.evaluate(() => window.readCenters());
  assert.ok(Math.abs(before.region - before.viewport) > 100);
  await page.evaluate(() => window.centerRegion());
  const afterCenter = await page.evaluate(() => window.readCenters());
  assert.ok(Math.abs(afterCenter.region - afterCenter.viewport) <= 1);
  assert.ok(afterCenter.scrollTop > 0);
});

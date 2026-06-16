/*
 * Copyright (c) 2016-present - TagSpaces GmbH. All rights reserved.
 */
import fs from 'fs';
import http from 'http';
import path from 'path';

import { expect, test } from './fixtures';
import {
  clickOn,
  clickOnIfVisible,
  expectElementExist,
  getGridFileSelector,
  reloadDirectory,
  setInputValue,
} from './general.helpers';
import { startTestingApp, stopApp } from './hook';
import {
  createPwLocation,
  createS3Location,
  defaultLocationName,
} from './location.helpers';
import { clickOnMenuOperation } from './test-utils';
import { clearDataStorage, closeWelcomePlaywright } from './welcome.helpers';

// A tiny localhost HTTP server stands in for an arbitrary remote site so the
// download path is exercised end-to-end without network flakiness. The Electron
// main process reaches it over net.fetch the same way it would a real URL.
const SAMPLE_TXT = 'TagSpaces download URL test content';
const PAGE_HTML = `<!DOCTYPE html>
<html>
  <head><title>Clip Test Page</title></head>
  <body>
    <h1>Hello Heading</h1>
    <p>Some paragraph text for clipping.</p>
    <script>window.__evil = 'should-be-stripped';</script>
  </body>
</html>`;

let server;
let baseUrl;

// Match a grid entry whose data-tid starts with the given base name, ignoring
// the auto datetime tag + extension that `dataTidFormat` turns into `_…`.
async function expectEntryStartingWith(base, timeout = 20000) {
  await global.client.waitForSelector(`[data-tid^="fsEntryName_${base}"]`, {
    state: 'visible',
    timeout,
  });
}

async function openDownloadUrlDialog() {
  await clickOn('[data-tid=folderContainerOpenDirMenu]');
  await clickOnMenuOperation('newFromDownloadURLTID');
  await global.client.waitForSelector('[data-tid=downloadUrlDialogTID]', {
    state: 'visible',
    timeout: 8000,
  });
}

test.beforeAll(async ({ isWeb, isS3, webServerPort }, testInfo) => {
  server = http.createServer((req, res) => {
    if (req.url === '/sample.txt') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(SAMPLE_TXT);
    } else if (req.url === '/page.html') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(PAGE_HTML);
    } else {
      res.writeHead(404);
      res.end('not found');
    }
  });
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  if (isS3) {
    await startTestingApp({ isWeb, isS3, webServerPort, testInfo });
    await closeWelcomePlaywright();
  } else {
    await startTestingApp(
      { isWeb, isS3, webServerPort, testInfo },
      'extconfig.js',
    );
  }
});

test.afterAll(async () => {
  await stopApp();
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
});

test.afterEach(async ({ isS3, testDataDir }) => {
  // Keep the shared local test data clean (S3 is reset by other suites' refresh).
  // Downloads carry an auto datetime tag in the filename (e.g. sample[…].txt),
  // so match by prefix rather than exact name.
  if (!isS3) {
    fs.readdirSync(testDataDir)
      .filter((name) => /^(sample|page|download)[[.]/.test(name))
      .forEach((name) => fs.rmSync(path.join(testDataDir, name), { force: true }));
  }
  await clearDataStorage();
});

test.beforeEach(async ({ isS3, testDataDir }) => {
  if (isS3) {
    await createS3Location('', defaultLocationName, true);
    await closeWelcomePlaywright();
  } else {
    await createPwLocation(testDataDir, defaultLocationName, true);
  }
  await clickOn('[data-tid=location_' + defaultLocationName + ']');
  await expectElementExist(getGridFileSelector('empty_folder'), true, 15000);
});

test.describe('TST54 - Download from URL', () => {
  test('TST5420 - Download raw file into the location [electron,s3]', async () => {
    await openDownloadUrlDialog();
    await setInputValue('[data-tid=newUrlTID] input', baseUrl + '/sample.txt');
    // Default "Original file" format → straight binary download into the
    // location. The filename carries an auto datetime tag (sample[…].txt), so
    // match the entry by prefix.
    await clickOn('[data-tid=downloadFileUrlTID]');
    await expectEntryStartingWith('sample');
    // The raw download opens the upload-progress dialog — dismiss it before
    // interacting with the directory menu again.
    await clickOnIfVisible('[data-tid=closeFileUploadTID]');
    await reloadDirectory();
    await expectEntryStartingWith('sample');
  });

  test('TST5421 - Clip an HTML page as Markdown [electron,s3]', async ({
    isS3,
    testDataDir,
  }) => {
    await openDownloadUrlDialog();
    await setInputValue('[data-tid=newUrlTID] input', baseUrl + '/page.html');
    await clickOn('[data-tid=downloadFormatMarkdownTID]');
    await clickOn('[data-tid=downloadFileUrlTID]');
    // page.html → page[…datetime tag…].md saved into the location.
    await expectEntryStartingWith('page');

    // On local locations assert the conversion result on disk: heading/text
    // survive, the <script> is stripped by DOMPurify.
    if (!isS3) {
      const mdFile = fs
        .readdirSync(testDataDir)
        .find((name) => /^page.*\.md$/.test(name));
      expect(mdFile).toBeTruthy();
      const md = fs.readFileSync(path.join(testDataDir, mdFile), 'utf8');
      expect(md).toContain('Hello Heading');
      expect(md).toContain('Some paragraph text');
      expect(md).not.toContain('should-be-stripped');
      expect(md).not.toContain('<script');
    }
  });
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escapeQueryValue, extractDriveId, extractResourceKey } from '../src/drive/ids.js';

const ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz_-0123';

test('extracts ids from every common Google link format', () => {
  const links = [
    `https://drive.google.com/file/d/${ID}/view?usp=sharing`,
    `https://drive.google.com/drive/folders/${ID}`,
    `https://drive.google.com/drive/u/1/folders/${ID}?usp=drive_link`,
    `https://drive.google.com/open?id=${ID}`,
    `https://drive.google.com/uc?export=download&id=${ID}`,
    `https://docs.google.com/document/d/${ID}/edit`,
    `https://docs.google.com/spreadsheets/u/0/d/${ID}/edit#gid=0`,
    `https://docs.google.com/presentation/d/${ID}/edit`,
    `  ${ID}  `,
  ];
  for (const link of links) assert.equal(extractDriveId(link), ID, link);
});

test('rejects things that are not Drive ids', () => {
  for (const bad of ['', 'abc', 'https://example.com/page', "x' or 1=1 or 'y", null, 42]) {
    assert.equal(extractDriveId(bad), null, String(bad));
  }
});

test('extracts the resource key of legacy shared links', () => {
  const link = `https://drive.google.com/file/d/${ID}/view?usp=sharing&resourcekey=0-AbC_d`;
  assert.equal(extractResourceKey(link, ID), `${ID}/0-AbC_d`);
  assert.equal(extractResourceKey(`https://drive.google.com/file/d/${ID}/view`, ID), undefined);
});

test('escapes Drive query literals', () => {
  assert.equal(escapeQueryValue("it's a \\ test"), "it\\'s a \\\\ test");
});

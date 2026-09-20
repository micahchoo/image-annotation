import {test} from 'node:test';
import assert from 'node:assert/strict';
import {checkAssetMap, checkVersions, sha256} from './check-release.mjs';

const manifest = {id: 'image-annotation', name: 'Image Annotation', version: '1.2.3', minAppVersion: '1.8.7', author: 'Micah'};
const lock = {version: '1.2.3', packages: {'': {version: '1.2.3'}}};

test('checks matching versions and exact release tags', () => {
  assert.doesNotThrow(() => checkVersions(manifest, manifest, lock, {'1.2.3': '1.8.7'}, '1.2.3'));
  for (const tag of ['v1.2.3', '1.2.4']) assert.throws(() => checkVersions(manifest, manifest, lock, {'1.2.3': '1.8.7'}, tag));
  assert.throws(() => checkVersions(manifest, {...manifest, version: '1.2.4'}, lock, {'1.2.3': '1.8.7'}));
  assert.throws(() => checkVersions(manifest, manifest, lock, {}, undefined));
});

test('requires exactly the three Obsidian release assets', () => {
  const files = new Map(['main.js', 'manifest.json', 'styles.css'].map(name => [name, Buffer.from(name)]));
  assert.doesNotThrow(() => checkAssetMap(files));
  for (const missing of files.keys()) {
    const incomplete = new Map(files); incomplete.delete(missing);
    assert.throws(() => checkAssetMap(incomplete), /Missing/);
  }
  files.set('main.js.map', Buffer.from('source map'));
  assert.throws(() => checkAssetMap(files), /Unexpected/);
});

test('exports stable SHA-256 checksums', () => assert.match(sha256(Buffer.from('fixture')), /^[a-f0-9]{64}$/));

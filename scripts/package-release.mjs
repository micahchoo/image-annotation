import {execFileSync} from 'node:child_process';
import {mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {checkRelease, sha256} from './check-release.mjs';

const {manifest, files} = await checkRelease(process.env.RELEASE_TAG);
await rm('release', {recursive: true, force: true});
await mkdir('release');
const zipName = `${manifest.id}-${manifest.version}.zip`;

// Stable timestamps and sorted paths make the archive reproducible.
execFileSync('python3', ['-c', `
import pathlib, sys, zipfile
root = pathlib.Path('dist')
with zipfile.ZipFile(sys.argv[1], 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
    for path in sorted(root.rglob('*')):
        if path.is_file():
            info = zipfile.ZipInfo(path.relative_to(root).as_posix(), (1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            archive.writestr(info, path.read_bytes(), compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)
with zipfile.ZipFile(sys.argv[1]) as archive:
    assert archive.testzip() is None
    expected = {path.relative_to(root).as_posix(): path.read_bytes() for path in root.rglob('*') if path.is_file()}
    assert set(archive.namelist()) == set(expected)
    for name, data in expected.items():
        assert archive.read(name) == data, name
`, `release/${zipName}`], {stdio: 'inherit'});

for (const name of ['main.js', 'manifest.json', 'styles.css']) await writeFile(`release/${name}`, files.get(name));
const assets = [zipName, 'main.js', 'manifest.json', 'styles.css', 'INSTALLATION.json'];
await writeFile('release/INSTALLATION.json', `${JSON.stringify({version: manifest.version, assets: assets.slice(0, -1)}, null, 2)}\n`);
const checksums = await Promise.all(assets.map(async name => `${sha256(await readFile(`release/${name}`))}  ${name}`));
await writeFile('release/SHA256SUMS', `${checksums.join('\n')}\n`);
console.log(`Packaged ${manifest.id} ${manifest.version}: release/${zipName}`);

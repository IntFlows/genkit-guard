"""Compare measured and final release archives without extracting their contents."""
import base64
import hashlib
import json
import pathlib
import tarfile

root = pathlib.Path(__file__).resolve().parents[1]
reports = root / 'docs/validation/rc-2026-11-02'
app = root.parent / 'genkit-guard-test-app'
soak = json.loads((reports / 'soak-complete.json').read_text())
lock = json.loads((app / 'package-lock.json').read_text())
installed = lock['packages']['node_modules/@intflows/genkit-guard']
measured = app / soak['artifact']['resolved'].removeprefix('file:')
final = app / installed['resolved'].removeprefix('file:')

def integrity(file):
    return 'sha512-' + base64.b64encode(hashlib.sha512(file.read_bytes()).digest()).decode()

def manifest(file):
    with tarfile.open(file, 'r:gz') as archive:
        return {member.name: hashlib.sha256(archive.extractfile(member).read()).hexdigest()
                for member in archive.getmembers() if member.isfile()}

assert integrity(measured) == soak['artifact']['integrity'], 'Measured archive integrity mismatch'
assert integrity(final) == installed['integrity'], 'Installed final archive integrity mismatch'
previous, current = manifest(measured), manifest(final)
changes = [name for name in sorted(previous.keys() | current.keys()) if previous.get(name) != current.get(name)]
assert set(changes) <= {'package/README.md'}, f'Unexpected packaged changes: {changes}'
with tarfile.open(final, 'r:gz') as archive:
    package = json.load(archive.extractfile('package/package.json'))
assert package['version'] == '1.0.0-rc.1'
result = {
    'version': package['version'], 'runtimeFilesIdentical': True,
    'allowedDifferences': ['package/README.md'], 'changedFiles': changes,
    'measuredArchive': str(measured), 'measuredIntegrity': integrity(measured),
    'finalArchive': str(final), 'finalIntegrity': integrity(final),
    'finalSha256': hashlib.sha256(final.read_bytes()).hexdigest(),
    'fileCount': len(current), 'fileSha256': current,
}
(reports / 'artifact-comparison.json').write_text(json.dumps(result, indent=2) + '\n')
raw = (reports / 'final-publish-dry-run.log').read_text()
metadata = None
for index, line in enumerate(raw.splitlines(keepends=True)):
    if line.strip() in ('{', '['):
        try:
            metadata = json.loads(''.join(raw.splitlines(keepends=True)[index:]))
            break
        except json.JSONDecodeError:
            pass
assert isinstance(metadata, dict), 'Could not parse final publish dry-run metadata'
assert metadata['integrity'] == installed['integrity'], 'Dry-run differs from installed archive'
(reports / 'final-artifact.json').write_text(json.dumps(metadata, indent=2) + '\n')
print(json.dumps({key: result[key] for key in ['version', 'runtimeFilesIdentical', 'changedFiles', 'finalSha256']}))

# Final documentation/evidence consistency checks.
import datetime
import re
checked = 0
for file in reports.rglob('*.json'):
    json.loads(file.read_text(encoding='utf-8-sig'))
    checked += 1
summary = json.loads((reports / 'summary.json').read_text(encoding='utf-8-sig'))
assert summary['version'] == '1.0.0-rc.1'
assert summary['published'] is False
assert summary['soak']['accepted'] is True
assert summary['soak']['rawResult']['memoryGate'] is False
assert summary['finalIntegrity'] == installed['integrity']
assert all(cell['passed'] for cell in summary['localCompatibility'])
assert summary['independent']['passed'] and summary['independent']['cases'] == 7
assert summary['audit']['policyPassed'] and summary['audit']['blockingFindings'] == 0
pages = ['README.md'] + sorted(page.relative_to(root).as_posix() for page in (root / 'docs').rglob('*.md'))
links = 0
for name in pages:
    page = root / name
    for target in re.findall(r'\[[^\]]+\]\(([^)]+)\)', page.read_text()):
        if target.startswith(('http:', 'https:', 'mailto:', '#')):
            continue
        destination = (page.parent / target.split('#', 1)[0]).resolve()
        assert destination.exists(), f'Broken local link in {name}: {target}'
        links += 1
    for title in re.findall(r'\[\[([^\]]+)\]\]', re.sub(r'`[^`]*`', '', page.read_text())):
        destination = page.parent / (title.split('|', 1)[0] + '.md')
        assert destination.exists(), f'Broken wiki link in {name}: {title}'
        links += 1
verification = {'timestamp': datetime.datetime.now(datetime.timezone.utc).isoformat(),
                'passed': True, 'jsonReportsParsed': checked,
                'documentationPagesChecked': pages, 'localLinksChecked': links,
                'runtimeFilesIdentical': True, 'finalSha256': result['finalSha256'],
                'publicationPerformed': False}
(reports / 'final-verification.json').write_text(json.dumps(verification, indent=2) + '\n')
print(json.dumps(verification))

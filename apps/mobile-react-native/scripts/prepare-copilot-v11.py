"""Prepare the licensed SDK before npm ci. Never commit vendor bytes or URLs."""
import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import tempfile
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]
EXPECTED = 'c5db24a1ae9feca69fd0726faf59337803b46407fface803534d16cc8a688de7'


def unpack(archive, destination):
    for entry in archive.infolist():
        target = (destination / entry.filename).resolve()
        if not target.is_relative_to(destination.resolve()):
            raise ValueError('Unsafe SDK archive path')
        if (entry.external_attr >> 16) & 0o170000 == 0o120000:
            raise ValueError('SDK archive contains a symlink')
    archive.extractall(destination)


def replace_once(path, old, new):
    text = path.read_text()
    if text.count(old) != 1:
        raise ValueError('Vendor source changed; review compatibility patch')
    path.write_text(text.replace(old, new))


def prepare(archive_path):
    with open(archive_path, 'rb') as stream:
        digest = hashlib.file_digest(stream, 'sha256').hexdigest()
    if digest != EXPECTED:
        raise ValueError('SDK archive checksum mismatch; review the new delivery')
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        with zipfile.ZipFile(archive_path) as outer:
            with zipfile.ZipFile(io.BytesIO(outer.read('CPIKReactNativeLibrary.zip'))) as sdk:
                unpack(sdk, root)
        source = root / 'CPIKReactNativeLibrary'
        pkg_path = source / 'package.json'
        pkg = json.loads(pkg_path.read_text())
        if pkg['version'] != '11.3.0-2016':
            raise ValueError('Unexpected SDK package version')
        # Keep one RN runtime; the delivered package otherwise installs RN 0.79.5.
        pkg.pop('dependencies', None)
        pkg.pop('devDependencies', None)
        pkg['peerDependencies'] = {'react-native': '0.85.0'}
        pkg_path.write_text(json.dumps(pkg, indent=2) + '\n')
        (source / 'package-lock.json').unlink(missing_ok=True)
        replace_once(source / 'android/build.gradle', 'com.facebook.react:react-android:0.79.5', 'com.facebook.react:react-android')
        replace_once(source / 'android/src/main/java/com/alk/cpik/react/CopilotStartupModule.java', '.setSmallIcon(null)', '.setSmallIcon(reactContext.getApplicationInfo().icon)')
        destination = ROOT / 'vendor/copilot'
        if destination.exists():
            shutil.rmtree(destination)
        shutil.copytree(source, destination)
    print('Prepared verified CPIK 11.3.0-2016 for RN 0.85.0; native/device validation remains required.')


if __name__ == '__main__':
    local = os.environ.get('SEMITRAX_COPILOT_ARCHIVE')
    if local:
        prepare(local)
    else:
        url = os.environ.get('SEMITRAX_COPILOT_SDK_URL')
        if not url or not url.startswith('https://'):
            raise SystemExit('Set SEMITRAX_COPILOT_ARCHIVE or private SEMITRAX_COPILOT_SDK_URL before npm ci.')
        with tempfile.TemporaryDirectory() as tmp:
            archive = Path(tmp) / 'sdk.zip'
            try:
                with urllib.request.urlopen(url, timeout=120) as response, archive.open('wb') as output:
                    shutil.copyfileobj(response, output)
            except Exception:
                raise SystemExit('SDK download failed; check private download access.') from None
            prepare(archive)

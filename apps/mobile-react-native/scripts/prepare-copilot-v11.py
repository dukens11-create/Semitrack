"""Prepare the licensed SDK before npm ci. Never commit vendor bytes or URLs."""
import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import tempfile
import urllib.error
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]
EXPECTED = 'a5c5c0fd63cef6e1acc92d2816db8c8cc79f33e7a6c73b2746545bc726e6b571'


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
        source = root  # 11.4 delivery places package.json at the inner ZIP root.
        pkg_path = source / 'package.json'
        pkg = json.loads(pkg_path.read_text())
        if pkg['version'] != '11.4.0-2142':
            raise ValueError('Unexpected SDK package version')
        # Keep one RN runtime; the reviewed 11.4 package has empty dependencies.
        pkg.pop('dependencies', None)
        pkg.pop('devDependencies', None)
        pkg['peerDependencies'] = {'react-native': '0.85.0'}
        pkg_path.write_text(json.dumps(pkg, indent=2) + '\n')
        (source / 'package-lock.json').unlink(missing_ok=True)
        replace_once(source / 'android/build.gradle', 'com.facebook.react:react-android:0.85.0', 'com.facebook.react:react-android')
        replace_once(source / 'android/src/main/java/com/alk/cpik/react/CopilotStartupModule.java', '.setSmallIcon(null)', '.setSmallIcon(reactContext.getApplicationInfo().icon)')
        destination = ROOT / 'vendor/copilot'
        if destination.exists():
            shutil.rmtree(destination)
        shutil.copytree(source, destination)
    print('Prepared verified CPIK 11.4.0-2142 for RN 0.85.0; native/device validation remains required.')


def download(url, archive):
    """Report safe failure categories without logging private URLs or responses."""
    try:
        with urllib.request.urlopen(url, timeout=120) as response, archive.open('wb') as output:
            shutil.copyfileobj(response, output)
    except urllib.error.HTTPError as error:
        status = error.code
        if status in (401, 403):
            reason = 'access denied; renew authorized private SDK access'
        elif status in (404, 410):
            reason = 'download unavailable; obtain a current authorized SDK link'
        elif status == 429:
            reason = 'provider rate limit; retry later'
        else:
            reason = 'provider HTTP failure; check vendor availability'
        raise SystemExit(f'SDK download failed (HTTP {status}): {reason}.') from None
    except (urllib.error.URLError, TimeoutError):
        raise SystemExit('SDK download failed: network or TLS connection unavailable; check connectivity.') from None
    except Exception:
        raise SystemExit('SDK download failed; check private download access and local storage.') from None


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
            download(url, archive)
            prepare(archive)

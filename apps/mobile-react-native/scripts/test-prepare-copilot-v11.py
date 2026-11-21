import hashlib
import json
import importlib.util
import io
from pathlib import Path
import tempfile
import unittest
import zipfile
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('prepare', Path(__file__).with_name('prepare-copilot-v11.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class PreparationTests(unittest.TestCase):
    def test_download_http_errors_are_actionable_and_redacted(self):
        secret_url = 'https://vendor.invalid/private?token=secret-value'
        for status, expected in [(401, 'access denied'), (403, 'access denied'),
                                 (404, 'download unavailable'), (410, 'download unavailable'),
                                 (429, 'rate limit'), (503, 'provider HTTP failure')]:
            with self.subTest(status=status), tempfile.TemporaryDirectory() as temp:
                error = module.urllib.error.HTTPError(secret_url, status, secret_url, {}, None)
                with patch.object(module.urllib.request, 'urlopen', side_effect=error):
                    with self.assertRaises(SystemExit) as caught:
                        module.download(secret_url, Path(temp) / 'sdk.zip')
                message = str(caught.exception)
                self.assertIn(expected, message)
                self.assertIn(str(status), message)
                self.assertNotIn('secret-value', message)
                self.assertNotIn('vendor.invalid', message)

    def test_network_and_storage_errors_do_not_leak_url(self):
        for error, expected in [(module.urllib.error.URLError('secret-value'), 'network'),
                                (TimeoutError('secret-value'), 'network'),
                                (OSError('secret-value'), 'local storage')]:
            with self.subTest(error=type(error).__name__), tempfile.TemporaryDirectory() as temp:
                with patch.object(module.urllib.request, 'urlopen', side_effect=error):
                    with self.assertRaises(SystemExit) as caught:
                        module.download('https://vendor.invalid/private', Path(temp) / 'sdk.zip')
                self.assertIn(expected, str(caught.exception))
                self.assertNotIn('secret-value', str(caught.exception))

    def test_download_preserves_bytes_for_checksum_verification(self):
        with tempfile.TemporaryDirectory() as temp:
            archive = Path(temp) / 'sdk.zip'
            with patch.object(module.urllib.request, 'urlopen', return_value=io.BytesIO(b'vendor bytes')):
                module.download('https://vendor.invalid/private', archive)
            self.assertEqual(archive.read_bytes(), b'vendor bytes')

    def test_reviewed_layout_prepares_without_nested_runtime(self):
        self.exercise_delivery('11.4.0-2142', succeeds=True)

    def test_wrong_version_preserves_installed_package(self):
        self.exercise_delivery('11.3.0-2016', succeeds=False)

    def exercise_delivery(self, version, succeeds):
        # Synthetic fixture only: the real delivery is independently fingerprinted.
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            installed = root / 'vendor/copilot'
            installed.mkdir(parents=True)
            (installed / 'existing').write_text('keep')
            inner = io.BytesIO()
            with zipfile.ZipFile(inner, 'w') as sdk:
                sdk.writestr('package.json', json.dumps({'name': 'test-sdk', 'version': version,
                    'dependencies': {}, 'devDependencies': {}}))
                sdk.writestr('android/build.gradle', 'implementation "com.facebook.react:react-android:0.85.0"')
                sdk.writestr('android/src/main/java/com/alk/cpik/react/CopilotStartupModule.java', '.setSmallIcon(null)')
            archive = root / 'sdk.zip'
            with zipfile.ZipFile(archive, 'w') as outer:
                outer.writestr('CPIKReactNativeLibrary.zip', inner.getvalue())
            digest = hashlib.sha256(archive.read_bytes()).hexdigest()
            with patch.object(module, 'ROOT', root), patch.object(module, 'EXPECTED', digest):
                if not succeeds:
                    with self.assertRaisesRegex(ValueError, 'Unexpected SDK package version'):
                        module.prepare(archive)
                    self.assertEqual((installed / 'existing').read_text(), 'keep')
                    return
                module.prepare(archive)
            pkg = json.loads((installed / 'package.json').read_text())
            self.assertEqual(pkg['version'], version)
            self.assertEqual(pkg['peerDependencies'], {'react-native': '0.85.0'})
            self.assertNotIn('dependencies', pkg)
            self.assertNotIn('devDependencies', pkg)
            self.assertNotIn(':0.85.0', (installed / 'android/build.gradle').read_text())
            self.assertIn('getApplicationInfo().icon', (installed / 'android/src/main/java/com/alk/cpik/react/CopilotStartupModule.java').read_text())

    def test_bad_checksum_preserves_installed_package(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            installed = root / 'vendor/copilot'
            installed.mkdir(parents=True)
            marker = installed / 'existing'
            marker.write_text('keep')
            archive = root / 'bad.zip'
            archive.write_bytes(b'not the verified SDK')
            with patch.object(module, 'ROOT', root), self.assertRaisesRegex(ValueError, 'checksum'):
                module.prepare(archive)
            self.assertEqual(marker.read_text(), 'keep')

    def test_archive_cannot_escape_destination(self):
        with tempfile.TemporaryDirectory() as temp:
            data = io.BytesIO()
            with zipfile.ZipFile(data, 'w') as archive:
                archive.writestr('../escape', 'bad')
            with zipfile.ZipFile(data) as archive, self.assertRaisesRegex(ValueError, 'Unsafe'):
                module.unpack(archive, Path(temp) / 'destination')
            self.assertFalse((Path(temp) / 'escape').exists())

    def test_patch_refuses_unexpected_vendor_source(self):
        with tempfile.TemporaryDirectory() as temp:
            source = Path(temp) / 'source'
            source.write_text('unexpected version')
            with self.assertRaisesRegex(ValueError, 'Vendor source changed'):
                module.replace_once(source, 'original SDK text', 'new')
            self.assertEqual(source.read_text(), 'unexpected version')

if __name__ == '__main__':
    unittest.main()

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

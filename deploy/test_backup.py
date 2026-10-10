import importlib.util
from pathlib import Path
import subprocess
import tarfile
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('backup', Path(__file__).with_name('backup.py'))
backup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backup)


class BackupTests(unittest.TestCase):
    def test_round_trip_preserves_binary_data(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            data = root / '.data'
            (data / 'postgres').mkdir(parents=True)
            (data / 'postgres/test').write_bytes(bytes(range(256)))
            archive = root / 'backup.tar.gz'
            backup.pack(data, archive)
            archive.with_suffix('.gz.sha256').write_text(backup.digest(archive))
            self.assertGreater(backup.verify(archive), 1)
            with tarfile.open(archive) as source:
                self.assertEqual(source.extractfile('.data/postgres/test').read(), bytes(range(256)))

    def test_checksum_rejects_corruption(self):
        with tempfile.TemporaryDirectory() as d:
            archive = Path(d) / 'backup.tar.gz'
            archive.write_bytes(b'corrupted')
            archive.with_suffix('.gz.sha256').write_text('0' * 64)
            with self.assertRaisesRegex(ValueError, 'checksum'):
                backup.verify(archive)

    def test_archive_rejects_traversal(self):
        with tempfile.TemporaryDirectory() as d:
            archive = Path(d) / 'backup.tar.gz'
            with tarfile.open(archive, 'w:gz') as target:
                target.addfile(tarfile.TarInfo('.data/../../outside'))
            archive.with_suffix('.gz.sha256').write_text(backup.digest(archive))
            with self.assertRaisesRegex(ValueError, 'Unsafe'):
                backup.verify(archive)

    def test_failure_restarts_previously_active_service(self):
        with tempfile.TemporaryDirectory() as d:
            calls = []
            def service(args, **kwargs):
                calls.append(args)
                return subprocess.CompletedProcess(args, 0)
            with self.assertRaisesRegex(ValueError, 'PGlite'):
                backup.snapshot(Path(d), Path(d) / 'backups', service)
            self.assertIn(['systemctl', 'stop', 'endurozone'], calls)
            self.assertEqual(calls[-1], ['systemctl', 'start', 'endurozone'])

    def test_inactive_service_stays_inactive_on_failure(self):
        with tempfile.TemporaryDirectory() as d:
            calls = []
            def service(args, **kwargs):
                calls.append(args)
                return subprocess.CompletedProcess(args, 3)
            with self.assertRaises(ValueError):
                backup.snapshot(Path(d), Path(d) / 'backups', service)
            self.assertEqual(len(calls), 1)

    def test_success_creates_completed_set_and_restarts(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            (root / '.data/postgres').mkdir(parents=True)
            (root / '.data/postgres/test').write_bytes(b'synthetic')
            calls = []
            def service(args, **kwargs):
                calls.append(args)
                return subprocess.CompletedProcess(args, 0, stdout='test-commit\n')
            archive = backup.snapshot(root, root / 'backups', service)
            self.assertTrue(archive.with_suffix('.gz.json').exists())
            self.assertGreater(backup.verify(archive), 1)
            self.assertEqual(calls[-1], ['systemctl', 'start', 'endurozone'])

    def test_archive_rejects_symbolic_links(self):
        with tempfile.TemporaryDirectory() as d:
            archive = Path(d) / 'backup.tar.gz'
            with tarfile.open(archive, 'w:gz') as target:
                entry = tarfile.TarInfo('.data/link')
                entry.type = tarfile.SYMTYPE
                entry.linkname = '/etc/passwd'
                target.addfile(entry)
            archive.with_suffix('.gz.sha256').write_text(backup.digest(archive))
            with self.assertRaisesRegex(ValueError, 'Unsafe'):
                backup.verify(archive)


if __name__ == '__main__':
    unittest.main()

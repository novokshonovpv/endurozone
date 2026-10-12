import importlib.util
from pathlib import Path
import subprocess
import tarfile
import tempfile
import unittest
from unittest.mock import patch
from types import SimpleNamespace

spec = importlib.util.spec_from_file_location('backup', Path(__file__).with_name('backup.py'))
backup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backup)


class BackupTests(unittest.TestCase):
    def test_low_disk_space_does_not_stop_the_app(self):
        with tempfile.TemporaryDirectory() as d:
            calls = []
            def service(args, **kwargs):
                calls.append(args)
                return subprocess.CompletedProcess(args, 0)
            with patch.object(backup.shutil, 'disk_usage', return_value=SimpleNamespace(free=1)):
                with self.assertRaisesRegex(ValueError, 'free space'):
                    backup.snapshot(Path(d), Path(d) / 'backups', service)
            self.assertEqual(calls, [])

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

    def test_prune_keeps_fourteen_days_and_a_floor_of_recent_sets(self):
        from datetime import datetime, timedelta, timezone
        now = datetime(2026, 10, 30, 20, 30, tzinfo=timezone.utc)
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            def make(days, complete=True):
                stamp = (now - timedelta(days=days)).strftime('%Y%m%dT%H%M%S%fZ')
                suffixes = ['', '.sha256', '.json'] if complete else ['', '.sha256']
                for suffix in suffixes:
                    (root / f'{stamp}.tar.gz{suffix}').write_text('x')
                return stamp
            fresh = [make(day) for day in range(0, 20)]
            stale_partial = make(30, complete=False)
            (root / 'restore-check-old').mkdir()
            (root / 'notes.txt').write_text('keep')
            removed = backup.prune(root, now)
            self.assertEqual(sorted(removed), sorted(fresh[15:] + [stale_partial]))
            left = {p.name.split('.')[0] for p in root.glob('*.tar.gz')}
            self.assertEqual(left, set(fresh[:15]))
            self.assertTrue((root / 'restore-check-old').is_dir())
            self.assertTrue((root / 'notes.txt').exists())

    def test_prune_never_drops_below_the_floor(self):
        from datetime import datetime, timedelta, timezone
        now = datetime(2026, 10, 30, tzinfo=timezone.utc)
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            stamps = []
            for day in (40, 50, 60):
                stamp = (now - timedelta(days=day)).strftime('%Y%m%dT%H%M%S%fZ')
                for suffix in ('', '.sha256', '.json'):
                    (root / f'{stamp}.tar.gz{suffix}').write_text('x')
                stamps.append(stamp)
            self.assertEqual(backup.prune(root, now, keep_days=14, keep_min=2), [stamps[2]])
            self.assertEqual(len(list(root.glob('*.tar.gz'))), 2)


if __name__ == '__main__':
    unittest.main()

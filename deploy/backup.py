#!/usr/bin/env python3
"""Offline backups of the closed PGlite stand. Never restores the live database."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
from datetime import datetime, timezone

APP = Path('/opt/endurozone/app')
DEST = Path('/var/backups/endurozone')


def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as source:
        for block in iter(lambda: source.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def pack(data, archive):
    if not (data / 'postgres').is_dir():
        raise ValueError('PGlite directory not found')
    for path in [data, *data.rglob('*')]:
        if path.is_symlink() or not (path.is_dir() or path.is_file()):
            raise ValueError('Links and special files are not allowed')
    with tarfile.open(archive, 'w:gz') as target:
        target.add(data, arcname='.data')


def verify(archive):
    expected = archive.with_suffix(archive.suffix + '.sha256').read_text().strip()
    if len(expected) != 64 or digest(archive) != expected:
        raise ValueError('Archive checksum mismatch')
    count = 0
    database = False
    with tarfile.open(archive, 'r:gz') as source:
        for member in source:
            parts = member.name.split('/')
            if parts[0] != '.data' or any(p in ('..', '') for p in parts) or not (member.isfile() or member.isdir()):
                raise ValueError('Unsafe archive entry')
            database |= member.name == '.data/postgres'
            if member.isfile():
                with source.extractfile(member) as body:
                    while body.read(1024 * 1024):
                        pass
            count += 1
    if not database:
        raise ValueError('Database directory missing')
    return count


def snapshot(app, destination, service=subprocess.run):
    if app.is_symlink() or (app / '.data').is_symlink():
        raise ValueError('App and data must be real directories')
    destination.mkdir(parents=True, exist_ok=True, mode=0o700)
    if destination.is_symlink():
        raise ValueError('Backup directory must not be a link')
    destination.chmod(0o700)
    active = service(['systemctl', 'is-active', '--quiet', 'endurozone']).returncode == 0
    restart = False
    try:
        if active:
            restart = True
            service(['systemctl', 'stop', 'endurozone'], check=True)
        with tempfile.TemporaryDirectory(prefix='snapshot-', dir=destination) as staging:
            temp = Path(staging) / 'data.tar.gz'
            pack(app / '.data', temp)
            checksum = digest(temp)
            temp.with_suffix('.gz.sha256').write_text(checksum + '\n')
            verify(temp)
            version = service(['runuser', '-u', 'enduro', '--', 'git', '-C', str(app), 'rev-parse', 'HEAD'], capture_output=True, text=True, check=True).stdout.strip()
            stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
            final = destination / (stamp + '.tar.gz')
            # Metadata last: its presence marks a completed archive set.
            os.replace(temp, final)
            os.replace(temp.with_suffix('.gz.sha256'), final.with_suffix('.gz.sha256'))
            final.with_suffix('.gz.json').write_text(json.dumps({'created_at_utc': stamp, 'commit': version, 'storage': 'pglite', 'contains_private_data': True}) + '\n')
            for path in (final, final.with_suffix('.gz.sha256'), final.with_suffix('.gz.json')):
                path.chmod(0o600)
            return final
    finally:
        if restart:
            service(['systemctl', 'start', 'endurozone'], check=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['create', 'verify'])
    parser.add_argument('archive', nargs='?')
    args = parser.parse_args()
    if args.action == 'verify':
        if not args.archive:
            parser.error('verify requires an archive path')
        print('Verified entries:', verify(Path(args.archive)))
        return
    if sys.platform != 'linux' or os.geteuid() != 0:
        parser.error('create must run as root on the Linux stand')
    if args.archive:
        parser.error('create does not accept an archive path')
    config = Path('/etc/endurozone.env').read_text()
    if any(line.strip().startswith('DATABASE_URL=') and line.strip().split('=', 1)[1] for line in config.splitlines()):
        parser.error('PostgreSQL requires a separate pg_dump backup procedure')
    os.umask(0o077)
    import fcntl
    with open('/var/lock/endurozone-backup.lock', 'w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        print('Created private backup:', snapshot(APP, DEST))


if __name__ == '__main__':
    main()

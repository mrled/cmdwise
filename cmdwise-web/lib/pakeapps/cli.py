"""Generate a Pake app configuration and optionally build it."""

import argparse
import json
import os
from pathlib import Path
import subprocess
import shutil
import sys
from urllib.parse import urlsplit

SHORTCUTS = Path(__file__).resolve().with_name('shortcuts.js')
TITLEBAR = Path(__file__).resolve().with_name('titlebar.js')


def web_url(value):
    try:
        parsed = urlsplit(value)
        if parsed.scheme in ('http', 'https') and parsed.hostname:
            return value
    except ValueError:
        pass
    raise argparse.ArgumentTypeError('expected an http(s) URL with a hostname')


def positive_int(value):
    try:
        number = int(value)
        if number > 0:
            return number
    except ValueError:
        pass
    raise argparse.ArgumentTypeError('expected a positive integer')


def icon_path(value):
    if value.lower().startswith(('http://', 'https://')):
        return web_url(value)
    try:
        path = Path(value).expanduser().resolve()
        if path.is_file():
            return str(path)
    except OSError as exc:
        raise argparse.ArgumentTypeError(str(exc)) from exc
    raise argparse.ArgumentTypeError('icon must be a local file or an http(s) URL')


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('url', type=web_url)
    parser.add_argument('--name', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--generate-only', action='store_true')
    parser.add_argument('--force', action='store_true')
    parser.add_argument('--pake', help='Pake executable (default: pake on PATH, otherwise npx pake-cli)')
    parser.add_argument('--icon', type=icon_path)
    parser.add_argument('--width', type=positive_int)
    parser.add_argument('--height', type=positive_int)
    parser.add_argument('--targets', help='Packaging targets; implies --bundle on Linux')
    parser.add_argument('--bundle', action='store_true', help='Build Linux installers instead of a user-owned executable')
    parser.add_argument('--wayland-titlebar-workaround', action='store_true',
                        help='Refresh Linux titlebar buttons via a startup maximize/restore cycle')
    parser.add_argument('--identifier')
    parser.add_argument('--activation-shortcut')
    args = parser.parse_args(argv)
    if args.wayland_titlebar_workaround and not sys.platform.startswith('linux'):
        parser.error('--wayland-titlebar-workaround requires Linux')

    try:
        output = Path(args.output).expanduser().resolve()
        config_path = output / 'app.json'
        script_path = output / 'shortcuts.js'
        scripts = [(script_path, SHORTCUTS)]
        if args.wayland_titlebar_workaround:
            scripts.append((output / 'titlebar.js', TITLEBAR))
        for path in (config_path, *(path for path, _ in scripts)):
            if os.path.lexists(path):
                if path.is_dir() and not path.is_symlink():
                    parser.error(f'cannot replace directory: {path}')
                if not args.force:
                    parser.error(f'{path} already exists; use --force to replace generated files')
        script_contents = [(path, source.read_bytes()) for path, source in scripts]
        config = {
            'url': args.url,
            'name': args.name,
            'enableFind': True,
            'disabledWebShortcuts': True,
            'hideOnClose': False,
            'inject': [str(path) for path, _ in scripts],
        }
        if sys.platform.startswith('linux'):
            config['bundle'] = args.bundle or args.targets is not None
        for option, key in (
            ('icon', 'icon'), ('width', 'width'), ('height', 'height'),
            ('targets', 'targets'), ('identifier', 'identifier'),
            ('activation_shortcut', 'activationShortcut'),
        ):
            value = getattr(args, option)
            if value is not None:
                config[key] = value
        output.mkdir(parents=True, exist_ok=True)
        for path, content in [
            (config_path, (json.dumps(config, indent=2) + '\n').encode('utf-8')),
            *script_contents,
        ]:
            if args.force and os.path.lexists(path):
                path.unlink()
            with path.open('xb') as stream:
                stream.write(content)
    except OSError as exc:
        parser.error(f'cannot generate app files: {exc}')

    if args.generate_only:
        return 0
    if args.pake is None:
        command = ['pake'] if shutil.which('pake') else ['npx', 'pake-cli']
    else:
        executable = args.pake
        if os.path.dirname(executable):
            executable = str(Path(executable).expanduser().resolve())
        command = [executable]
    try:
        return subprocess.run(
            [*command, '--config', str(config_path), '--json'],
            cwd=str(output), check=False,
            **({'umask': 0o022} if os.name == 'posix' else {}),
        ).returncode
    except OSError as exc:
        parser.error(f'cannot run Pake command {command!r}: {exc}')

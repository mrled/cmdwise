import contextlib
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from pakeapps import cli


class CliTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source = self.root / 'source.js'
        self.source.write_text('// shortcut fixture\n', encoding='utf-8')
        self.output = self.root / 'output'
        self.args = ['https://example.com/path', '--name', 'Example',
                     '--output', str(self.output)]
        self.source_patch = patch.object(cli, 'SHORTCUTS', self.source)
        self.source_patch.start()
        self.addCleanup(self.source_patch.stop)
        self.which_patch = patch.object(cli.shutil, 'which', return_value='/usr/bin/pake')
        self.which_patch.start()
        self.addCleanup(self.which_patch.stop)
        self.platform_patch = patch.object(cli.sys, 'platform', 'linux')
        self.platform_patch.start()
        self.addCleanup(self.platform_patch.stop)

    def error(self, args):
        stderr = io.StringIO()
        with contextlib.redirect_stderr(stderr), self.assertRaises(SystemExit) as exc:
            cli.main(args)
        self.assertEqual(exc.exception.code, 2)
        self.assertNotIn('Traceback', stderr.getvalue())
        return stderr.getvalue()

    def test_generate_only(self):
        with patch.object(cli.subprocess, 'run') as run:
            self.assertEqual(cli.main(self.args + ['--generate-only']), 0)
        run.assert_not_called()
        config = json.loads((self.output / 'app.json').read_text())
        self.assertEqual(config, {
            'url': 'https://example.com/path', 'name': 'Example',
            'enableFind': True, 'disabledWebShortcuts': True,
            'hideOnClose': False, 'inject': [str(self.output / 'shortcuts.js')],
            'bundle': False,
        })
        self.assertEqual((self.output / 'shortcuts.js').read_bytes(), self.source.read_bytes())

    def test_default_build_and_exit_code(self):
        with patch.object(cli.subprocess, 'run', return_value=subprocess.CompletedProcess([], 17)) as run:
            self.assertEqual(cli.main(self.args), 17)
        run.assert_called_once_with(
            ['pake', '--config', str(self.output / 'app.json'), '--json'],
            cwd=str(self.output), check=False,
            **({'umask': 0o022} if os.name == 'posix' else {}))

    def test_missing_default_pake_uses_npx(self):
        with patch.object(cli.shutil, 'which', return_value=None) as which, \
                patch.object(cli.subprocess, 'run', return_value=subprocess.CompletedProcess([], 19)) as run:
            self.assertEqual(cli.main(self.args), 19)
        which.assert_called_once_with('pake')
        run.assert_called_once_with(
            ['npx', 'pake-cli', '--config', str(self.output / 'app.json'), '--json'],
            cwd=str(self.output), check=False,
            **({'umask': 0o022} if os.name == 'posix' else {}))

    def test_explicit_pake_does_not_fall_back(self):
        with patch.object(cli.shutil, 'which', return_value=None) as which, \
                patch.object(cli.subprocess, 'run', side_effect=FileNotFoundError('missing')) as run:
            self.error(self.args + ['--pake', 'custom-pake'])
        which.assert_not_called()
        self.assertEqual(run.call_args.args[0][0], 'custom-pake')
        self.assertEqual(run.call_count, 1)

    def test_optional_config_and_custom_executable(self):
        icon = self.root / 'icon.png'
        icon.write_bytes(b'icon')
        options = ['--icon', str(icon), '--width', '900', '--height', '600',
                   '--targets', 'app', '--identifier', 'org.example.app',
                   '--activation-shortcut', 'Alt+Space', '--pake', 'custom-pake']
        with patch.object(cli.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0)) as run:
            cli.main(self.args + options)
        self.assertEqual(run.call_args.args[0][0], 'custom-pake')
        config = json.loads((self.output / 'app.json').read_text())
        for key, value in {'icon': str(icon), 'width': 900, 'height': 600,
                           'targets': 'app', 'identifier': 'org.example.app',
                           'activationShortcut': 'Alt+Space'}.items():
            self.assertEqual(config[key], value)

    def test_linux_packaging_is_opt_in(self):
        for options in (['--bundle'], ['--targets', 'rpm']):
            with self.subTest(options=options):
                cli.main(self.args + ['--generate-only', '--force'] + options)
                config = json.loads((self.output / 'app.json').read_text())
                self.assertTrue(config['bundle'])

    def test_non_linux_keeps_native_packaging(self):
        with patch.object(cli.sys, 'platform', 'darwin'):
            cli.main(self.args + ['--generate-only'])
        config = json.loads((self.output / 'app.json').read_text())
        self.assertNotIn('bundle', config)

    def test_titlebar_workaround_injection_is_opt_in(self):
        cli.main(self.args + ['--generate-only', '--wayland-titlebar-workaround'])
        config = json.loads((self.output / 'app.json').read_text())
        self.assertEqual(config['inject'], [str(self.output / 'shortcuts.js'),
                                          str(self.output / 'titlebar.js')])
        self.assertEqual((self.output / 'titlebar.js').read_bytes(), cli.TITLEBAR.read_bytes())
        cli.main(self.args + ['--generate-only', '--force'])
        config = json.loads((self.output / 'app.json').read_text())
        self.assertEqual(config['inject'], [str(self.output / 'shortcuts.js')])

    def test_titlebar_workaround_existing_file_is_preserved(self):
        self.output.mkdir()
        existing = self.output / 'titlebar.js'
        existing.write_text('keep')
        self.error(self.args + ['--generate-only', '--wayland-titlebar-workaround'])
        self.assertEqual(existing.read_text(), 'keep')
        self.assertFalse((self.output / 'app.json').exists())

    def test_titlebar_workaround_requires_linux(self):
        with patch.object(cli.sys, 'platform', 'darwin'):
            self.error(self.args + ['--generate-only', '--wayland-titlebar-workaround'])
        self.assertFalse(self.output.exists())

    def test_url_icon_and_relative_paths(self):
        args = self.args[:-1] + [os.path.relpath(self.output)]
        with patch.object(cli.subprocess, 'run'):
            cli.main(args + ['--generate-only', '--icon', 'https://example.com/icon.png'])
        config = json.loads((self.output / 'app.json').read_text())
        self.assertEqual(config['icon'], 'https://example.com/icon.png')
        self.assertEqual(config['inject'], [str(self.output / 'shortcuts.js')])

    def test_relative_icon_and_executable_resolve_before_build(self):
        icon = self.root / 'icon.png'
        icon.write_bytes(b'icon')
        executable = self.root / 'pake'
        with patch.object(cli.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0)) as run:
            cli.main(self.args + ['--icon', os.path.relpath(icon),
                                  '--pake', os.path.relpath(executable)])
        self.assertEqual(run.call_args.args[0][0], str(executable))
        config = json.loads((self.output / 'app.json').read_text())
        self.assertEqual(config['icon'], str(icon))

    def test_required_and_invalid_arguments(self):
        for args in [[], self.args[:1], self.args[:-2],
                     ['file:///tmp/x'] + self.args[1:],
                     ['https:///path'] + self.args[1:],
                     ['https://[broken'] + self.args[1:]]:
            with self.subTest(args=args):
                self.error(args)
        for flag, value in [('--width', '0'), ('--height', '-1'),
                            ('--width', 'nan'), ('--icon', '/missing/icon.png')]:
            with self.subTest(flag=flag, value=value):
                self.error(self.args + [flag, value])
        self.assertFalse(self.output.exists())

    def test_existing_files_are_preserved_without_force(self):
        self.output.mkdir()
        for name in ['app.json', 'shortcuts.js']:
            with self.subTest(name=name):
                existing = self.output / name
                existing.write_text('keep')
                self.assertIn('--force', self.error(self.args + ['--generate-only']))
                self.assertEqual(existing.read_text(), 'keep')
                self.assertEqual(list(self.output.iterdir()), [existing])
                existing.unlink()

    def test_force_replaces_only_generated_files_and_not_symlink_targets(self):
        self.output.mkdir()
        unrelated = self.output / 'keep.txt'
        unrelated.write_text('keep')
        victim = self.root / 'victim'
        victim.write_text('keep')
        (self.output / 'app.json').symlink_to(victim)
        (self.output / 'shortcuts.js').write_text('old')
        cli.main(self.args + ['--generate-only', '--force'])
        self.assertFalse((self.output / 'app.json').is_symlink())
        self.assertEqual(victim.read_text(), 'keep')
        self.assertEqual(unrelated.read_text(), 'keep')

    def test_broken_symlink_is_existing(self):
        self.output.mkdir()
        (self.output / 'shortcuts.js').symlink_to(self.root / 'missing')
        self.error(self.args + ['--generate-only'])
        self.assertFalse((self.output / 'app.json').exists())

    def test_directory_cannot_be_replaced(self):
        (self.output / 'shortcuts.js').mkdir(parents=True)
        self.error(self.args + ['--generate-only', '--force'])
        self.assertFalse((self.output / 'app.json').exists())

    def test_friendly_process_errors(self):
        for error in [FileNotFoundError('missing'), PermissionError('denied')]:
            with self.subTest(error=error), patch.object(cli.subprocess, 'run', side_effect=error):
                message = self.error(self.args + ['--force'])
                self.assertIn('pake', message)

    def test_friendly_filesystem_errors(self):
        self.source.unlink()
        self.error(self.args + ['--generate-only'])


if __name__ == '__main__':
    unittest.main()

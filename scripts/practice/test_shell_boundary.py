"""Recipe output must not depend on an SSH operator's shell startup files."""
import importlib.util
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('practice_runner', Path(__file__).with_name('runner.py'))
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


@unittest.skipUnless(os.name == 'posix', 'The real recipe shell is tested on Linux')
class ShellBoundary(unittest.TestCase):
    def execute(self, environment):
        with tempfile.TemporaryDirectory(prefix='mayak-shell-boundary-') as folder:
            path = Path(folder)
            (path / 'work').mkdir()
            state = {'attempt': 'a' * 32, 'variant': 0, 'user': 'nobody'}
            with patch.dict(os.environ, environment, clear=True):
                return runner.execute("printf 'recipe result\\n'", path, state)

    def test_operator_startup_file_does_not_run_in_a_recipe(self):
        with tempfile.TemporaryDirectory(prefix='mayak-profile-') as folder:
            profile = Path(folder) / 'startup.sh'
            profile.write_text("printf 'operator profile\\n'\n", encoding='utf-8')
            result = self.execute({'PATH': os.environ['PATH'], 'BASH_ENV': str(profile), 'ENV': str(profile), 'SHLVL': '3'})
            self.assertEqual(result.returncode, 0)
            self.assertEqual(result.stdout, 'recipe result\n')
            self.assertEqual(result.stderr, '')

    def test_ssh_session_does_not_source_interactive_profiles(self):
        result = self.execute({'PATH': os.environ['PATH'], 'SSH_CLIENT': '127.0.0.1 12345 22', 'SHLVL': '0'})
        self.assertEqual(result.returncode, 0)
        self.assertEqual(result.stdout, 'recipe result\n')
        self.assertEqual(result.stderr, '')


if __name__ == '__main__':
    unittest.main(verbosity=2)

"""A pipeline that exists but imports a module that does not.

The operator CLI must report it as present-but-unloadable, not as unknown.
"""

import no_such_dependency_for_cli_tests  # noqa: F401


def run(context):
    return None

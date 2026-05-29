"""Root conftest.

Its presence puts the repository root on ``sys.path`` (pytest prepend import
mode), which is exactly how pipelines import the framework in production: the
package is on the path, never pip-installed.
"""

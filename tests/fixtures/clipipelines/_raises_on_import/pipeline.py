"""A pipeline whose top level raises while it is imported."""

SETTINGS: dict[str, str] = {}
SOURCE_DIR = SETTINGS["source_dir"]


def run(context):
    return None

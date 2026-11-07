import re

import app.main as main
from app.config import settings

UPLOAD_FOLDERS = {folder.relative_to(settings.data_dir).as_posix() for folder in settings.upload_dirs}


def test_every_upload_folder_is_ignored_and_backed_up():
    lines = lambda name: set((main.BASE_DIR.parent / name).read_text().splitlines())
    rsync = next(line for line in lines("deploy/backup.sh") if line.rstrip().endswith('"$NAS_DIR/files/"'))
    assert set(re.findall(r"data/(\w+)", rsync)) == UPLOAD_FOLDERS
    for ignore in (".gitignore", ".dockerignore"):
        assert {f"data/{folder}/" for folder in UPLOAD_FOLDERS} - lines(ignore) == set(), ignore

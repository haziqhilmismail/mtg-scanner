import re

import app.main as main
from app.config import DATA_DIR, Settings
from app.routers import orders, payment, posts

UPLOAD_FOLDERS = {folder.relative_to(DATA_DIR).as_posix() for folder in (
    main.SCANS_DIR, posts.POSTS_DIR, orders.ORDERS_PHOTO_DIR, payment.QR_DIR,
    Settings.model_fields["corrections_dir"].default,
)}


def test_every_upload_folder_is_ignored_and_backed_up():
    lines = lambda name: set((main.BASE_DIR.parent / name).read_text().splitlines())
    rsync = next(line for line in lines("deploy/backup.sh") if line.rstrip().endswith('"$NAS_DIR/files/"'))
    assert set(re.findall(r"data/(\w+)", rsync)) == UPLOAD_FOLDERS
    for ignore in (".gitignore", ".dockerignore"):
        assert {f"data/{folder}/" for folder in UPLOAD_FOLDERS} - lines(ignore) == set(), ignore

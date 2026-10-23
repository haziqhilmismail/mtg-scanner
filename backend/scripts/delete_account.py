"""
delete_account.py
-----------------
Delete a user's account when they ask (PRIVACY.md: done within 30 days).
Everything of theirs goes; their sales records stay with no link back to them.
Run it where the app's database is: on the home server, inside the container.

    docker exec mtg-scanner-backend python scripts/delete_account.py --email someone@gmail.com
    docker exec mtg-scanner-backend python scripts/delete_account.py --email someone@gmail.com --yes

Without --yes it only shows what would go, and changes nothing.
"""

import argparse
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import func, select  # noqa: E402

from app.db import async_session_factory  # noqa: E402
from app.models import User  # noqa: E402
from app.services.accounts import delete_account  # noqa: E402


async def main(email: str, yes: bool) -> int:
    async with async_session_factory() as db:
        user = await db.scalar(select(User).where(func.lower(User.email) == email.strip().lower()))
        if user is None:
            print(f"No account for {email}", file=sys.stderr)
            return 1
        counts, files = await delete_account(db, user.id)
        for name, n in counts.items():
            print(f"{n:6}  {name}")
        print(f"{len(files):6}  files")
        if not yes:
            await db.rollback()
            print("\nDry run: nothing changed. Add --yes to delete.")
            return 0
        await db.commit()
    for f in files:
        Path(f).unlink(missing_ok=True)
    print(f"\nDeleted account {user.id} ({email}).")
    return 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--email", required=True)
    ap.add_argument("--yes", action="store_true", help="really delete (default: dry run)")
    a = ap.parse_args()
    sys.exit(asyncio.run(main(a.email, a.yes)))

"""
make_voucher.py
---------------
Create a voucher code. Run it where the app's database is — on the home
server that means inside the container:

    docker exec mtg-scanner-backend python scripts/make_voucher.py --credits 20
    docker exec mtg-scanner-backend python scripts/make_voucher.py --unlimited --days 30 --max-uses 5
    docker exec mtg-scanner-backend python scripts/make_voucher.py --unlimited --redeem-for you@example.com

--redeem-for creates the voucher and applies it to that account straight
away, which is how the owner's own bypass is set up.
"""

import argparse
import asyncio
import sys
from datetime import timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import select  # noqa: E402

from app.db import async_session_factory  # noqa: E402
from app.models import User, Voucher  # noqa: E402
from app.services import credits  # noqa: E402


async def main(args) -> int:
    if not args.credits and not args.unlimited:
        print("Nothing to grant: pass --credits N and/or --unlimited", file=sys.stderr)
        return 2
    now = credits._now()
    code = credits.new_code()
    async with async_session_factory() as s:
        voucher = Voucher(
            code=credits.normalise_code(code),
            credits=args.credits,
            unlimited=args.unlimited,
            unlimited_days=args.days if args.unlimited else None,
            max_uses=args.max_uses,
            expires_at=now + timedelta(days=args.expires_in_days) if args.expires_in_days else None,
            note=args.note,
            created_at=now,
        )
        s.add(voucher)
        await s.flush()
        if args.redeem_for:
            user = await s.scalar(select(User).where(User.email == args.redeem_for))
            if user is None:
                print(f"No user with email {args.redeem_for}", file=sys.stderr)
                return 1
            await credits.redeem(s, user.id, code)
        await s.commit()

    what = []
    if args.credits:
        what.append(f"{args.credits} extra scans")
    if args.unlimited:
        what.append("unlimited scans " + (f"for {args.days} days" if args.days else "forever"))
    print(f"{code}  —  {' + '.join(what)}, {args.max_uses} use(s)"
          + (f", redeemed for {args.redeem_for}" if args.redeem_for else ""))
    return 0


if __name__ == "__main__":
    p = argparse.ArgumentParser(description="Create a scan-credit voucher")
    p.add_argument("--credits", type=int, default=0, help="extra scans that don't expire")
    p.add_argument("--unlimited", action="store_true", help="switch the scan limit off")
    p.add_argument("--days", type=int, default=None, help="with --unlimited: how long (default forever)")
    p.add_argument("--max-uses", type=int, default=1, help="how many accounts can redeem it")
    p.add_argument("--expires-in-days", type=int, default=None, help="code stops working after this")
    p.add_argument("--note", default=None)
    p.add_argument("--redeem-for", metavar="EMAIL", default=None, help="apply it to this account now")
    sys.exit(asyncio.run(main(p.parse_args())))

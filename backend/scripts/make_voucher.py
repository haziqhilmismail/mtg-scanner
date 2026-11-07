"""
make_voucher.py
---------------
Create a voucher code. Run it where the app's database is — on the home
server that means inside the container:

    docker exec mtg-scanner-backend python scripts/make_voucher.py --credits 20
    docker exec mtg-scanner-backend python scripts/make_voucher.py --unlimited --days 30 --max-uses 5
    docker exec mtg-scanner-backend python scripts/make_voucher.py --unlimited --redeem-for you@example.com

A pair for testing on your own account — both can be typed in as often as you
like, and nobody else can use them:

    ... make_voucher.py --unlimited --reusable --only-for you@example.com
    ... make_voucher.py --reset     --reusable --only-for you@example.com

--redeem-for creates the voucher and applies it to that account straight
away, which is how the owner's own bypass is set up.
"""

import argparse
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.db import async_session_factory  # noqa: E402
from app.services import credits  # noqa: E402
from app.services.accounts import user_by_email  # noqa: E402


async def main(args) -> int:
    async with async_session_factory() as s:
        only_user_id = None
        if args.only_for:
            user = await user_by_email(s, args.only_for)
            if user is None:
                print(f"No user with email {args.only_for}", file=sys.stderr)
                return 1
            only_user_id = user.id
        try:
            code = await credits.create_voucher(
                s, credits=args.credits, unlimited=args.unlimited, unlimited_days=args.days,
                resets=args.reset, reusable=args.reusable, only_user_id=only_user_id,
                max_uses=args.max_uses, expires_in_days=args.expires_in_days, note=args.note,
            )
        except ValueError as e:
            print(e, file=sys.stderr)
            return 2
        if args.redeem_for:
            user = await user_by_email(s, args.redeem_for)
            if user is None:
                print(f"No user with email {args.redeem_for}", file=sys.stderr)
                return 1
            await credits.redeem(s, user.id, code)
        await s.commit()

    what = []
    if args.reset:
        what.append("back to the standard limit with nothing used")
    if args.credits:
        what.append(f"{args.credits} extra scans")
    if args.unlimited:
        what.append("unlimited scans " + (f"for {args.days} days" if args.days else "forever"))
    uses = "reusable" if args.reusable else f"{args.max_uses} use(s)"
    if args.only_for:
        uses += f", only for {args.only_for}"
    print(f"{code}  —  {' + '.join(what)}, {uses}"
          + (f", redeemed for {args.redeem_for}" if args.redeem_for else ""))
    return 0


if __name__ == "__main__":
    p = argparse.ArgumentParser(description="Create a scan-credit voucher")
    p.add_argument("--credits", type=int, default=0, help="extra scans that don't expire")
    p.add_argument("--unlimited", action="store_true", help="switch the scan limit off")
    p.add_argument("--days", type=int, default=None, help="with --unlimited: how long (default forever)")
    p.add_argument("--reset", action="store_true",
                   help="put the account back on the standard limit with nothing used")
    p.add_argument("--reusable", action="store_true", help="the same account can redeem it repeatedly")
    p.add_argument("--only-for", metavar="EMAIL", default=None, help="nobody else can redeem it")
    p.add_argument("--max-uses", type=int, default=1, help="how many accounts can redeem it")
    p.add_argument("--expires-in-days", type=int, default=None, help="code stops working after this")
    p.add_argument("--note", default=None)
    p.add_argument("--redeem-for", metavar="EMAIL", default=None, help="apply it to this account now")
    sys.exit(asyncio.run(main(p.parse_args())))

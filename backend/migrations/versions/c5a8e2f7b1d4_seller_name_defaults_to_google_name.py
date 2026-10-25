"""seller name defaults to the Google name

Revision ID: c5a8e2f7b1d4
Revises: b9d4f2a6c8e1
Create Date: 2026-10-25 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'c5a8e2f7b1d4'
down_revision: Union[str, Sequence[str], None] = 'b9d4f2a6c8e1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # users.fb_name is now only a name the seller set; null means their Google
    # name. Sign-up copied the Google name into it, and solo mode put "Me".
    op.execute("UPDATE users SET fb_name = NULL WHERE fb_name = 'Me' OR fb_name = name")


def downgrade() -> None:
    """Downgrade schema."""
    # Nothing to undo: User.seller_name reads a null as the Google name.

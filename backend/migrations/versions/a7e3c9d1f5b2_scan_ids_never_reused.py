"""scan ids are never reused

Without AUTOINCREMENT, SQLite gives a new row max(id) + 1, so deleting the
newest scan hands its id to the next upload.

Revision ID: a7e3c9d1f5b2
Revises: d4a9e2f7c1b3
Create Date: 2026-10-24 09:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'a7e3c9d1f5b2'
down_revision: Union[str, Sequence[str], None] = 'd4a9e2f7c1b3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # SQLite can only add AUTOINCREMENT by rebuilding the table; ids are kept,
    # and SQLite starts the sequence after the highest one copied in.
    with op.batch_alter_table('scans', recreate='always', table_kwargs={'sqlite_autoincrement': True}):
        pass


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table('scans', recreate='always', table_kwargs={'sqlite_autoincrement': False}):
        pass

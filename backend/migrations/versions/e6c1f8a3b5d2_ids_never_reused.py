"""users, posts and order items never reuse an id

Without AUTOINCREMENT, SQLite gives a new row max(id) + 1, so deleting the
newest row hands its id to the next one. A deleted account's still-valid
session token would then belong to the next sign-up, and a sales record's
link would point at someone else's post or order line.

Revision ID: e6c1f8a3b5d2
Revises: c2f6a8d4e1b7
Create Date: 2026-10-23 22:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'e6c1f8a3b5d2'
down_revision: Union[str, Sequence[str], None] = 'c2f6a8d4e1b7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLES = ('users', 'posts', 'order_items')


def upgrade() -> None:
    """Upgrade schema."""
    # SQLite can only add AUTOINCREMENT by rebuilding the table; ids are kept,
    # and SQLite starts the sequence after the highest one copied in.
    for table in TABLES:
        with op.batch_alter_table(table, recreate='always', table_kwargs={'sqlite_autoincrement': True}):
            pass


def downgrade() -> None:
    """Downgrade schema."""
    for table in TABLES:
        with op.batch_alter_table(table, recreate='always', table_kwargs={'sqlite_autoincrement': False}):
            pass

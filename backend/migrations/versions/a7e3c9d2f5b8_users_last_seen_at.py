"""users.last_seen_at

Revision ID: a7e3c9d2f5b8
Revises: c5a8e2f7b1d4
Create Date: 2026-10-28 12:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'a7e3c9d2f5b8'
down_revision: Union[str, Sequence[str], None] = 'c5a8e2f7b1d4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# No visit history exists, so a user's newest activity stands in for it.
ACTIVITY = (
    ("scans", "updated_at"), ("posts", "updated_at"), ("orders", "updated_at"),
    ("listings", "updated_at"), ("buyers", "updated_at"), ("scan_credit_events", "created_at"),
)


def upgrade() -> None:
    """Upgrade schema."""
    with op.batch_alter_table("users") as batch:
        batch.add_column(sa.Column("last_seen_at", sa.DateTime(), nullable=True))
    newest = ", ".join(
        f"coalesce((SELECT max({col}) FROM {table} WHERE user_id = users.id), '')" for table, col in ACTIVITY
    )
    op.execute(f"UPDATE users SET last_seen_at = max(updated_at, {newest})")


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table("users") as batch:
        batch.drop_column("last_seen_at")

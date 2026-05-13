"""add order archived_at column

Revision ID: 44c6bd0161b2
Revises: 75181f2bcafb
Create Date: 2026-05-13 15:49:05.976987

Done orders that are no longer interesting on the day-to-day kanban can be
archived. The kanban filters them out by default; an opt-in
`include_archived=true` query surfaces them for the Archived section UI.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "44c6bd0161b2"
down_revision: Union[str, Sequence[str], None] = "75181f2bcafb"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("orders", sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("orders", "archived_at")

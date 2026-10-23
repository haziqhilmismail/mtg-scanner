"""per-card edits stored on the scan

Revision ID: e5b8a2d71c39
Revises: d9a3b6c2e7f4
Create Date: 2026-10-14 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e5b8a2d71c39'
down_revision: Union[str, Sequence[str], None] = 'd9a3b6c2e7f4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Nullable, no default: a plain ADD COLUMN, which SQLite does in place.
    op.add_column('scans', sa.Column('ui_state', sa.JSON(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table('scans') as batch:
        batch.drop_column('ui_state')

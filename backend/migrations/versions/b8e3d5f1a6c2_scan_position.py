"""scan position in its post

Revision ID: b8e3d5f1a6c2
Revises: a1f4c7e9d2b6
Create Date: 2026-10-23 15:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b8e3d5f1a6c2'
down_revision: Union[str, Sequence[str], None] = 'a1f4c7e9d2b6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Nullable, no default: a plain ADD COLUMN, which SQLite does in place.
    op.add_column('scans', sa.Column('position', sa.Integer(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table('scans') as batch:
        batch.drop_column('position')

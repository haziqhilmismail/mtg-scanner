"""pricing settings on posts and users

Revision ID: f3c7a1d9b8e2
Revises: e5b8a2d71c39
Create Date: 2026-10-14 18:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f3c7a1d9b8e2'
down_revision: Union[str, Sequence[str], None] = 'e5b8a2d71c39'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Nullable, no default: plain ADD COLUMNs, which SQLite does in place.
    op.add_column('posts', sa.Column('pricing', sa.JSON(), nullable=True))
    op.add_column('users', sa.Column('pricing', sa.JSON(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table('users') as batch:
        batch.drop_column('pricing')
    with op.batch_alter_table('posts') as batch:
        batch.drop_column('pricing')

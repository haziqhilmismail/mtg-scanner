"""payment note on users

Revision ID: a1f4c7e9d2b6
Revises: f3c7a1d9b8e2
Create Date: 2026-10-23 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a1f4c7e9d2b6'
down_revision: Union[str, Sequence[str], None] = 'f3c7a1d9b8e2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Nullable, no default: plain ADD COLUMNs, which SQLite does in place.
    op.add_column('users', sa.Column('payment_note', sa.String(length=500), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table('users') as batch:
        batch.drop_column('payment_note')

"""when an order's prices were sent to the buyer

Revision ID: c2f6a8d4e1b7
Revises: b8e3d5f1a6c2
Create Date: 2026-10-23 16:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c2f6a8d4e1b7'
down_revision: Union[str, Sequence[str], None] = 'b8e3d5f1a6c2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Nullable, no default: a plain ADD COLUMN, which SQLite does in place.
    op.add_column('orders', sa.Column('prices_sent_at', sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table('orders') as batch:
        batch.drop_column('prices_sent_at')

"""voucher reset, reusable and owner-bound flags

Revision ID: c4e8f1a6d2b5
Revises: b7d2e9a4c1f3
Create Date: 2026-10-13 17:05:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c4e8f1a6d2b5'
down_revision: Union[str, Sequence[str], None] = 'b7d2e9a4c1f3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('vouchers', sa.Column('resets', sa.Boolean(), server_default='0', nullable=False))
    op.add_column('vouchers', sa.Column('reusable', sa.Boolean(), server_default='0', nullable=False))
    # No FK constraint in the DDL: SQLite can't add one to an existing table
    # without rebuilding it, and the app enforces the binding itself.
    op.add_column('vouchers', sa.Column('only_user_id', sa.Integer(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('vouchers', 'only_user_id')
    op.drop_column('vouchers', 'reusable')
    op.drop_column('vouchers', 'resets')

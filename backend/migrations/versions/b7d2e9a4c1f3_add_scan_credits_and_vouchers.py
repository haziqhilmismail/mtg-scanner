"""add scan credits and vouchers

Revision ID: b7d2e9a4c1f3
Revises: 60df26389748
Create Date: 2026-10-13 16:10:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b7d2e9a4c1f3'
down_revision: Union[str, Sequence[str], None] = '60df26389748'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('users', sa.Column('bonus_scan_credits', sa.Integer(), server_default='0', nullable=False))
    op.add_column('users', sa.Column('unlimited_scans_until', sa.DateTime(), nullable=True))
    op.create_table('scan_credit_events',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_scan_credit_events_user_id'), 'scan_credit_events', ['user_id'], unique=False)
    op.create_index(op.f('ix_scan_credit_events_created_at'), 'scan_credit_events', ['created_at'], unique=False)
    op.create_table('vouchers',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('code', sa.String(length=32), nullable=False),
    sa.Column('credits', sa.Integer(), server_default='0', nullable=False),
    sa.Column('unlimited', sa.Boolean(), server_default='0', nullable=False),
    sa.Column('unlimited_days', sa.Integer(), nullable=True),
    sa.Column('max_uses', sa.Integer(), server_default='1', nullable=False),
    sa.Column('used_count', sa.Integer(), server_default='0', nullable=False),
    sa.Column('expires_at', sa.DateTime(), nullable=True),
    sa.Column('note', sa.String(length=255), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_vouchers_code'), 'vouchers', ['code'], unique=True)
    op.create_table('voucher_redemptions',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('voucher_id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['voucher_id'], ['vouchers.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('voucher_id', 'user_id')
    )
    op.create_index(op.f('ix_voucher_redemptions_user_id'), 'voucher_redemptions', ['user_id'], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f('ix_voucher_redemptions_user_id'), table_name='voucher_redemptions')
    op.drop_table('voucher_redemptions')
    op.drop_index(op.f('ix_vouchers_code'), table_name='vouchers')
    op.drop_table('vouchers')
    op.drop_index(op.f('ix_scan_credit_events_created_at'), table_name='scan_credit_events')
    op.drop_index(op.f('ix_scan_credit_events_user_id'), table_name='scan_credit_events')
    op.drop_table('scan_credit_events')
    op.drop_column('users', 'unlimited_scans_until')
    op.drop_column('users', 'bonus_scan_credits')

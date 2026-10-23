"""sales records: what each card line was sold for

Revision ID: d4a9e2f7c1b3
Revises: e6c1f8a3b5d2
Create Date: 2026-10-23 21:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd4a9e2f7c1b3'
down_revision: Union[str, Sequence[str], None] = 'e6c1f8a3b5d2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'sale_records',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('recorded_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('schema_version', sa.SmallInteger(), nullable=False),
        sa.Column('channel', sa.String(8), nullable=False),
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('post_id', sa.Integer(), sa.ForeignKey('posts.id', ondelete='SET NULL'), nullable=True),
        sa.Column('order_item_id', sa.Integer(), sa.ForeignKey('order_items.id', ondelete='SET NULL'), nullable=True),
        sa.Column('line_seq', sa.SmallInteger(), nullable=False),
        sa.Column('order_status', sa.String(16), nullable=True),
        sa.Column('paid', sa.Boolean(), nullable=True),
        sa.Column('scryfall_id', sa.String(64), nullable=True),
        sa.Column('card_name', sa.String(255), nullable=False),
        sa.Column('set_code', sa.String(16), nullable=True),
        sa.Column('set_name', sa.String(255), nullable=True),
        sa.Column('collector_number', sa.String(16), nullable=True),
        sa.Column('rarity', sa.String(16), nullable=True),
        sa.Column('is_foil', sa.Boolean(), nullable=False),
        sa.Column('qty', sa.Integer(), nullable=False),
        sa.Column('unit_price_myr', sa.Numeric(10, 2), nullable=False),
        sa.Column('post_type', sa.String(8), nullable=True),
        sa.Column('price_kind', sa.String(8), nullable=True),
        sa.Column('app_usd', sa.Numeric(10, 2), nullable=True),
        sa.Column('app_mult', sa.Numeric(6, 3), nullable=True),
        sa.Column('ck_retail_usd', sa.Numeric(10, 2), nullable=True),
        sa.Column('ck_buy_usd', sa.Numeric(10, 2), nullable=True),
        sa.Column('ck_as_of', sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint('order_item_id', 'line_seq', name='uq_sale_records_line_seq'),
    )
    op.create_index('ix_sale_records_recorded_at', 'sale_records', ['recorded_at'])
    op.create_index('ix_sale_records_user_id', 'sale_records', ['user_id'])
    op.create_index('ix_sale_records_card_time', 'sale_records', ['scryfall_id', 'is_foil', 'recorded_at'])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table('sale_records')

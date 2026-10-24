"""card corrections: the printing a seller says a card is, with its crop and the scanner's guess

Revision ID: b9d4f2a6c8e1
Revises: a7e3c9d1f5b2
Create Date: 2026-10-24 09:10:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b9d4f2a6c8e1'
down_revision: Union[str, Sequence[str], None] = 'a7e3c9d1f5b2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'card_corrections',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
        sa.Column('crop_version', sa.SmallInteger(), nullable=False),
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('scan_id', sa.Integer(), nullable=True),
        sa.Column('card_id', sa.Integer(), nullable=False),
        sa.Column('crop_file', sa.String(40), nullable=False),
        sa.Column('bbox_source', sa.String(12), nullable=False),
        sa.Column('guess_name', sa.String(255), nullable=True),
        sa.Column('guess_set_code', sa.String(16), nullable=True),
        sa.Column('guess_collector_number', sa.String(16), nullable=True),
        sa.Column('name_source', sa.String(16), nullable=True),
        sa.Column('version_source', sa.String(16), nullable=True),
        sa.Column('name_confidence', sa.Float(), nullable=True),
        sa.Column('scryfall_id', sa.String(36), nullable=False),
        sa.Column('kind', sa.String(8), nullable=False),
        sa.UniqueConstraint('scan_id', 'card_id', name='uq_card_corrections_scan_card'),
        sqlite_autoincrement=True,
    )
    op.create_index('ix_card_corrections_user_id', 'card_corrections', ['user_id'])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table('card_corrections')

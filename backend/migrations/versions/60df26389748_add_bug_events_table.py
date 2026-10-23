"""add bug_events table

Revision ID: 60df26389748
Revises: 44c6bd0161b2
Create Date: 2026-05-14 15:02:14.170763

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '60df26389748'
down_revision: Union[str, Sequence[str], None] = '44c6bd0161b2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table('bug_events',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=True),
    sa.Column('source', sa.String(length=16), nullable=False),
    sa.Column('fingerprint', sa.String(length=40), nullable=False),
    sa.Column('route', sa.String(length=512), nullable=True),
    sa.Column('method', sa.String(length=8), nullable=True),
    sa.Column('status_code', sa.Integer(), nullable=True),
    sa.Column('exception_type', sa.String(length=128), nullable=False),
    sa.Column('message', sa.Text(), nullable=False),
    sa.Column('stack', sa.Text(), nullable=True),
    sa.Column('user_agent', sa.String(length=512), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_bug_events_fingerprint'), 'bug_events', ['fingerprint'], unique=False)
    op.create_index(op.f('ix_bug_events_user_id'), 'bug_events', ['user_id'], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f('ix_bug_events_user_id'), table_name='bug_events')
    op.drop_index(op.f('ix_bug_events_fingerprint'), table_name='bug_events')
    op.drop_table('bug_events')

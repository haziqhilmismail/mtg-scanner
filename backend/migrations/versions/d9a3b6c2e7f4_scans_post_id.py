"""file scans under posts

Revision ID: d9a3b6c2e7f4
Revises: c4e8f1a6d2b5
Create Date: 2026-10-13 18:40:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd9a3b6c2e7f4'
down_revision: Union[str, Sequence[str], None] = 'c4e8f1a6d2b5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Existing scans stay NULL (unfiled). No FK in the DDL: SQLite can't add
    # one to an existing table without a rebuild; the app unfiles a post's
    # scans itself when the post is deleted.
    op.add_column('scans', sa.Column('post_id', sa.Integer(), nullable=True))
    op.create_index(op.f('ix_scans_post_id'), 'scans', ['post_id'], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f('ix_scans_post_id'), table_name='scans')
    op.drop_column('scans', 'post_id')

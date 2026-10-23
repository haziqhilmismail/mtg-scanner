"""add posts table and listings.post_id

Revision ID: 8a7c2f10b3a4
Revises: 129e40a96439
Create Date: 2026-05-11 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '8a7c2f10b3a4'
down_revision: Union[str, Sequence[str], None] = '129e40a96439'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'posts',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('title', sa.String(length=255), nullable=True),
        sa.Column('fb_url', sa.String(length=512), nullable=True),
        sa.Column('note', sa.Text(), nullable=True),
        sa.Column('image_path', sa.String(length=512), nullable=True),
        sa.Column('image_mime', sa.String(length=64), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_posts_user_id'), 'posts', ['user_id'], unique=False)

    # SQLite: use batch_alter_table to add a column with a foreign key.
    with op.batch_alter_table('listings') as batch_op:
        batch_op.add_column(sa.Column('post_id', sa.Integer(), nullable=True))
        batch_op.create_index('ix_listings_post_id', ['post_id'], unique=False)
        batch_op.create_foreign_key(
            'fk_listings_post_id_posts',
            'posts',
            ['post_id'],
            ['id'],
            ondelete='SET NULL',
        )


def downgrade() -> None:
    with op.batch_alter_table('listings') as batch_op:
        batch_op.drop_constraint('fk_listings_post_id_posts', type_='foreignkey')
        batch_op.drop_index('ix_listings_post_id')
        batch_op.drop_column('post_id')

    op.drop_index(op.f('ix_posts_user_id'), table_name='posts')
    op.drop_table('posts')

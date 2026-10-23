"""many-to-many listings/posts + post status

Revision ID: 9b3f5c81d4e2
Revises: 8a7c2f10b3a4
Create Date: 2026-05-11 16:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '9b3f5c81d4e2'
down_revision: Union[str, Sequence[str], None] = '8a7c2f10b3a4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # posts.status: 'active' | 'inactive' | 'archived'. Default 'active' so
    # existing rows light up in selectors after the migration.
    with op.batch_alter_table('posts') as batch_op:
        batch_op.add_column(
            sa.Column('status', sa.String(length=16), nullable=False, server_default='active'),
        )

    # Join table for the many-to-many. CASCADE on both sides — deleting a
    # listing or a post unlinks the row but doesn't touch the other side.
    op.create_table(
        'listing_post_links',
        sa.Column('listing_id', sa.Integer(), nullable=False),
        sa.Column('post_id', sa.Integer(), nullable=False),
        sa.Column(
            'created_at',
            sa.DateTime(timezone=True),
            server_default=sa.text('(CURRENT_TIMESTAMP)'),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(['listing_id'], ['listings.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['post_id'], ['posts.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('listing_id', 'post_id'),
    )
    op.create_index('ix_listing_post_links_post_id', 'listing_post_links', ['post_id'])

    # Backfill: every (listing.id, listing.post_id) becomes a link row
    op.execute(
        'INSERT INTO listing_post_links (listing_id, post_id) '
        'SELECT id, post_id FROM listings WHERE post_id IS NOT NULL'
    )

    # Drop the old single-FK column. SQLite needs batch_alter_table.
    with op.batch_alter_table('listings') as batch_op:
        batch_op.drop_constraint('fk_listings_post_id_posts', type_='foreignkey')
        batch_op.drop_index('ix_listings_post_id')
        batch_op.drop_column('post_id')


def downgrade() -> None:
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

    # Restore single-post via "first link wins" — lossy if a listing was
    # linked to multiple posts, but the only way to reverse a M:N to single FK.
    op.execute(
        'UPDATE listings SET post_id = ('
        'SELECT post_id FROM listing_post_links WHERE listing_id = listings.id LIMIT 1)'
    )

    op.drop_index('ix_listing_post_links_post_id', table_name='listing_post_links')
    op.drop_table('listing_post_links')

    with op.batch_alter_table('posts') as batch_op:
        batch_op.drop_column('status')

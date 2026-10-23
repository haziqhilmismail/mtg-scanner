"""add google auth columns to users

Revision ID: 4d2a9f51e7b1
Revises: 9b3f5c81d4e2
Create Date: 2026-05-11 18:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '4d2a9f51e7b1'
down_revision: Union[str, Sequence[str], None] = '9b3f5c81d4e2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # google_sub is Google's stable per-user identifier. We use it (not email)
    # as the lookup key for returning users. Nullable so the existing solo user
    # row can be claimed on first sign-in.
    with op.batch_alter_table('users') as batch_op:
        batch_op.add_column(sa.Column('google_sub', sa.String(length=64), nullable=True))
        batch_op.add_column(sa.Column('name', sa.String(length=255), nullable=True))
        batch_op.add_column(sa.Column('avatar_url', sa.String(length=512), nullable=True))
        batch_op.create_index('ix_users_google_sub', ['google_sub'], unique=True)


def downgrade() -> None:
    with op.batch_alter_table('users') as batch_op:
        batch_op.drop_index('ix_users_google_sub')
        batch_op.drop_column('avatar_url')
        batch_op.drop_column('name')
        batch_op.drop_column('google_sub')

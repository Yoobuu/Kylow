Database Migrations
===================

This project uses a lightweight, SQL-based migration runner (no Alembic).

How to apply migrations
-----------------------
From the backend folder:

```bash
python -m app.scripts.migrate
```

The script will:
- Create a `schema_migrations` table if missing.
- Apply any new `.sql` files in `app/scripts/migrations/` (in filename order).

Notes
-----
- Ensure `DATABASE_URL` (or `backend/.env`) points to the target database.
- Run this before starting the app if the schema is behind the models.

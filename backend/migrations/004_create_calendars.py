"""Create the calendar tables for shared year planners.

Edit this file only if this migration has not been used yet.
Create a new migration file instead when you need another schema change.
"""

from yoyo import step


steps = [
    step(
        """
        CREATE TABLE calendars (
            id TEXT PRIMARY KEY,
            edit_key_hash TEXT NOT NULL,
            name TEXT NOT NULL,
            month_start_year INTEGER NOT NULL,
            month_start_month INTEGER NOT NULL CHECK (month_start_month BETWEEN 0 AND 11),
            month_end_year INTEGER NOT NULL,
            month_end_month INTEGER NOT NULL CHECK (month_end_month BETWEEN 0 AND 11),
            selected_view TEXT NOT NULL CHECK (selected_view IN ('Linear', 'Classic', 'Column')),
            selected_color_texture TEXT NOT NULL,
            revision INTEGER NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        ) STRICT
        """,
        "DROP TABLE calendars",
    ),
    step(
        """
        CREATE TABLE calendar_cells (
            calendar_id TEXT NOT NULL,
            date_key TEXT NOT NULL,
            color TEXT,
            texture TEXT,
            custom_text TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            PRIMARY KEY (calendar_id, date_key),
            FOREIGN KEY (calendar_id) REFERENCES calendars (id) ON DELETE CASCADE
        ) STRICT
        """,
        "DROP TABLE calendar_cells",
    ),
]

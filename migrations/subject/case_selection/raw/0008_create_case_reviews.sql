-- generated from pipelines/case_selection's declared TABLES at declaration rev 0008
-- description: create case_selection/raw/case_reviews
-- review this file; it is applied exactly as written

CREATE TABLE case_reviews (
    case_id TEXT,
    adviser TEXT,
    case_type TEXT,
    status TEXT,
    outcome TEXT,
    selected_date TEXT,
    completed_date TEXT
);

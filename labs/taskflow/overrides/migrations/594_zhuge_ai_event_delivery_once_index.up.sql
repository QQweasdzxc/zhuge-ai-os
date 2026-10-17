CREATE UNIQUE INDEX zhuge_ai_event_delivery_once
    ON zhuge_ai_engineering_event(run_id, source_delivery_id)
    WHERE source_delivery_id IS NOT NULL;

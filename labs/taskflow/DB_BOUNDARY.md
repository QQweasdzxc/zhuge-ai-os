# TaskFlow database boundary (build parity)

TaskFlow is built from the Multica source snapshot but must run against a
TaskFlow-only Dev database. Its connection string must pin `search_path` to
`lab_multica,extensions`; the TaskFlow entrypoint creates those schemas before
the upstream migration runner starts. The API must not receive Zhuge Production
database credentials or resolve canonical Zhuge tables in `public`.

This is a TaskFlow Dev database bootstrap contract. Supply its database
credentials only through private runtime configuration; never bake them into
either image or source. No Production schema or data is modified by the Docker
build or Dev database bootstrap.

The API image also defaults Multica Cloud integration off, disables workspace
creation, and disables telemetry. Web builds default cloud runtime UI off and
disable Next.js telemetry. Zhuge Human Identity remains the only human identity
entry path through the copied `/auth/zhuge` overlay.

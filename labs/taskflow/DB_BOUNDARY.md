# TaskFlow database boundary (build parity)

TaskFlow is built from the Multica source snapshot but must run against a
TaskFlow-owned service binding to the isolated `lab_multica` schema. Its runtime
database role must have a restricted `search_path` of `lab_multica, extensions`.
The TaskFlow service must not receive Zhuge Production credentials or resolve
canonical Zhuge tables in `public`.

This is a deployment-time contract, not a database change in the build-parity
gate. Supply database credentials only through private runtime configuration;
never bake them into either image or source. No Production schema or data is
modified by the Docker build.

The API image also defaults Multica Cloud integration off, disables workspace
creation, and disables telemetry. Web builds default cloud runtime UI off and
disable Next.js telemetry. Zhuge Human Identity remains the only human identity
entry path through the copied `/auth/zhuge` overlay.

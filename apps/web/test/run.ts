// node:test auto-runs the imported suites. A single entry also keeps tsx's loader
// outside Node's per-file test-worker module discovery.
import './client.test';
import './proxy.test';
import './render.test';

# squid Test Report

## Run metadata

- **Recorded on**: 2026-04-03  
- **Test files**: 9/9 passing  
- **Test cases**: 31/31 passing  
- **Duration**: ~658ms (single local run; varies by machine)

## Coverage by file

| Test file | Focus |
|-----------|--------|
| core.test.ts | Task state machine, workspace sandbox |
| state-machine.test.ts | Ask / Craft / Plan transitions and illegal transitions |
| sandbox.test.ts | In/out-of-workspace paths, traversal, absolute paths |
| skill-loader.test.ts | Load skills from Markdown, malformed input |
| cron-tools.test.ts | Create/delete scheduled jobs, status, run history |
| e2e.test.ts | Read/write, Glob, Grep file workflows |
| claw-integration.test.ts | POST /task, GET /task/:id, 404 |
| integration.test.ts | Tool shape/structure |
| system-integration.test.ts | Module init, Claw creation, state machine, expert loading |

## Functional checklist (summary)

- Task management: state machine, transitions, error paths  
- Workspace: directory binding and sandbox  
- Tools: ReadFile, WriteFile, Glob, Grep  
- Skills: YAML parsing and loading  
- Experts: built-in list and queries  
- Claw: HTTP surface and error responses (per tests)  
- Scheduled jobs: create, delete, status, run records  
- System integration: end-to-end and cross-module flows  

## Performance (reference)

- Average per-test time on the order of milliseconds (`npm test` output)  
- Slower cases tend to cluster in E2E file workflows  

## Approximate case counts by module

| Module | Approx. cases |
|--------|----------------|
| Task management | 5 |
| State machine | 5 |
| Sandbox | 5 |
| Skills | 2 |
| Cron tools | 16 |
| Tools | 3 |
| Claw API | 3 |
| System integration | 4 |
| End-to-end | 1 |

## Conclusion

For this recorded batch, all listed automated tests passed, covering core logic, sandboxing, and parts of the HTTP API. Re-run `npm test` on target hardware before shipping, and validate UI, channels, and third-party services manually.

**Note**: Full Electrobun desktop and channel-extension validation requires additional manual or E2E coverage; this report does not replace the integration testing guide (see [integration-testing.md](./integration-testing.md)).

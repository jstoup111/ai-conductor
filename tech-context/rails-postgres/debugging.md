# Rails + PostgreSQL: Debugging Context

## Interactive Tools

| Tool | Command | Use For |
|------|---------|---------|
| Rails console | `rails console` | Interactive debugging, data inspection |
| DB console | `rails dbconsole` | Direct PostgreSQL queries |
| Reload | `reload!` (in console) | Pick up code changes without restart |
| Pry debugger | `binding.pry` in code | Breakpoint debugging |
| Debug gem | `debugger` in code | Ruby 3.1+ built-in debugger |

## Log Locations

| Log | Path | Contains |
|-----|------|----------|
| Development | `log/development.log` | Requests, SQL, rendering |
| Test | `log/test.log` | Test execution SQL and errors |
| Production | `log/production.log` | Filtered logs (check log level) |

**Tail logs in real time:** `tail -f log/development.log`

## SQL Debugging

Enable SQL logging in console:
```ruby
ActiveRecord::Base.logger = Logger.new(STDOUT)
```

Check slow queries:
```ruby
ActiveRecord::Base.connection.execute("SELECT * FROM pg_stat_statements ORDER BY total_time DESC LIMIT 10")
```

Check for missing indexes:
```sql
SELECT schemaname, tablename, attname, n_live_tup, seq_scan, idx_scan
FROM pg_stat_user_tables t
JOIN pg_stats s ON t.relname = s.tablename
WHERE seq_scan > 0 AND idx_scan = 0 AND n_live_tup > 1000;
```

## Migration State

| Command | Shows |
|---------|-------|
| `rails db:migrate:status` | Which migrations have run |
| `rails db:version` | Current schema version |
| `rails db:schema:dump` | Regenerate schema.rb from DB |

## Common Gotchas

### Eager Loading (Development vs Production)
- Development: classes loaded on demand (`config.eager_load = false`)
- Production: all classes loaded at boot (`config.eager_load = true`)
- Bug pattern: code works in development, fails in production because of load order
- Check: `config.eager_load` in environment files

### Time Zones
- **ALWAYS** use `Time.zone.now`, never `Time.now`
- `Time.now` returns system time; `Time.zone.now` respects `config.time_zone`
- PostgreSQL stores timestamps in UTC; Rails converts on read/write
- Bug pattern: time comparisons fail because of timezone mismatch

### `before_action` Ordering
- Callbacks run in the order they're defined
- Bug pattern: auth check runs AFTER the action that needs it
- Check: callback order in controller and parent controllers

### Caching in Development
- `rails dev:cache` toggles caching on/off in development
- Bug pattern: stale data in development because caching was left on
- Check: existence of `tmp/caching-dev.txt`

### Database Connection Issues
- Pool size: check `config/database.yml` → `pool` setting
- Puma threads must be ≤ pool size
- Sidekiq concurrency must be ≤ pool size
- Bug pattern: `ActiveRecord::ConnectionTimeoutError` under load

### Autoloading (Zeitwerk)
- Files must match class name: `app/models/user_account.rb` → `UserAccount`
- Bug pattern: `NameError: uninitialized constant` when class name doesn't match file path
- Check: `rails zeitwerk:check`

## PostgreSQL-Specific

### Lock Debugging
```sql
SELECT pid, state, query, wait_event_type, wait_event
FROM pg_stat_activity
WHERE state != 'idle';
```

### Table Bloat
```sql
SELECT relname, n_dead_tup, n_live_tup, last_autovacuum
FROM pg_stat_user_tables
ORDER BY n_dead_tup DESC;
```

### Connection Count
```sql
SELECT count(*), state FROM pg_stat_activity GROUP BY state;
```

-- Atomic fixed-window counter (PRD Appendix A note).
-- The window-index is baked into the key, so a new window starts with a fresh
-- counter; the key self-expires one window after creation.
-- KEYS[1] = fixed_window:{client}:{window_index}
-- ARGV[1] = limit
-- ARGV[2] = window TTL in ms
-- Returns { allowed (0/1), count }
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('PEXPIRE', KEYS[1], tonumber(ARGV[2]))
end
local allowed = count <= tonumber(ARGV[1]) and 1 or 0
return { allowed, count }

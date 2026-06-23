-- Atomic fixed-window counter (PRD Appendix A note).
-- The window-index is baked into the key, so a new window starts with a fresh
-- counter; the key self-expires one window after creation.
-- KEYS[1] = fixed_window:{client}:{window_index}
-- ARGV[1] = limit
-- ARGV[2] = window TTL in ms
-- ARGV[3] = cost (counter increment; usually 1)
-- Returns { allowed (0/1), count }
local cost = tonumber(ARGV[3]) or 1
local count = redis.call('INCRBY', KEYS[1], cost)
if count == cost then  -- first write in this window (counter was absent/0)
  redis.call('PEXPIRE', KEYS[1], tonumber(ARGV[2]))
end
local allowed = count <= tonumber(ARGV[1]) and 1 or 0
return { allowed, count }

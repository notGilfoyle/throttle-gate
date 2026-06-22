-- Atomic sliding-window counter: weighted blend of current + previous fixed
-- windows. estimate = curr + prev * weight, where weight is the fraction of the
-- previous window still overlapping the trailing window.
-- KEYS[1] = sc:{client}:{window_index}        (current)
-- KEYS[2] = sc:{client}:{window_index - 1}    (previous)
-- ARGV[1] = limit
-- ARGV[2] = weight (0..1)
-- ARGV[3] = window TTL in ms (key kept for 2 windows)
-- Returns { allowed (0/1), curr_count, prev_count, estimate_string }
local limit  = tonumber(ARGV[1])
local weight = tonumber(ARGV[2])

local curr = tonumber(redis.call('GET', KEYS[1]) or '0')
local prev = tonumber(redis.call('GET', KEYS[2]) or '0')

local estimate = curr + prev * weight
local allowed = 0
if estimate < limit then
  curr = redis.call('INCR', KEYS[1])
  redis.call('PEXPIRE', KEYS[1], tonumber(ARGV[3]) * 2)
  allowed = 1
  estimate = curr + prev * weight
end

return { allowed, curr, prev, tostring(estimate) }

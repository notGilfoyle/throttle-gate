-- Atomic sliding-window log via a sorted set of request timestamps.
-- Drops entries older than the trailing window, counts what remains, and admits
-- (recording the new timestamp) only if under the limit.
-- KEYS[1] = sliding_log:{client}
-- ARGV[1] = now (epoch seconds, float)
-- ARGV[2] = window_s
-- ARGV[3] = limit
-- ARGV[4] = unique member id for this request
-- Returns { allowed (0/1), count, timestamps_flat... }
local now    = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit  = tonumber(ARGV[3])

redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now - window)
local count = redis.call('ZCARD', KEYS[1])

local allowed = 0
if count < limit then
  redis.call('ZADD', KEYS[1], now, ARGV[4])
  allowed = 1
  count = count + 1
end
redis.call('EXPIRE', KEYS[1], math.ceil(window) + 1)

-- Scores (timestamps) of the in-window entries, for the dot visualizer.
local scores = redis.call('ZRANGE', KEYS[1], 0, -1, 'WITHSCORES')
local out = { allowed, count }
for i = 2, #scores, 2 do
  out[#out + 1] = scores[i]
end
return out

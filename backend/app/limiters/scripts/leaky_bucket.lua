-- Atomic leaky bucket (as a queue). Drains at leak_rate; admits a request only
-- if the queue has room, otherwise rejects (overflow).
-- KEYS[1] = leaky_bucket:{client}
-- ARGV[1] = capacity
-- ARGV[2] = leak_rate (requests/sec)
-- ARGV[3] = now (epoch seconds, float)
-- Returns { allowed (0/1), queue_depth_string }
local cap  = tonumber(ARGV[1])
local rate = tonumber(ARGV[2])
local now  = tonumber(ARGV[3])

local d = redis.call('HMGET', KEYS[1], 'depth', 'ts')
local depth = tonumber(d[1])
local ts    = tonumber(d[2])
if depth == nil then depth = 0; ts = now end

-- Leak whatever drained since we last looked.
depth = math.max(0, depth - (now - ts) * rate)

-- Admit only if the queue has room for one more whole request, so depth never
-- exceeds capacity (keeps the funnel visualization honest).
local allowed = 0
if depth + 1 <= cap then
  depth = depth + 1
  allowed = 1
end

redis.call('HMSET', KEYS[1], 'depth', depth, 'ts', now)
redis.call('EXPIRE', KEYS[1], math.ceil(cap / rate) * 2)
return { allowed, tostring(depth) }

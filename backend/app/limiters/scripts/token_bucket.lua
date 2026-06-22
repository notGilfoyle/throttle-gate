-- Atomic token-bucket check (PRD Appendix A).
-- KEYS[1] = bucket key
-- ARGV[1] = capacity
-- ARGV[2] = refill_rate (tokens/sec)
-- ARGV[3] = now (epoch seconds, float)
-- ARGV[4] = requested tokens (usually 1)
-- Returns { allowed (0/1), tokens_remaining (string) }
local capacity  = tonumber(ARGV[1])
local rate      = tonumber(ARGV[2])
local now       = tonumber(ARGV[3])
local requested = tonumber(ARGV[4])

local d = redis.call('HMGET', KEYS[1], 'tokens', 'ts')
local tokens = tonumber(d[1])
local ts     = tonumber(d[2])
if tokens == nil then tokens = capacity; ts = now end

local tokens_now = math.min(capacity, tokens + (now - ts) * rate)
local allowed = 0
if tokens_now >= requested then
  tokens_now = tokens_now - requested
  allowed = 1
end

redis.call('HMSET', KEYS[1], 'tokens', tokens_now, 'ts', now)
redis.call('EXPIRE', KEYS[1], math.ceil(capacity / rate) * 2)  -- idle keys self-expire
return { allowed, tostring(tokens_now) }

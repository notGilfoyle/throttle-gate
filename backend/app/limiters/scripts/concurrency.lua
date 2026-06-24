-- Atomic concurrency limiter — a leased semaphore. Caps *simultaneous in-flight*
-- requests rather than a rate. Each admitted request leases a slot, stored in a
-- sorted set with score = lease expiry (now + hold time). Expired leases are
-- swept on every call, so a slot auto-releases when its lease lapses (no explicit
-- release needed; an optional release can ZREM the member).
-- KEYS[1] = concurrency:{client}
-- ARGV[1] = limit (max concurrent)
-- ARGV[2] = lease_ttl_s (hold time)
-- ARGV[3] = now (epoch seconds, float)
-- ARGV[4] = unique lease id for this request
-- ARGV[5] = cost (slots this request holds; usually 1)
-- Returns { allowed (0/1), active, soonest_expiry_string }
local limit = tonumber(ARGV[1])
local ttl   = tonumber(ARGV[2])
local now   = tonumber(ARGV[3])
local cost  = tonumber(ARGV[5]) or 1

redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now)  -- release expired leases
local active = redis.call('ZCARD', KEYS[1])

local allowed = 0
if active + cost <= limit then
  for i = 0, cost - 1 do
    redis.call('ZADD', KEYS[1], now + ttl, ARGV[4] .. ':' .. i)
  end
  allowed = 1
  active = active + cost
end
redis.call('EXPIRE', KEYS[1], math.ceil(ttl) + 1)

-- When full, report the soonest lease expiry so the caller can compute Retry-After.
local soonest = 0
if allowed == 0 then
  local z = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
  if z[2] then soonest = tonumber(z[2]) end
end
return { allowed, active, tostring(soonest) }
